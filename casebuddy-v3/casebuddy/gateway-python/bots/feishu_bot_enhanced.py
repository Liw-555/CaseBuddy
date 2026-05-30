"""
飞书 Bot 增强实现 — 对齐微信Bot完整能力
支持：
1. 接收文本消息 → 转发 LLM
2. 接收文件消息（PDF/DOCX） → 下载 → 分析
3. 工作流命令（案例速读/SWOT/深度洞察/PPT大纲/全流程）
4. 查看分析工作台 / 推送工作台结果
5. 发送 PPTX 文件附件
6. 分段发送长文本
7. 消息去重 + 权限控制
"""

import os
import sys
import json
import time
import threading
from typing import List, Optional, Dict, Any
from pathlib import Path

try:
    import lark_oapi as lark
    from lark_oapi.api.im.v1 import *
    from lark_oapi.api.im.v1 import CreateMessageRequestBody, CreateMessageRequest
except ImportError:
    print("请安装依赖: pip install lark-oapi")
    sys.exit(1)


class FeishuBot:
    """飞书 Bot 客户端（增强版 — 对齐微信Bot完整能力）"""

    def __init__(
        self,
        app_id: str,
        app_secret: str,
        allowed_users: List[str],
        llm_proxy_url: str = 'http://localhost:3001',
        gateway_state: Any = None,  # GatewayState 引用，用于共享 _analyze_file / session 等
    ):
        self.app_id = app_id
        self.app_secret = app_secret
        self.allowed_users = set(allowed_users) if allowed_users else set()
        self.public_access = '*' in self.allowed_users
        self._llm_proxy_url = llm_proxy_url
        self._gateway = gateway_state  # 引用 GatewayState

        self._running = False
        self._client = None
        self._seen_ids = set()
        self._dedup_file = Path(__file__).parent.parent / "temp" / "feishu_seen_ids.txt"
        self._dedup_file.parent.mkdir(exist_ok=True)

        # 记录最后发消息的用户 open_id（用于推送功能）
        self._last_user_open_id = ''

        # 临时文件目录
        self._temp_dir = Path(__file__).parent.parent / "temp" / "feishu_files"
        self._temp_dir.mkdir(exist_ok=True)

    # ─── 去重机制 ───

    def _load_dedup(self):
        """加载去重记录"""
        if self._dedup_file.exists():
            try:
                with open(self._dedup_file, 'r', encoding='utf-8') as f:
                    for line in f:
                        mid = line.strip()
                        if mid:
                            self._seen_ids.add(mid)
            except Exception as e:
                print(f"[Feishu] 加载去重记录失败: {e}")

    def _save_dedup(self):
        """保存去重记录"""
        try:
            with open(self._dedup_file, 'w', encoding='utf-8') as f:
                for mid in list(self._seen_ids)[-500:]:
                    f.write(f"{mid}\n")
        except Exception as e:
            print(f"[Feishu] 保存去重记录失败: {e}")

    # ─── 权限检查 ───

    def _check_permission(self, user_id: str) -> bool:
        # 如果没有配置白名单或配置了通配符，允许所有人
        if not self.allowed_users or self.public_access:
            return True
        return user_id in self.allowed_users

    # ─── 消息文本提取 ───

    def _extract_text(self, message: dict) -> str:
        """提取消息文本，非文本消息返回空字符串（由调用方处理文件下载）"""
        msg_type = message.get('msg_type', '')
        content_raw = message.get('content', '')

        if msg_type == 'text':
            try:
                return json.loads(content_raw).get('text', '')
            except Exception:
                return ''
        return ''

    # ─── 消息类型检测 ───

    def _is_file_message(self, message: dict) -> bool:
        """检测是否是文件消息（file类型）"""
        return message.get('msg_type', '') == 'file'

    def _is_image_message(self, message: dict) -> bool:
        """检测是否是图片消息"""
        return message.get('msg_type', '') == 'image'

    # ─── 飞书文件下载 ───

    def _download_file(self, message: dict) -> Optional[str]:
        """从飞书消息中下载文件到本地临时目录，返回本地文件路径"""
        msg_type = message.get('msg_type', '')
        if msg_type not in ('file', 'image'):
            return None

        try:
            import requests

            message_id = message.get('message_id', '')
            if not message_id:
                print("[Feishu] 下载文件失败: 无 message_id")
                return None

            # 获取 tenant_access_token
            token = self._get_tenant_access_token()
            if not token:
                print("[Feishu] 下载文件失败: 无法获取 tenant_access_token")
                return None

            headers = {
                "Authorization": f"Bearer {token}",
            }

            if msg_type == 'file':
                # 文件消息：content 里有 file_key 和 file_name
                try:
                    content = json.loads(message.get('content', '{}'))
                    file_key = content.get('file_key', '')
                    file_name = content.get('file_name', 'unknown_file')
                except Exception:
                    print("[Feishu] 下载文件失败: 无法解析消息 content")
                    return None

                if not file_key:
                    print(f"[Feishu] 下载文件失败: content 中无 file_key, content={message.get('content', '')}")
                    return None

                # 飞书文件下载 API: GET /messages/{message_id}/resources/{file_key}?type=file
                download_url = (
                    f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}"
                    f"/resources/{file_key}?type=file"
                )
                print(f"[Feishu] 正在下载文件: {file_name} (key={file_key[:30]}...)")

                resp = requests.get(download_url, headers=headers, timeout=60,
                                    proxies={'http': '', 'https': ''})
                if not resp.ok:
                    print(f"[Feishu] 下载文件内容失败: HTTP {resp.status_code}, body={resp.text[:200]}")
                    return None

                # 检查响应是否为错误JSON（而非文件二进制流）
                content_type = resp.headers.get('Content-Type', '')
                if 'application/json' in content_type:
                    error_data = resp.json()
                    code = error_data.get('code', -1)
                    msg = error_data.get('msg', '未知错误')
                    print(f"[Feishu] 下载文件API返回错误: code={code}, msg={msg}")
                    return None

                # 保存到本地（使用安全文件名避免中文路径问题）
                safe_name = file_name.encode('utf-8', errors='replace').decode('utf-8', errors='replace')
                local_path = self._temp_dir / safe_name
                with open(local_path, 'wb') as f:
                    f.write(resp.content)

                print(f"[Feishu] 文件已下载: {local_path} ({len(resp.content)} bytes)")
                return str(local_path)

            elif msg_type == 'image':
                # 图片消息：content 里有 image_key
                try:
                    content = json.loads(message.get('content', '{}'))
                    image_key = content.get('image_key', '')
                except Exception:
                    print("[Feishu] 下载图片失败: 无法解析消息 content")
                    return None

                if not image_key:
                    print("[Feishu] 下载图片失败: content 中无 image_key")
                    return None

                # 飞书图片下载 API: GET /messages/{message_id}/resources/{image_key}?type=image
                download_url = (
                    f"https://open.feishu.cn/open-apis/im/v1/messages/{message_id}"
                    f"/resources/{image_key}?type=image"
                )
                print(f"[Feishu] 正在下载图片: key={image_key[:30]}...")

                resp = requests.get(download_url, headers=headers, timeout=30,
                                    proxies={'http': '', 'https': ''})
                if not resp.ok:
                    print(f"[Feishu] 下载图片失败: HTTP {resp.status_code}")
                    return None

                local_path = self._temp_dir / f"{image_key}.png"
                with open(local_path, 'wb') as f:
                    f.write(resp.content)
                print(f"[Feishu] 图片已下载: {local_path} ({len(resp.content)} bytes)")
                return str(local_path)

        except Exception as e:
            print(f"[Feishu] 下载文件异常: {e}")
            import traceback
            traceback.print_exc()
            return None

    # ─── 构建飞书客户端 ───

    def _build_client(self):
        """构建飞书客户端"""
        return lark.Client.builder() \
            .app_id(self.app_id) \
            .app_secret(self.app_secret) \
            .log_level(lark.LogLevel.INFO) \
            .build()

    # ─── 发送文本消息 ───

    def _send_text(self, open_id: str, text: str):
        """发送文本消息（自动分段，每段 ≤4000 字符）"""
        if not self._client:
            return

        try:
            for part in self._split_text(text, 4000):
                body = CreateMessageRequestBody.builder() \
                    .receive_id(open_id) \
                    .msg_type("text") \
                    .content(json.dumps({"text": part})) \
                    .build()

                response = self._client.im.v1.message.create(
                    CreateMessageRequest.builder() \
                        .receive_id_type("open_id") \
                        .request_body(body) \
                        .build()
                )
                if not response.success():
                    print(f"[Feishu] 发送失败: {response.msg}")
                time.sleep(0.3)  # 防止频率限制
        except Exception as e:
            print(f"[Feishu] 发送消息错误: {e}")

    # ─── 发送文件消息 ───

    def _send_file(self, open_id: str, file_path: str) -> bool:
        """上传文件到飞书并发送给用户"""
        if not self._client or not os.path.exists(file_path):
            return False

        try:
            import requests

            token = self._get_tenant_access_token()
            if not token:
                return False

            # 1. 上传文件
            upload_url = "https://open.feishu.cn/open-apis/im/v1/files"
            headers = {"Authorization": f"Bearer {token}"}

            file_name = os.path.basename(file_path)

            # 根据文件扩展名确定 file_type
            ext = os.path.splitext(file_name)[1].lower()
            file_type_map = {
                '.pdf': 'pdf', '.doc': 'doc', '.docx': 'docx',
                '.xls': 'xls', '.xlsx': 'xlsx', '.ppt': 'ppt', '.pptx': 'pptx',
                '.mp4': 'mp4', '.mp3': 'mp3', '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpeg',
            }
            file_type = file_type_map.get(ext, 'stream')

            with open(file_path, 'rb') as f:
                files = {'file': (file_name, f, 'application/octet-stream')}
                data = {'file_type': file_type, 'file_name': file_name}

                resp = requests.post(upload_url, headers=headers, files=files, data=data,
                                     timeout=60, proxies={'http': '', 'https': ''})
                result = resp.json()

                if result.get('code') == 0:
                    file_key = result.get('data', {}).get('file_key', '')

                    # 2. 发送文件消息
                    body = CreateMessageRequestBody.builder() \
                        .receive_id(open_id) \
                        .msg_type("file") \
                        .content(json.dumps({"file_key": file_key})) \
                        .build()

                    response = self._client.im.v1.message.create(
                        CreateMessageRequest.builder() \
                            .receive_id_type("open_id") \
                            .request_body(body) \
                            .build()
                    )
                    return response.success()
                else:
                    print(f"[Feishu] 上传文件失败: {result}")
                    return False

        except Exception as e:
            print(f"[Feishu] 发送文件错误: {e}")
            return False

    # ─── 获取 tenant_access_token ───

    def _get_tenant_access_token(self) -> str:
        """获取 tenant_access_token（带缓存，有效期2小时）"""
        if hasattr(self, '_token_cache') and self._token_cache.get('expires_at', 0) > time.time():
            return self._token_cache.get('token', '')

        try:
            import requests
            url = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal"
            data = {"app_id": self.app_id, "app_secret": self.app_secret}
            resp = requests.post(url, json=data, timeout=10, proxies={'http': '', 'https': ''})
            result = resp.json()
            if result.get('code') == 0:
                token = result.get('tenant_access_token', '')
                expire = result.get('expire', 7200)
                self._token_cache = {
                    'token': token,
                    'expires_at': time.time() + expire - 300  # 提前5分钟刷新
                }
                return token
            else:
                print(f"[Feishu] 获取 token 失败: {result}")
                return ''
        except Exception as e:
            print(f"[Feishu] 获取 token 错误: {e}")
            return ''

    # ─── 文本分段 ───

    def _split_text(self, text: str, limit: int = 4000) -> List[str]:
        """按行分割文本，尊重段落完整性"""
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
        """清洗 LLM 响应文本（移除飞书不支持的 markdown 元素）"""
        import re
        text = re.sub(r'!\[.*?\]\(.*?\)', '', text)  # 移除图片
        text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)  # 链接保留文本
        return text.strip()

    # ─── 调用 LLM ───

    def _call_llm(self, text: str) -> Optional[str]:
        """调用 CaseBuddy 后端 LLM"""
        try:
            import requests
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
            print(f"[Feishu] LLM 调用失败: {err}")
            return f'处理失败：{err}'
        except Exception as e:
            print(f"[Feishu] LLM 调用失败: {e}")
            return '抱歉，服务暂时不可用，请稍后再试。'

    # ─── 文件分析 ───

    def _analyze_file(self, file_path: str, open_id: str):
        """异步分析文件并将结果发送给用户"""
        def _do_analyze():
            try:
                if self._gateway:
                    # 使用 GatewayState 的 _analyze_file（复用微信Bot的解析+分析逻辑）
                    analysis = self._gateway._analyze_file(file_path)
                else:
                    # 无 gateway 引用时，直接调用 LLM
                    self._send_text(open_id, f'📄 正在解析文件...')
                    import requests
                    file_name = os.path.basename(file_path)
                    file_ext = os.path.splitext(file_name)[1].lower()
                    mime_map = {
                        '.pdf': 'application/pdf',
                        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        '.doc': 'application/msword'
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
                                f'请对以下案例文件内容进行专业MBA案例分析，输出以下部分：\n'
                                f'1. 核心摘要（200字以内）\n'
                                f'2. 关键数据提取（用Markdown表格呈现）\n'
                                f'3. 核心决策点识别（3-5个）\n'
                                f'4. 初步战略建议\n\n'
                                f'文件名: {file_name}\n\n'
                                f'---案例内容---\n{parsed_text}'
                            )

                # 分段发送分析结果
                max_len = 3500
                for i in range(0, len(analysis), max_len):
                    self._send_text(open_id, analysis[i:i+max_len])
                    time.sleep(0.5)
            except Exception as e:
                self._send_text(open_id, f'文件分析失败: {e}')

        threading.Thread(target=_do_analyze, daemon=True).start()

    # ─── 工作流命令 ───

    def _run_workflow(self, template_id: str, display_name: str, open_id: str):
        """异步执行工作流并返回结果"""
        def _do_run():
            try:
                import requests as _req

                # 创建工作流
                create_resp = _req.post(
                    'http://localhost:3001/api/workflow/create',
                    json={'templateId': template_id, 'name': display_name},
                    timeout=30
                )
                if not create_resp.ok:
                    self._send_text(open_id, f'工作流创建失败: {create_resp.status_code}')
                    return

                wf_data = create_resp.json().get('workflow', {})
                wf_id = wf_data.get('id')
                if not wf_id:
                    self._send_text(open_id, '工作流创建失败: 无ID')
                    return

                # 执行工作流
                run_resp = _req.post(
                    f'http://localhost:3001/api/workflow/{wf_id}/run',
                    timeout=10
                )
                self._send_text(open_id, '✅ 工作流已创建并开始执行')

                # 轮询等待完成（最多5分钟）
                for attempt in range(60):
                    time.sleep(5)
                    status_resp = _req.get(
                        f'http://localhost:3001/api/workflow/{wf_id}',
                        timeout=10
                    )
                    if status_resp.ok:
                        wf_status = status_resp.json().get('workflow', {})
                        st = wf_status.get('status', '')

                        if st == 'completed':
                            results = wf_status.get('results', {})
                            if results:
                                for step_name, result_text in results.items():
                                    if isinstance(result_text, str) and result_text.strip():
                                        self._send_text(open_id, f'📊 {step_name}')
                                        time.sleep(0.3)
                                        for i in range(0, len(result_text), 3500):
                                            self._send_text(open_id, result_text[i:i+3500])
                                            time.sleep(0.5)

                                # 检查是否有 PPTX 文件
                                self._send_workflow_files(wf_status, open_id)
                                self._send_text(open_id, '✅ 分析全部完成！')
                            else:
                                self._send_text(open_id, '✅ 工作流已完成，但未生成结果。')
                            break

                        elif st == 'failed':
                            steps = wf_status.get('steps', [])
                            failed = [s for s in steps if s.get('status') == 'failed']
                            errors = [f"{s['name']}: {s.get('error', '未知错误')}" for s in failed]
                            self._send_text(open_id, f'❌ 工作流执行失败:\n' + '\n'.join(errors))
                            break
                else:
                    self._send_text(open_id, '⏳ 工作流执行超时，请稍后发送"查看结果"获取结果。')

            except Exception as e:
                print(f'[Feishu] 工作流执行失败: {e}')
                self._send_text(open_id, f'工作流执行失败: {e}')

        threading.Thread(target=_do_run, daemon=True).start()

    def _send_workflow_files(self, wf_status: dict, open_id: str):
        """发送工作流结果中包含的 PPTX 文件"""
        try:
            results = wf_status.get('results', {})
            if not results:
                return

            # 检查是否有 pptx_generate 步骤或文件路径
            for step_name, result_text in results.items():
                if not isinstance(result_text, str):
                    continue

                # 检查结果中是否提到 PPTX 文件路径
                import re
                pptx_match = re.search(r'(/[\w/\\\-]+\.(?:pptx|ppt))\b', result_text, re.IGNORECASE)
                if pptx_match:
                    file_path = pptx_match.group(1)
                    if os.path.exists(file_path):
                        self._send_text(open_id, '📎 正在发送 PPT 文件...')
                        if self._send_file(open_id, file_path):
                            self._send_text(open_id, '✅ PPT 文件发送成功！')
                        else:
                            self._send_text(open_id, '⚠️ PPT 文件发送失败')

        except Exception as e:
            print(f"[Feishu] 发送工作流文件失败: {e}")

    # ─── 查看工作流结果 ───

    def _check_workflow_results(self, open_id: str):
        """查看最近的工作流结果"""
        try:
            import requests as _req
            resp = _req.get('http://localhost:3001/api/workflow', timeout=10)
            if resp.ok:
                wf_list = resp.json().get('workflows', [])
                if wf_list:
                    latest = wf_list[0]
                    results = latest.get('results', {})
                    status = latest.get('status', '')

                    if status == 'running':
                        steps = latest.get('steps', [])
                        done = sum(1 for s in steps if s['status'] in ('completed', 'failed'))
                        self._send_text(open_id,
                            f'⏳ 工作流「{latest["name"]}」执行中... ({done}/{len(steps)} 步骤完成)')
                    elif results:
                        for step_name, result_text in results.items():
                            if isinstance(result_text, str) and result_text.strip():
                                self._send_text(open_id, f'📊 {step_name}')
                                time.sleep(0.3)
                                for i in range(0, len(result_text), 3500):
                                    self._send_text(open_id, result_text[i:i+3500])
                                    time.sleep(0.5)
                    else:
                        self._send_text(open_id,
                            f'工作流「{latest["name"]}」{status}，暂无结果。')
                else:
                    self._send_text(open_id, '暂无工作流记录。')
            else:
                self._send_text(open_id, '获取工作流结果失败。')
        except Exception as e:
            self._send_text(open_id, f'获取工作流结果失败: {e}')

    # ─── 查看分析工作台 ───

    def _show_session_summary(self, open_id: str):
        """查看分析工作台最近对话摘要"""
        if self._gateway:
            summary = self._gateway._build_session_summary()
        else:
            # 直接从后端获取
            try:
                import requests as _req
                resp = _req.get('http://localhost:3001/api/gateway/session-summary', timeout=5)
                if resp.ok:
                    summary = resp.json().get('summary', '当前分析工作台暂无对话内容。')
                else:
                    summary = '获取分析工作台摘要失败。'
            except Exception:
                summary = '获取分析工作台摘要失败，请检查后端是否运行。'

        for i in range(0, len(summary), 3500):
            self._send_text(open_id, summary[i:i+3500])
            time.sleep(0.3)

    # ─── 推送分析工作台结果 ───

    def _push_session_summary(self, open_id: str):
        """推送完整的分析工作台对话到飞书"""
        if self._gateway:
            full_summary = self._gateway._build_full_session_summary()
        else:
            full_summary = '当前分析工作台暂无对话内容。请先在前端进行分析工作台进行对话后再请求推送。'

        if '暂无对话内容' in full_summary:
            self._send_text(open_id, full_summary)
            return

        self._send_text(open_id, '📋 正在推送分析工作台内容...')
        for i in range(0, len(full_summary), 3500):
            self._send_text(open_id, full_summary[i:i+3500])
            time.sleep(0.5)

    # ─── 消息处理主入口 ───

    def _handle_message(self, message: dict):
        """处理收到的消息（文本 / 文件 / 图片）"""
        try:
            msg_id = message.get('message_id', '')
            if msg_id in self._seen_ids:
                return

            sender = message.get('sender', {})
            user_id = sender.get('sender_id', {}).get('open_id', '')
            if not user_id:
                user_id = sender.get('id', {}).get('open_id', '')

            if not self._check_permission(user_id):
                print(f"[Feishu] 未授权用户: {user_id}")
                return

            # 记录用户 ID（用于推送功能）
            self._last_user_open_id = user_id

            # 记录消息 ID（去重）
            self._seen_ids.add(msg_id)
            self._save_dedup()

            # 检测文件消息
            if self._is_file_message(message):
                self._handle_file_message(message, user_id)
                return

            # 检测图片消息
            if self._is_image_message(message):
                self._send_text(user_id, '📎 已收到图片，但暂不支持图片分析。请发送 PDF 或 Word 文档。')
                return

            # 提取文本
            text = self._extract_text(message)
            if not text:
                # 其他非文本消息
                msg_type = message.get('msg_type', '')
                print(f"[Feishu] 忽略 {msg_type} 类型消息 from {user_id}")
                self._send_text(user_id, f'⚠️ 暂不支持 {msg_type} 类型消息。请发送文本或 PDF/DOCX 文件。')
                return

            text_stripped = text.strip()
            print(f"[Feishu] 收到消息 from {user_id}: {text_stripped[:80]}")

            # 处理 /help 指令
            if text_stripped == '/help':
                self._send_help(user_id)
                return

            # 处理 /status 指令
            if text_stripped == '/status':
                self._send_status(user_id)
                return

            # 检测"查看分析工作台"意图
            if any(kw in text_stripped for kw in ['分析工作台', '工作台内容', '分析了什么', '当前分析', '查看工作台']):
                self._show_session_summary(user_id)
                return

            # 检测"推送工作台结果"意图
            if any(kw in text_stripped for kw in ['发送结果', '推送结果', '把分析发给我', '发给我', '推送工作台', '结果发给我', '推送给我']):
                self._push_session_summary(user_id)
                return

            # ── 工作流命令检测 ──
            wf_commands = {
                '案例速读': 'quick-read',
                '速读': 'quick-read',
                'swot分析': 'swot',
                'swot': 'swot',
                '深度洞察': 'deep-insight',
                '洞察': 'deep-insight',
                'ppt大纲': 'ppt-outline',
                '生成ppt': 'ppt-outline',
                '全流程': 'full-pipeline',
                '全流程分析': 'full-pipeline',
                '一键分析': 'full-pipeline',
            }
            workflow_match = None
            wf_name = None
            for kw, tpl_id in wf_commands.items():
                if kw.lower() in text_stripped.lower():
                    workflow_match = tpl_id
                    wf_name = kw
                    break

            if workflow_match:
                tpl_names = {
                    'quick-read': '案例速读',
                    'swot': 'SWOT分析',
                    'deep-insight': '深度洞察',
                    'ppt-outline': 'PPT大纲',
                    'full-pipeline': '全流程分析'
                }
                display_name = tpl_names.get(workflow_match, workflow_match)
                self._send_text(user_id, f'🚀 正在启动「{display_name}」工作流...')
                self._run_workflow(workflow_match, display_name, user_id)
                return

            # 检测"查看工作流结果"
            if any(kw in text_stripped for kw in ['查看结果', '工作流结果', '执行结果']):
                self._check_workflow_results(user_id)
                return

            # 其他文本 → 转发给 LLM
            def _reply():
                try:
                    self._send_text(user_id, '💭 正在思考...')
                    response = self._call_llm(text_stripped)
                    if response:
                        response = self._clean_response(response)
                        max_len = 3500
                        for i in range(0, len(response), max_len):
                            self._send_text(user_id, response[i:i+max_len])
                            time.sleep(0.5)
                except Exception as e:
                    print(f"[Feishu] LLM 回复失败: {e}")
                    self._send_text(user_id, '抱歉，回复失败了，请重试。')

            threading.Thread(target=_reply, daemon=True).start()

        except Exception as e:
            print(f"[Feishu] 处理消息错误: {e}")

    # ─── 处理文件消息 ───

    def _handle_file_message(self, message: dict, open_id: str):
        """处理文件消息：下载 → 分析 → 返回结果"""
        try:
            # 提取文件名
            content = message.get('content', '')
            file_name = 'unknown_file'
            try:
                content_data = json.loads(content)
                file_name = content_data.get('file_name', 'unknown_file')
            except Exception:
                pass

            doc_exts = ('.pdf', '.docx', '.doc', '.txt', '.md')
            is_doc = any(file_name.lower().endswith(ext) for ext in doc_exts)

            if not is_doc:
                self._send_text(open_id,
                    f'📎 已收到文件 "{file_name}"，但暂不支持该类型的分析。请发送 PDF 或 Word 文档。')
                return

            # 异步下载并分析
            self._send_text(open_id, f'📄 文件已收到，正在下载和分析 {file_name}...')

            def _download_and_analyze():
                try:
                    file_path = self._download_file(message)
                    if file_path:
                        print(f"[Feishu] 文件已下载: {file_path}")
                        self._analyze_file(file_path, open_id)
                    else:
                        # 详细诊断：逐步检查每个环节
                        diag = []
                        msg_id = message.get('message_id', '')
                        diag.append(f'📋 下载诊断:')
                        diag.append(f'message_id: {msg_id}')
                        diag.append(f'msg_type: {message.get("msg_type", "")}')
                        diag.append(f'content: {message.get("content", "")[:300]}')

                        # 测试 token
                        token = self._get_tenant_access_token()
                        if not token:
                            diag.append('❌ 获取 tenant_access_token 失败')
                        else:
                            diag.append(f'✅ token 获取成功 (长度={len(token)})')

                            # 测试解析 file_key
                            try:
                                c = json.loads(message.get('content', '{}'))
                                fk = c.get('file_key', '')
                                fn = c.get('file_name', '')
                                diag.append(f'file_key: {fk}')
                                diag.append(f'file_name: {fn}')
                            except Exception as e:
                                diag.append(f'❌ 解析 content 失败: {e}')

                            # 直接测试下载请求
                            if fk:
                                import requests
                                url = f"https://open.feishu.cn/open-apis/im/v1/messages/{msg_id}/resources/{fk}?type=file"
                                diag.append(f'URL: {url[:80]}...')
                                try:
                                    r = requests.get(url, headers={"Authorization": f"Bearer {token}"},
                                                     timeout=30, proxies={'http': '', 'https': ''})
                                    diag.append(f'HTTP: {r.status_code}')
                                    diag.append(f'ContentType: {r.headers.get("Content-Type", "")}')
                                    if 'json' in r.headers.get('Content-Type', ''):
                                        err = r.json()
                                        diag.append(f'Response: code={err.get("code")}, msg={err.get("msg")}')
                                    else:
                                        diag.append(f'Body大小: {len(r.content)} bytes')
                                except Exception as e:
                                    diag.append(f'❌ 请求异常: {e}')

                        self._send_text(open_id, '\n'.join(diag))
                except Exception as diag_e:
                    self._send_text(open_id, f'⚠️ 下载诊断异常: {diag_e}')
                    import traceback
                    traceback.print_exc()

            threading.Thread(target=_download_and_analyze, daemon=True).start()

        except Exception as e:
            err_safe = str(e).encode('utf-8', errors='replace').decode('utf-8', errors='replace')
            print(f"[Feishu] 处理文件消息错误: {err_safe}")
            self._send_text(open_id, f'文件处理失败: {e}')

    # ─── 帮助文本 ───

    def _send_help(self, open_id: str):
        """发送帮助信息（与微信Bot保持一致）"""
        help_text = (
            '📚 CaseBuddy 飞书助手\n\n'
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
            '• "发送结果" — 推送工作台结果到飞书\n\n'
            '🔧 管理指令：\n'
            '• /help — 显示帮助\n'
            '• /status — 查看状态\n\n'
            '💡 使用流程：先发PDF → 再发命令'
        )
        self._send_text(open_id, help_text)

    # ─── 状态查询 ───

    def _send_status(self, open_id: str):
        """发送状态信息"""
        status_text = (
            f'📊 CaseBuddy 飞书助手状态\n\n'
            f'✅ 飞书 Bot 已连接\n'
            f'🤖 LLM 后端：{self._llm_proxy_url}\n'
            f'👥 授权模式：{"公开" if self.public_access else f"白名单({len(self.allowed_users)}人)"}\n'
            f'📋 已处理消息：{len(self._seen_ids)} 条\n'
            f'📁 最后用户：{self._last_user_open_id or "无"}'
        )
        self._send_text(open_id, status_text)

    # ─── 停止 ───

    def stop(self):
        """停止 Bot"""
        self._running = False

    # ─── 运行 Bot（WebSocket 长连接） ───

    def run(self):
        """运行 Bot：建立 WebSocket 长连接并处理消息"""
        self._running = True
        self._token_cache = {}  # 初始化 token 缓存
        print(f"[Feishu] Bot 启动中 (app_id={self.app_id})")

        if not self.app_id or not self.app_secret:
            print("[Feishu] 配置不完整，请设置 app_id 和 app_secret")
            return

        try:
            self._load_dedup()
            self._client = self._build_client()

            # 创建事件分发器（lark_oapi 1.6.x 正确用法）
            from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
            event_handler = (EventDispatcherHandler.builder("", "")
                .register_p2_im_message_receive_v1(self._on_message_event)
                .build())

            # 创建 WebSocket 客户端（注意：是 lark_oapi.ws.Client，不是 lark.WSClient）
            from lark_oapi.ws import Client as WSClient
            ws_app = WSClient(
                self.app_id,
                self.app_secret,
                event_handler=event_handler,
                log_level=lark.LogLevel.INFO
            )

            print("[Feishu] 正在建立 WebSocket 长连接...")
            print("[Feishu] 等待接收消息... (按 Ctrl+C 停止)")

            # 启动 WebSocket（阻塞调用）
            ws_app.start()

        except KeyboardInterrupt:
            print("[Feishu] 收到退出信号")
        except Exception as e:
            print(f"[Feishu] Bot 错误: {e}")
            import traceback
            traceback.print_exc()
        finally:
            self._running = False
            self._save_dedup()
            print("[Feishu] Bot 已停止")

    # ─── 飞书 SDK 事件回调 ───

    def _on_message_event(self, data):
        """
        lark_oapi SDK 消息事件回调。
        data 类型: P2ImMessageReceiveV1
        数据结构: data.event.message (EventMessage) / data.event.sender (EventSender)
        """
        try:
            # SDK 将事件包装为 P2ImMessageReceiveV1 对象
            if data is None or data.event is None:
                return

            message = data.event.message
            sender = data.event.sender

            if message is None or sender is None:
                return

            # 构造统一的消息字典（兼容 _handle_message 接口）
            unified_message = {
                'message_id': message.message_id or '',
                'msg_type': message.message_type or '',
                'content': message.content or '',
                'sender': {
                    'sender_id': {
                        'open_id': sender.sender_id.open_id if sender.sender_id else '',
                        'user_id': sender.sender_id.user_id if sender.sender_id else '',
                    },
                    'id': {
                        'open_id': sender.sender_id.open_id if sender.sender_id else '',
                    },
                },
            }

            self._handle_message(unified_message)

        except Exception as e:
            print(f"[Feishu] 事件回调错误: {e}")
            import traceback
            traceback.print_exc()
