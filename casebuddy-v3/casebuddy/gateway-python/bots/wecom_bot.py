"""
企业微信 Bot 实现 — 自建应用模式
基于企业微信 API（Webhook 回调 + 主动消息发送）

支持：
1. 接收文本消息 → 转发 LLM
2. 接收文件消息（PDF/DOCX） → 下载 → 分析
3. 工作流命令（案例速读/SWOT/深度洞察/PPT大纲/全流程）
4. 查看分析工作台 / 推送工作台结果
5. 发送文件附件
6. 分段发送长文本

依赖：pip install requests
"""

import os
import sys
import json
import time
import hashlib
import threading
from typing import List, Optional, Dict, Any
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse
import socketserver

try:
    import requests
except ImportError:
    print("请安装依赖: pip install requests")
    sys.exit(1)


class WeComBot:
    """企业微信 Bot 客户端（自建应用模式）"""

    # 企业微信 API 基础地址
    API_BASE = "https://qyapi.weixin.qq.com/cgi-bin"

    def __init__(
        self,
        corp_id: str = '',
        agent_id: int = 0,
        secret: str = '',
        encoding_aes_key: str = '',   # 接收消息回调的 EncodingAESKey
        token: str = '',              # 接收消息回调的 Token
        allowed_users: List[str] = [],
        callback_port: int = 3003,    # 回调服务端口
        llm_proxy_url: str = 'http://localhost:3001',
        gateway_state: Any = None,
    ):
        self.corp_id = corp_id
        self.agent_id = agent_id
        self.secret = secret
        self.encoding_aes_key = encoding_aes_key
        self.token = token
        self.allowed_users = set(allowed_users) if allowed_users else set()
        self.public_access = '*' in self.allowed_users
        self._llm_proxy_url = llm_proxy_url
        self._gateway = gateway_state
        self._callback_port = callback_port

        self._running = False
        self._access_token = ''
        self._token_expires_at = 0
        self._last_user_id = ''  # 记录最后发消息的用户ID
        self._seen_ids = set()
        self._dedup_file = Path(__file__).parent.parent / "temp" / "wecom_seen_ids.txt"
        self._dedup_file.parent.mkdir(exist_ok=True)
        self._temp_dir = Path(__file__).parent.parent / "temp" / "wecom_files"
        self._temp_dir.mkdir(exist_ok=True)
        self._http_server = None

    # ─── 去重机制 ───

    def _load_dedup(self):
        if self._dedup_file.exists():
            try:
                with open(self._dedup_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        mid = line.strip()
                        if mid:
                            self._seen_ids.add(mid)
            except Exception as e:
                print(f"[WeCom] 加载去重记录失败: {e}")

    def _save_dedup(self):
        try:
            with open(self._dedup_file, 'w', encoding='utf-8') as f:
                for mid in list(self._seen_ids)[-500:]:
                    f.write(f"{mid}\n")
        except Exception as e:
            print(f"[WeCom] 保存去重记录失败: {e}")

    # ─── 权限检查 ───

    def _check_permission(self, user_id: str) -> bool:
        if self.public_access:
            return True
        return user_id in self.allowed_users

    # ─── 获取 access_token ───

    def _get_access_token(self) -> str:
        """获取企业微信 access_token（带缓存）"""
        if self._access_token and time.time() < self._token_expires_at:
            return self._access_token

        if not self.corp_id or not self.secret:
            print("[WeCom] corp_id 或 secret 未配置")
            return ''

        try:
            url = f"{self.API_BASE}/gettoken?corpid={self.corp_id}&corpsecret={self.secret}"
            resp = requests.get(url, timeout=10, proxies={'http': '', 'https': ''})
            data = resp.json()
            if data.get('errcode') == 0:
                self._access_token = data.get('access_token', '')
                self._token_expires_at = time.time() + data.get('expires_in', 7200) - 300
                return self._access_token
            else:
                print(f"[WeCom] 获取 access_token 失败: {data}")
                return ''
        except Exception as e:
            print(f"[WeCom] 获取 access_token 错误: {e}")
            return ''

    # ─── 发送文本消息 ───

    def _send_text(self, user_id: str, text: str):
        """主动发送文本消息给企业微信用户"""
        token = self._get_access_token()
        if not token:
            print("[WeCom] 无法发送消息: access_token 为空")
            return

        for part in self._split_text(text, 2000):
            try:
                url = f"{self.API_BASE}/message/send?access_token={token}"
                body = {
                    "touser": user_id,
                    "msgtype": "text",
                    "agentid": self.agent_id,
                    "text": {"content": part}
                }
                resp = requests.post(url, json=body, timeout=10, proxies={'http': '', 'https': ''})
                data = resp.json()
                if data.get('errcode') != 0:
                    print(f"[WeCom] 发送消息失败: {data}")
                time.sleep(0.3)
            except Exception as e:
                print(f"[WeCom] 发送消息错误: {e}")

    # ─── 发送文件消息 ───

    def _send_file(self, user_id: str, file_path: str) -> bool:
        """上传文件并发送给企业微信用户"""
        token = self._get_access_token()
        if not token:
            return False

        try:
            # 1. 上传临时素材
            upload_url = f"{self.API_BASE}/media/upload?access_token={token}&type=file"
            file_name = os.path.basename(file_path)
            with open(file_path, 'rb') as f:
                resp = requests.post(upload_url,
                    files={'media': (file_name, f, 'application/octet-stream')},
                    timeout=60, proxies={'http': '', 'https': ''})
            data = resp.json()
            if data.get('errcode') != 0:
                print(f"[WeCom] 上传文件失败: {data}")
                return False

            media_id = data.get('media_id', '')

            # 2. 发送文件消息
            send_url = f"{self.API_BASE}/message/send?access_token={token}"
            body = {
                "touser": user_id,
                "msgtype": "file",
                "agentid": self.agent_id,
                "file": {"media_id": media_id}
            }
            resp = requests.post(send_url, json=body, timeout=10, proxies={'http': '', 'https': ''})
            data = resp.json()
            return data.get('errcode') == 0

        except Exception as e:
            print(f"[WeCom] 发送文件错误: {e}")
            return False

    # ─── 文本分段 ───

    def _split_text(self, text: str, limit: int = 2000) -> List[str]:
        lines = text.split('\n')
        parts = []
        current = ''
        for line in lines:
            if len(current) + len(line) + 1 <= limit:
                current += ('\n' if current else '') + line
            else:
                if current:
                    parts.append(current)
                current = line
        if current:
            parts.append(current)
        return parts if parts else ['']

    # ─── 清洗响应文本 ───

    def _clean_response(self, text: str) -> str:
        import re
        text = re.sub(r'!\[.*?\]\(.*?\)', '', text)
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
        return text.strip()

    # ─── 调用 LLM ───

    def _call_llm(self, text: str) -> Optional[str]:
        try:
            resp = requests.post(
                f'{self._llm_proxy_url}/api/gateway/chat',
                json={'message': text},
                timeout=60,
                proxies={'http': '', 'https': ''}
            )
            if resp.ok:
                data = resp.json()
                return data.get('response', '') or data.get('text', '')
            err = resp.json().get('error', f'HTTP {resp.status_code}')
            return f'处理失败：{err}'
        except Exception as e:
            print(f"[WeCom] LLM 调用失败: {e}")
            return '抱歉，服务暂时不可用，请稍后再试。'

    # ─── 文件分析 ───

    def _analyze_file(self, file_path: str, user_id: str):
        """异步分析文件"""
        def _do_analyze():
            try:
                if self._gateway:
                    analysis = self._gateway._analyze_file(file_path)
                else:
                    self._send_text(user_id, '📄 正在解析文件...')
                    file_name = os.path.basename(file_path)
                    file_ext = os.path.splitext(file_name)[1].lower()
                    mime_map = {
                        '.pdf': 'application/pdf',
                        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    }
                    content_type = mime_map.get(file_ext, 'application/octet-stream')
                    with open(file_path, 'rb') as f:
                        resp = requests.post(
                            'http://localhost:3001/api/parse/file',
                            files={'file': (file_name, f, content_type)},
                            proxies={'http': '', 'https': ''},
                            timeout=120
                        )
                    if not resp.ok:
                        analysis = f'文件解析失败 (HTTP {resp.status_code})'
                    else:
                        data = resp.json()
                        parsed_text = data.get('text', '')
                        if not parsed_text.strip():
                            analysis = '文件无法提取有效文本内容。'
                        else:
                            analysis = self._call_llm(
                                f'请对以下案例文件内容进行专业MBA案例分析：\n{parsed_text}'
                            )

                for i in range(0, len(analysis), 1800):
                    self._send_text(user_id, analysis[i:i+1800])
                    time.sleep(0.5)
            except Exception as e:
                self._send_text(user_id, f'文件分析失败: {e}')

        threading.Thread(target=_do_analyze, daemon=True).start()

    # ─── 工作流命令 ───

    def _run_workflow(self, template_id: str, display_name: str, user_id: str):
        """异步执行工作流"""
        def _do_run():
            try:
                create_resp = requests.post(
                    'http://localhost:3001/api/workflow/create',
                    json={'templateId': template_id, 'name': display_name},
                    timeout=30, proxies={'http': '', 'https': ''}
                )
                if not create_resp.ok:
                    self._send_text(user_id, f'工作流创建失败: {create_resp.status_code}')
                    return

                wf_data = create_resp.json().get('workflow', {})
                wf_id = wf_data.get('id')
                if not wf_id:
                    self._send_text(user_id, '工作流创建失败: 无ID')
                    return

                requests.post(f'http://localhost:3001/api/workflow/{wf_id}/run',
                    timeout=10, proxies={'http': '', 'https': ''})
                self._send_text(user_id, '✅ 工作流已创建并开始执行')

                for attempt in range(60):
                    time.sleep(5)
                    status_resp = requests.get(
                        f'http://localhost:3001/api/workflow/{wf_id}',
                        timeout=10, proxies={'http': '', 'https': ''}
                    )
                    if status_resp.ok:
                        wf_status = status_resp.json().get('workflow', {})
                        st = wf_status.get('status', '')
                        if st == 'completed':
                            results = wf_status.get('results', {})
                            if results:
                                for step_name, result_text in results.items():
                                    if isinstance(result_text, str) and result_text.strip():
                                        self._send_text(user_id, f'📊 {step_name}')
                                        time.sleep(0.3)
                                        for i in range(0, len(result_text), 1800):
                                            self._send_text(user_id, result_text[i:i+1800])
                                            time.sleep(0.5)
                                self._send_text(user_id, '✅ 分析全部完成！')
                            else:
                                self._send_text(user_id, '✅ 工作流已完成，但未生成结果。')
                            break
                        elif st == 'failed':
                            steps = wf_status.get('steps', [])
                            failed = [s for s in steps if s.get('status') == 'failed']
                            errors = [f"{s['name']}: {s.get('error', '未知错误')}" for s in failed]
                            self._send_text(user_id, f'❌ 工作流执行失败:\n' + '\n'.join(errors))
                            break
                else:
                    self._send_text(user_id, '⏳ 工作流执行超时，请稍后发送"查看结果"获取结果。')
            except Exception as e:
                print(f'[WeCom] 工作流执行失败: {e}')
                self._send_text(user_id, f'工作流执行失败: {e}')

        threading.Thread(target=_do_run, daemon=True).start()

    # ─── 查看工作流结果 ───

    def _check_workflow_results(self, user_id: str):
        try:
            resp = requests.get('http://localhost:3001/api/workflow', timeout=10,
                                proxies={'http': '', 'https': ''})
            if resp.ok:
                wf_list = resp.json().get('workflows', [])
                if wf_list:
                    latest = wf_list[0]
                    results = latest.get('results', {})
                    status = latest.get('status', '')
                    if status == 'running':
                        steps = latest.get('steps', [])
                        done = sum(1 for s in steps if s['status'] in ('completed', 'failed'))
                        self._send_text(user_id,
                            f'⏳ 工作流「{latest["name"]}」执行中... ({done}/{len(steps)} 步骤完成)')
                    elif results:
                        for step_name, result_text in results.items():
                            if isinstance(result_text, str) and result_text.strip():
                                self._send_text(user_id, f'📊 {step_name}')
                                time.sleep(0.3)
                                for i in range(0, len(result_text), 1800):
                                    self._send_text(user_id, result_text[i:i+1800])
                                    time.sleep(0.5)
                    else:
                        self._send_text(user_id,
                            f'工作流「{latest["name"]}」{status}，暂无结果。')
                else:
                    self._send_text(user_id, '暂无工作流记录。')
        except Exception as e:
            self._send_text(user_id, f'获取工作流结果失败: {e}')

    # ─── 查看分析工作台 ───

    def _show_session_summary(self, user_id: str):
        if self._gateway:
            summary = self._gateway._build_session_summary()
        else:
            summary = '当前分析工作台暂无对话内容。'
        for i in range(0, len(summary), 1800):
            self._send_text(user_id, summary[i:i+1800])
            time.sleep(0.3)

    def _push_session_summary(self, user_id: str):
        if self._gateway:
            full_summary = self._gateway._build_full_session_summary()
        else:
            full_summary = '当前分析工作台暂无对话内容。'
        if '暂无对话内容' in full_summary:
            self._send_text(user_id, full_summary)
            return
        self._send_text(user_id, '📋 正在推送分析工作台内容...')
        for i in range(0, len(full_summary), 1800):
            self._send_text(user_id, full_summary[i:i+1800])
            time.sleep(0.5)

    # ─── 消息处理主入口 ───

    def _handle_message(self, message_data: dict):
        """处理从回调服务收到的消息"""
        try:
            msg_type = message_data.get('MsgType', '')
            from_user = message_data.get('FromUserName', '')
            msg_id = message_data.get('MsgId', '')

            if msg_id and msg_id in self._seen_ids:
                return

            if not self._check_permission(from_user):
                print(f"[WeCom] 未授权用户: {from_user}")
                return

            self._last_user_id = from_user

            if msg_id:
                self._seen_ids.add(msg_id)
                self._save_dedup()

            print(f"[WeCom] 收到消息 from {from_user}: type={msg_type}")

            # 文本消息
            if msg_type == 'text':
                content = message_data.get('Content', '').strip()
                if not content:
                    return
                print(f"[WeCom] 文本内容: {content[:80]}")
                self._handle_text_message(from_user, content)

            # 图片消息
            elif msg_type == 'image':
                media_id = message_data.get('MediaId', '')
                self._send_text(from_user, '📎 已收到图片，暂不支持图片分析。请发送 PDF 或 Word 文档。')

            # 文件/语音/视频消息
            elif msg_type in ('file', 'video', 'voice'):
                media_id = message_data.get('MediaId', '')
                title = message_data.get('Title', message_data.get('Recognition', ''))
                if media_id:
                    self._handle_media_message(from_user, media_id, title, msg_type)
                else:
                    self._send_text(from_user, f'⚠️ 收到{msg_type}消息但无 MediaId')

            else:
                self._send_text(from_user, f'⚠️ 暂不支持 {msg_type} 类型消息。')

        except Exception as e:
            print(f"[WeCom] 处理消息错误: {e}")

    def _handle_text_message(self, user_id: str, text: str):
        """处理文本消息"""
        # /help
        if text == '/help':
            self._send_help(user_id)
            return

        # /status
        if text == '/status':
            self._send_status(user_id)
            return

        # 查看分析工作台
        if any(kw in text for kw in ['分析工作台', '工作台内容', '分析了什么', '当前分析', '查看工作台']):
            self._show_session_summary(user_id)
            return

        # 推送工作台结果
        if any(kw in text for kw in ['发送结果', '推送结果', '把分析发给我', '发给我', '推送工作台', '结果发给我', '推送给我']):
            self._push_session_summary(user_id)
            return

        # 工作流命令
        wf_commands = {
            '案例速读': 'quick-read', '速读': 'quick-read',
            'swot分析': 'swot', 'swot': 'swot',
            '深度洞察': 'deep-insight', '洞察': 'deep-insight',
            'ppt大纲': 'ppt-outline', '生成ppt': 'ppt-outline',
            '全流程': 'full-pipeline', '全流程分析': 'full-pipeline', '一键分析': 'full-pipeline',
        }
        workflow_match = None
        for kw, tpl_id in wf_commands.items():
            if kw.lower() in text.lower():
                workflow_match = tpl_id
                break

        if workflow_match:
            tpl_names = {'quick-read': '案例速读', 'swot': 'SWOT分析', 'deep-insight': '深度洞察',
                         'ppt-outline': 'PPT大纲', 'full-pipeline': '全流程分析'}
            display_name = tpl_names.get(workflow_match, workflow_match)
            self._send_text(user_id, f'🚀 正在启动「{display_name}」工作流...')
            self._run_workflow(workflow_match, display_name, user_id)
            return

        # 查看工作流结果
        if any(kw in text for kw in ['查看结果', '工作流结果', '执行结果']):
            self._check_workflow_results(user_id)
            return

        # 其他文本 → LLM
        def _reply():
            try:
                self._send_text(user_id, '💭 正在思考...')
                response = self._call_llm(text)
                if response:
                    response = self._clean_response(response)
                    for i in range(0, len(response), 1800):
                        self._send_text(user_id, response[i:i+1800])
                        time.sleep(0.5)
            except Exception as e:
                self._send_text(user_id, '抱歉，回复失败了，请重试。')

        threading.Thread(target=_reply, daemon=True).start()

    def _handle_media_message(self, user_id: str, media_id: str, title: str, msg_type: str):
        """处理媒体文件消息：下载 → 分析"""
        if msg_type not in ('file', 'video'):
            self._send_text(user_id, f'📎 已收到{msg_type}消息，暂不支持该类型分析。请发送 PDF/DOCX 文件。')
            return

        doc_exts = ('.pdf', '.docx', '.doc', '.txt', '.md')
        is_doc = any(title.lower().endswith(ext) for ext in doc_exts) if title else False

        if not is_doc:
            self._send_text(user_id, f'📎 已收到文件 "{title}"，暂不支持该类型分析。请发送 PDF/DOCX 文件。')
            return

        self._send_text(user_id, f'📄 文件已收到，正在下载和分析 {title}...')

        def _download_and_analyze():
            try:
                token = self._get_access_token()
                if not token:
                    self._send_text(user_id, '⚠️ access_token 获取失败')
                    return

                # 下载临时素材
                download_url = f"{self.API_BASE}/media/get?access_token={token}&media_id={media_id}"
                resp = requests.get(download_url, timeout=60, proxies={'http': '', 'https': ''})

                if not resp.ok:
                    self._send_text(user_id, '⚠️ 文件下载失败')
                    return

                # 判断响应类型（JSON 错误 or 文件内容）
                content_type = resp.headers.get('Content-Type', '')
                if 'application/json' in content_type:
                    data = resp.json()
                    self._send_text(user_id, f'⚠️ 文件下载失败: {data.get("errmsg", "未知错误")}')
                    return

                # 保存文件
                file_name = title or f'media_{media_id}.dat'
                local_path = self._temp_dir / file_name
                with open(local_path, 'wb') as f:
                    f.write(resp.content)

                print(f"[WeCom] 文件已下载: {local_path}")
                self._analyze_file(str(local_path), user_id)

            except Exception as e:
                self._send_text(user_id, f'文件处理失败: {e}')

        threading.Thread(target=_download_and_analyze, daemon=True).start()

    # ─── 帮助文本 ───

    def _send_help(self, user_id: str):
        help_text = (
            '📚 CaseBuddy 企业微信助手\n\n'
            '💬 基础功能：\n'
            '• 发送任意问题 — AI 分析 MBA 案例\n'
            '• 发送 PDF/DOCX — 自动分析并返回结果\n\n'
            '🚀 工作流命令（需先发送PDF）：\n'
            '• "案例速读" — 核心摘要+关键数据\n'
            '• "SWOT分析" — SWOT四象限+TOWS\n'
            '• "深度洞察" — 多维度深度分析\n'
            '• "PPT大纲" — 生成PPT结构\n'
            '• "全流程分析" — 速读+SWOT+洞察+PPT\n'
            '• "查看结果" — 查看最近工作流结果\n\n'
            '📋 工作台相关：\n'
            '• "查看分析工作台" — 工作台摘要\n'
            '• "发送结果" — 推送工作台结果\n\n'
            '🔧 管理指令：\n'
            '• /help — 显示帮助\n'
            '• /status — 查看状态\n\n'
            '💡 使用流程：先发PDF → 再发命令'
        )
        self._send_text(user_id, help_text)

    def _send_status(self, user_id: str):
        status_text = (
            f'📊 CaseBuddy 企业微信助手状态\n\n'
            f'✅ 企业微信 Bot 已连接\n'
            f'🏢 企业ID：{self.corp_id[:8]}...{self.corp_id[-4:] if self.corp_id else "未配置"}\n'
            f'🤖 应用ID：{self.agent_id}\n'
            f'🤖 LLM 后端：{self._llm_proxy_url}\n'
            f'👥 授权模式：{"公开" if self.public_access else f"白名单({len(self.allowed_users)}人)"}\n'
            f'📁 最后用户：{self._last_user_id or "无"}'
        )
        self._send_text(user_id, status_text)

    # ─── 启动 / 停止 ───

    def stop(self):
        """停止 Bot"""
        self._running = False
        if self._http_server:
            try:
                self._http_server.shutdown()
            except:
                pass

    def run(self):
        """运行 Bot：启动回调 HTTP 服务器"""
        self._running = True
        print(f"[WeCom] Bot 启动中 (corp_id={self.corp_id[:8]}..., agent_id={self.agent_id})")

        if not self.corp_id or not self.secret:
            print("[WeCom] 配置不完整，请设置 corp_id 和 secret")
            return

        try:
            self._load_dedup()

            # 验证 access_token
            token = self._get_access_token()
            if not token:
                print("[WeCom] 获取 access_token 失败，请检查 corp_id 和 secret")
                return

            print(f"[WeCom] access_token 获取成功")
            print(f"[WeCom] 回调服务监听在 http://0.0.0.0:{self._callback_port}")
            print(f"[WeCom] 请在企业微信管理后台配置回调 URL: http://<你的IP>:{self._callback_port}/callback")
            print(f"[WeCom] Token: {self.token}, EncodingAESKey: {self.encoding_aes_key[:8]}...")

            # 创建回调 HTTP 服务器
            bot_ref = self  # 引用自身，供 Handler 使用

            class WeComCallbackHandler(BaseHTTPRequestHandler):
                """企业微信回调请求处理器"""

                def log_message(self, format, *args):
                    print(f"[WeCom-HTTP] {args[0]}")

                def do_GET(self):
                    """URL 验证（企业微信首次配置回调时会发送 GET 请求）"""
                    parsed = urlparse(self.path)
                    params = parse_qs(parsed.query)

                    msg_signature = params.get('msg_signature', [''])[0]
                    timestamp = params.get('timestamp', [''])[0]
                    nonce = params.get('nonce', [''])[0]
                    echo_str = params.get('echostr', [''])[0]

                    if not echo_str:
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(b'ok')
                        return

                    # 简单签名验证（生产环境应使用 wechatpy 等库解密）
                    # 这里简化处理：直接返回 echostr
                    print(f"[WeCom] 收到 URL 验证请求: echostr={echo_str[:20]}...")
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/plain')
                    self.end_headers()
                    self.wfile.write(echo_str.encode('utf-8'))

                def do_POST(self):
                    """接收消息回调"""
                    content_length = int(self.headers.get('Content-Length', 0))
                    body = self.rfile.read(content_length)

                    try:
                        # 解析 XML 消息体
                        # 简化处理：尝试直接解析为文本
                        # 企业微信消息是 XML 格式，这里用简单方式解析
                        import xml.etree.ElementTree as ET
                        root = ET.fromstring(body)

                        # 提取字段
                        def get_xml_text(tag):
                            elem = root.find(tag)
                            return elem.text if elem is not None else ''

                        msg_data = {
                            'ToUserName': get_xml_text('ToUserName'),
                            'FromUserName': get_xml_text('FromUserName'),
                            'CreateTime': get_xml_text('CreateTime'),
                            'MsgType': get_xml_text('MsgType'),
                            'Content': get_xml_text('Content'),
                            'MsgId': get_xml_text('MsgId'),
                            'MediaId': get_xml_text('MediaId'),
                            'Title': get_xml_text('Title'),
                            'Recognition': get_xml_text('Recognition'),
                            'PicUrl': get_xml_text('PicUrl'),
                            'MsgFormat': get_xml_text('MsgFormat'),
                            'Event': get_xml_text('Event'),
                        }

                        print(f"[WeCom] 收到回调消息: type={msg_data['MsgType']}, from={msg_data['FromUserName']}")

                        # 处理消息
                        bot_ref._handle_message(msg_data)

                        # 返回 "success" 确认
                        self.send_response(200)
                        self.send_header('Content-Type', 'text/plain')
                        self.end_headers()
                        self.wfile.write(b'success')

                    except Exception as e:
                        print(f"[WeCom] 解析回调消息失败: {e}")
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(b'success')

            class ThreadedServer(socketserver.ThreadingMixIn, HTTPServer):
                allow_reuse_address = True

            self._http_server = ThreadedServer(('0.0.0.0', self._callback_port), WeComCallbackHandler)
            self._http_server.serve_forever()

        except KeyboardInterrupt:
            print("[WeCom] 收到退出信号")
        except Exception as e:
            print(f"[WeCom] Bot 错误: {e}")
        finally:
            self._running = False
            self._save_dedup()
            print("[WeCom] Bot 已停止")
