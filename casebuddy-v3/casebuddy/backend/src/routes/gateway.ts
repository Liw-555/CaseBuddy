/**
 * 网关管理 API 路由
 * 提供网关配置、启停等管理接口
 * 支持企业微信（Node.js）和微信/QQ/飞书（Python 服务）
 */

import { Router, Request, Response } from 'express';
import { loadGatewayConfig, saveGatewayConfig, GatewayConfigFile } from '../gateway';
import path from 'path';
import multer from 'multer';
import * as pdfParseType from 'pdf-parse';
// @ts-ignore - CommonJS default export
const pdfParse: (buf: Buffer) => Promise<{ text: string }> = pdfParseType as any;

const router = Router();

// 文件上传配置（内存存储）
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Python 网关服务地址
const PYTHON_GATEWAY_URL = 'http://127.0.0.1:3002';

/**
 * 代理请求到 Python 网关服务
 */
async function proxyToPython(endpoint: string, method: string = 'GET', body?: any): Promise<{ ok: boolean; data?: any; error?: string }> {
  try {
    const opts: any = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (body) {
      opts.body = JSON.stringify(body);
    }

    const resp = await fetch(`${PYTHON_GATEWAY_URL}/${endpoint}`, opts);
    const data = await resp.json();
    return { ok: resp.ok, data };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '连接 Python 网关失败' };
  }
}

/**
 * GET /api/gateway/status
 * 获取网关状态（合并 Node.js 企业微信 + Python 服务的状态）
 */
router.get('/status', async (req: Request, res: Response) => {
  // 从 Python 服务获取状态
  const pythonStatus = await proxyToPython('status');

  // Node.js 企业微信状态（需要从 gateway manager 获取）
  let wecomStatus = { enabled: false, logged_in: false };

  try {
    const config = loadGatewayConfig();
    if (config.gateways?.wecom) {
      wecomStatus = {
        enabled: config.gateways.wecom.enabled || false,
        logged_in: false // 运行时状态需要从 manager 获取
      };
    }
  } catch {
    // 忽略错误
  }

  const nodeRunning = pythonStatus.data?.running || false;
  const connectedPlatforms = pythonStatus.data?.connectedPlatforms || [];
  if (wecomStatus.logged_in && !connectedPlatforms.includes('wecom')) {
    connectedPlatforms.push('wecom');
  }

  res.json({
    running: nodeRunning || wecomStatus.enabled,
    connectedPlatforms,
    totalMessages: pythonStatus.data?.totalMessages || 0,
    bots: {
      wechat: pythonStatus.data?.bots?.wechat || { enabled: false, logged_in: false },
      qq: pythonStatus.data?.bots?.qq || { enabled: false, logged_in: false },
      feishu: pythonStatus.data?.bots?.feishu || { enabled: false, logged_in: false },
      wecom: wecomStatus
    }
  });
});

/**
 * POST /api/gateway/start
 * 启动网关
 */
router.post('/start', async (req: Request, res: Response) => {
  // 启动 Python 服务中的 Bot
  const result = await proxyToPython('start', 'POST');

  if (result.ok) {
    res.json({
      success: true,
      message: '网关启动成功',
      details: '微信/QQ/飞书 Bot 正在启动'
    });
  } else {
    // Python 服务未运行也可以继续
    res.json({
      success: true,
      message: '已通知启动',
      warning: result.error || 'Python 网关服务可能未运行'
    });
  }
});

/**
 * POST /api/gateway/stop
 * 停止网关
 */
router.post('/stop', async (req: Request, res: Response) => {
  const result = await proxyToPython('stop', 'POST');

  res.json({
    success: true,
    message: '网关已停止'
  });
});

/**
 * GET /api/gateway/config
 * 获取网关配置
 */
router.get('/config', async (req: Request, res: Response) => {
  // 从 Python 服务获取配置
  const pythonConfig = await proxyToPython('config');

  // 从 Node.js 获取企业微信配置
  const config = loadGatewayConfig();

  res.json({
    gateways: {
      wechat: pythonConfig.data?.gateways?.wechat || { enabled: false },
      qq: pythonConfig.data?.gateways?.qq || { enabled: false, appId: '', allowedUsers: [] },
      feishu: pythonConfig.data?.gateways?.feishu || { enabled: false, appId: '', allowedUsers: [] },
      wecom: config.gateways?.wecom ? {
        enabled: config.gateways.wecom.enabled,
        hasCredentials: !!(config.gateways.wecom.botId && config.gateways.wecom.secret)
      } : null
    },
    llm: config.llm
  });
});

/**
 * POST /api/gateway/config/wechat
 * 配置微信
 */
router.post('/config/wechat', async (req: Request, res: Response) => {
  const { enabled } = req.body;
  const result = await proxyToPython('config/wechat', 'POST', { enabled });

  res.json(result.data || { status: 'ok', message: '微信配置已更新' });
});

/**
 * POST /api/gateway/config/qq
 * 配置 QQ
 */
router.post('/config/qq', async (req: Request, res: Response) => {
  const { enabled, appId, secret, allowedUsers } = req.body;
  const result = await proxyToPython('config/qq', 'POST', {
    enabled,
    appId,
    secret,
    allowedUsers: allowedUsers || []
  });

  res.json(result.data || { status: 'ok', message: 'QQ 配置已更新' });
});

/**
 * POST /api/gateway/config/feishu
 * 配置飞书
 */
router.post('/config/feishu', async (req: Request, res: Response) => {
  const { enabled, appId, secret, allowedUsers } = req.body;
  const result = await proxyToPython('config/feishu', 'POST', {
    enabled,
    appId,
    secret,
    allowedUsers: allowedUsers || []
  });

  res.json(result.data || { status: 'ok', message: '飞书配置已更新' });
});

/**
 * POST /api/gateway/config/wecom
 * 配置企业微信
 */
router.post('/config/wecom', (req: Request, res: Response) => {
  try {
    const { enabled, botId, secret, welcomeMessage, allowedUsers } = req.body;

    const existingConfig = loadGatewayConfig();

    const wecomConfig = {
      enabled: enabled ?? existingConfig.gateways?.wecom?.enabled ?? false,
      botId: botId || existingConfig.gateways?.wecom?.botId || '',
      secret: secret || existingConfig.gateways?.wecom?.secret || '',
      welcomeMessage: welcomeMessage || existingConfig.gateways?.wecom?.welcomeMessage || '您好！我是 CaseBuddy MBA 案例分析助手。',
      allowedUsers: allowedUsers || existingConfig.gateways?.wecom?.allowedUsers || []
    };

    const newConfig = {
      gateways: {
        ...existingConfig.gateways,
        wecom: wecomConfig
      },
      llm: existingConfig.llm
    };

    saveGatewayConfig(newConfig);

    res.json({
      success: true,
      message: '企业微信配置已保存',
      config: {
        enabled: wecomConfig.enabled,
        hasCredentials: !!(wecomConfig.botId && wecomConfig.secret)
      }
    });
  } catch (error) {
    console.error('[Gateway API] 保存企业微信配置失败:', error);
    res.status(500).json({
      error: '保存配置失败',
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
});

/**
 * GET /api/gateway/qrcode
 * 获取微信登录二维码（返回图片）
 */
router.get('/qrcode', async (req: Request, res: Response) => {
  try {
    // 直接读取 Python 网关 temp 目录中的二维码图片
    // 使用绝对路径
    const qrPath = path.resolve(__dirname, '../../../gateway-python/temp/wx_qr.png');
    console.log('[Gateway] 检查二维码路径:', qrPath);
    console.log('[Gateway] 文件是否存在:', require('fs').existsSync(qrPath));
    
    if (require('fs').existsSync(qrPath)) {
      // 返回图片
      const buffer = require('fs').readFileSync(qrPath);
      console.log('[Gateway] 读取二维码图片成功，大小:', buffer.length);
      res.set('Content-Type', 'image/png');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(buffer);
    } else {
      // 图片不存在，返回 JSON
      console.log('[Gateway] 二维码图片不存在，返回 JSON');
      res.json({ status: 'no_qrcode', message: '暂无二维码，请先启动微信 Bot' });
    }
  } catch (error) {
    console.error('[Gateway] 获取二维码失败:', error);
    res.json({ status: 'error', message: '获取二维码失败：' + (error instanceof Error ? error.message : '未知错误') });
  }
});

/**
 * POST /api/gateway/start/wechat
 * 启动微信 Bot（触发扫码）
 */
router.post('/start/wechat', async (req: Request, res: Response) => {
  const result = await proxyToPython('start/wechat', 'POST');
  res.json(result.data || { status: 'ok', message: '微信 Bot 启动中' });
});

/**
 * POST /api/gateway/logout/wechat
 * 退出微信登录
 */
router.post('/logout/wechat', async (req: Request, res: Response) => {
  const result = await proxyToPython('logout/wechat', 'POST');
  res.json(result.data || { status: 'ok', message: '微信已退出登录' });
});

// ============= 微信助手专用 LLM 聊天端点 =============
// 供 Python 网关和前端微信助手页面调用
// 注意：此端点使用默认模型配置（与前端共享同一配置）
// 使用函数延迟求值，避免模块加载时 process.env 尚未被 dotenv 填充

function getLLMConfig() {
  return {
    baseUrl: process.env.LLM_BASE_URL || 'https://chat.ecnu.edu.cn/open/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'ecnu-plus',
  };
}

/**
 * POST /api/gateway/chat
 * 网关专用聊天端点（非流式，直接返回文本）
 * 供 Python 网关转发微信消息给 LLM
 */
router.post('/chat', async (req: Request, res: Response) => {
  const { message, systemPrompt } = req.body as { message?: string; systemPrompt?: string };

  if (!message) {
    res.status(400).json({ error: '缺少 message 参数' });
    return;
  }

  const { baseUrl, apiKey, model } = getLLMConfig();

  // 构建 messages
  const messages: { role: string; content: string }[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: message as string });

  try {
    console.log(`[Gateway-Chat] 收到消息: ${(message as string).slice(0, 50)}...`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4000,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Gateway-Chat] LLM 调用失败: ${response.status} ${errText}`);
      res.status(response.status).json({ error: `LLM 调用失败: ${errText.slice(0, 200)}` });
      return;
    }

    const data = await response.json() as any;
    const text = data?.choices?.[0]?.message?.content || '';

    console.log(`[Gateway-Chat] 响应长度: ${text.length}`);
    res.json({ response: text });

  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误';
    console.error(`[Gateway-Chat] 异常: ${msg}`);
    res.status(500).json({ error: `处理失败: ${msg}` });
  }
});

/**
 * POST /api/gateway/push-wechat
 * 从前端推送内容到微信（需要 Python 网关已登录）
 */
router.post('/push-wechat', async (req: Request, res: Response) => {
  const { content, title } = req.body as { content?: string; title?: string };

  if (!content) {
    res.status(400).json({ error: '缺少 content 参数' });
    return;
  }

  // 转发到 Python 网关发送
  const result = await proxyToPython('push-wechat', 'POST', { content, title });
  res.json(result.data || { status: 'ok' });
});

/**
 * GET /api/gateway/push-history
 * 获取推送历史记录
 */
router.get('/push-history', async (req: Request, res: Response) => {
  const result = await proxyToPython('push-history', 'GET');
  if (result.ok) {
    res.json(result.data || []);
  } else {
    res.status(502).json({ error: result.error || 'Python 网关不可用' });
  }
});

/**
 * POST /api/gateway/sync-session
 * 前端同步分析工作台 session 摘要到 Python 网关
 */
router.post('/sync-session', async (req: Request, res: Response) => {
  const { messages } = req.body as { messages?: Array<{ role: string; content: string }> };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: '缺少 messages 参数' });
    return;
  }

  const result = await proxyToPython('sync-session', 'POST', { messages });
  res.json(result.data || { status: 'ok' });
});

/**
 * GET /api/gateway/session-summary
 * 获取缓存的 session 摘要（用于微信 Bot）
 */
router.get('/session-summary', async (req: Request, res: Response) => {
  const result = await proxyToPython('session-summary', 'GET');
  if (result.ok) {
    res.json(result.data || { summary: '' });
  } else {
    res.status(502).json({ error: result.error || 'Python 网关不可用' });
  }
});

/**
 * POST /api/gateway/analyze-file
 * 接收文件上传并使用 LLM 分析
 */
router.post('/analyze-file', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file && !req.body?.content) {
      res.status(400).json({ error: '未收到文件' });
      return;
    }

    let textContent = '';

    if (req.file) {
      // 如果是文件，提取文本
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext === '.pdf') {
        // 简单提取 PDF 文本（前 5000 字）
        const pdfData = await pdfParse(req.file!.buffer);
        textContent = (pdfData as any).text?.slice(0, 5000) || '';
      } else if (ext === '.txt' || ext === '.md') {
        textContent = req.file.buffer.toString('utf-8').slice(0, 5000);
      } else {
        textContent = req.file.buffer.toString('utf-8').slice(0, 5000);
      }
    } else {
      textContent = req.body.content.slice(0, 5000);
    }

    if (!textContent.trim()) {
      res.json({ analysis: '⚠️ 无法从文件中提取有效文本内容。' });
      return;
    }

    // 调用 LLM 分析
    const { baseUrl, apiKey, model } = getLLMConfig();
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'user', content: `请对以下文件内容进行简要分析，提取关键信息（要点总结、核心数据、主要发现）：\n\n${textContent}` }
        ],
        temperature: 0.5,
        max_tokens: 2000,
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (response.ok) {
      const data: any = await response.json();
      const analysis = data.choices?.[0]?.message?.content || '分析完成但未返回结果';
      res.json({ analysis });
    } else {
      res.status(500).json({ analysis: `LLM 分析失败: ${response.status}` });
    }
  } catch (error) {
    console.error('[Gateway] 文件分析错误:', error);
    res.status(500).json({ analysis: `分析出错: ${error instanceof Error ? error.message : '未知错误'}` });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 持久化存储：会话 + 案例知识卡片 + 活跃案例上下文
// ─────────────────────────────────────────────────────────────────────────────

import * as fs from 'fs';
import * as pathNode from 'path';
import * as os from 'os';

const MEMORY_DIR = pathNode.join(os.homedir(), '.casebuddy', 'memory');
const SESSIONS_FILE = pathNode.join(MEMORY_DIR, 'sessions.json');
const CARDS_FILE = pathNode.join(MEMORY_DIR, 'case_cards.json');
const ACTIVE_CASE_FILE = pathNode.join(MEMORY_DIR, 'active_case.json');

function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

function readJson<T>(filePath: string, defaultVal: T): T {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch { /* ignore */ }
  return defaultVal;
}

function writeJson(filePath: string, data: unknown) {
  ensureMemoryDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── 会话持久化 ───

/**
 * POST /api/gateway/session/save
 * 前端保存完整 session 到后端文件系统（跨 localStorage 持久化）
 */
router.post('/session/save', (req: Request, res: Response) => {
  try {
    const session = req.body;
    if (!session?.id) { res.status(400).json({ error: '缺少 session.id' }); return; }
    const sessions = readJson<Record<string, unknown>>(SESSIONS_FILE, {});
    sessions[session.id] = { ...session, savedAt: Date.now() };
    // 只保留最近 50 个会话
    const keys = Object.keys(sessions).sort((a, b) => {
      const sa = sessions[a] as any;
      const sb = sessions[b] as any;
      return (sb.savedAt || 0) - (sa.savedAt || 0);
    });
    if (keys.length > 50) keys.slice(50).forEach(k => delete sessions[k]);
    writeJson(SESSIONS_FILE, sessions);
    res.json({ ok: true, id: session.id });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/gateway/session/list
 * 返回所有保存的会话列表（只含摘要，不含 messages 全文）
 */
router.get('/session/list', (req: Request, res: Response) => {
  try {
    const sessions = readJson<Record<string, any>>(SESSIONS_FILE, {});
    const list = Object.values(sessions).map(s => ({
      id: s.id,
      title: s.title,
      caseTitle: s.title,
      messageCount: s.messages?.length || 0,
      savedAt: s.savedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    res.json({ sessions: list });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/gateway/session/:id
 * 返回完整 session（含 messages）
 */
router.get('/session/:id', (req: Request, res: Response) => {
  try {
    const sessions = readJson<Record<string, any>>(SESSIONS_FILE, {});
    const session = sessions[req.params.id];
    if (!session) { res.status(404).json({ error: '会话不存在' }); return; }
    res.json(session);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── 案例知识卡片 ───

interface CaseCard {
  id: string;
  company: string;
  industry: string;
  coreProblem: string;
  keyData: string[];
  insights: string[];
  caseId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * POST /api/gateway/case-card/generate
 * 用 LLM 从案例文本中提取结构化知识卡片
 */
router.post('/case-card/generate', async (req: Request, res: Response) => {
  try {
    const { caseId, caseText, title, sessionId } = req.body as {
      caseId: string; caseText: string; title?: string; sessionId?: string;
    };
    if (!caseId || !caseText) { res.status(400).json({ error: '缺少 caseId 或 caseText' }); return; }

    // 调用 LLM 提取卡片信息
    const llmCfg = {
      baseUrl: process.env.LLM_BASE_URL || 'https://chat.ecnu.edu.cn/open/api/v1',
      apiKey: process.env.LLM_API_KEY || '',  // 必须通过 .env 配置
      model: process.env.LLM_MODEL || 'ecnu-plus',
    };

    const prompt = `请从以下MBA案例文本中提取结构化信息，用JSON格式返回，不要添加任何markdown代码块标记，直接返回JSON对象：

{
  "company": "公司名称",
  "industry": "所属行业",
  "coreProblem": "核心战略问题（一句话，30字以内）",
  "keyData": ["关键数据1（含数值）", "关键数据2", "关键数据3", "关键数据4", "关键数据5"],
  "insights": ["核心洞察1", "核心洞察2", "核心洞察3"]
}

案例标题：${title || ''}
案例内容（前2000字）：
${caseText.slice(0, 2000)}`;

    const resp = await fetch(`${llmCfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmCfg.apiKey}` },
      body: JSON.stringify({
        model: llmCfg.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(30000),
    });

    let cardData: Partial<CaseCard> = {};
    if (resp.ok) {
      const data: any = await resp.json();
      const raw = data?.choices?.[0]?.message?.content || '';
      try {
        // 提取JSON（去除可能的markdown包装）
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) cardData = JSON.parse(jsonMatch[0]);
      } catch { /* fallback */ }
    }

    const card: CaseCard = {
      id: caseId,
      company: cardData.company || title || '未知公司',
      industry: cardData.industry || '未分类',
      coreProblem: cardData.coreProblem || '核心战略问题待提取',
      keyData: cardData.keyData || [],
      insights: cardData.insights || [],
      caseId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 保存卡片
    const cards = readJson<Record<string, CaseCard>>(CARDS_FILE, {});
    cards[caseId] = card;
    writeJson(CARDS_FILE, cards);

    // 同时更新活跃案例
    writeJson(ACTIVE_CASE_FILE, { caseId, title: card.company, caseText, sessionId, updatedAt: Date.now() });

    res.json(card);
  } catch (e) {
    console.error('[CaseCard] 生成失败:', e);
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/gateway/case-card/list
 * 返回所有知识卡片列表
 */
router.get('/case-card/list', (req: Request, res: Response) => {
  try {
    const cards = readJson<Record<string, CaseCard>>(CARDS_FILE, {});
    const list = Object.values(cards).sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ cards: list });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/gateway/case-card/:id
 * 返回单个知识卡片
 */
router.get('/case-card/:id', (req: Request, res: Response) => {
  try {
    const cards = readJson<Record<string, CaseCard>>(CARDS_FILE, {});
    const card = cards[req.params.id];
    if (!card) { res.status(404).json({ error: '卡片不存在' }); return; }
    res.json(card);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * DELETE /api/gateway/case-card/:id
 * 删除单个知识卡片
 */
router.delete('/case-card/:id', (req: Request, res: Response) => {
  try {
    const cards = readJson<Record<string, CaseCard>>(CARDS_FILE, {});
    const id = req.params.id;
    if (!cards[id]) { res.status(404).json({ error: '卡片不存在' }); return; }
    delete cards[id];
    writeJson(CARDS_FILE, cards);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── 活跃案例上下文（Bot绑定） ───

/**
 * POST /api/gateway/active-case
 * 设置当前活跃案例（发PDF后调用，Bot收到后续命令时使用）
 */
router.post('/active-case', (req: Request, res: Response) => {
  try {
    const { caseId, title, caseText, sessionId } = req.body;
    if (!caseId) { res.status(400).json({ error: '缺少 caseId' }); return; }
    writeJson(ACTIVE_CASE_FILE, { caseId, title, caseText, sessionId, updatedAt: Date.now() });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/**
 * GET /api/gateway/active-case
 * 获取当前活跃案例（Bot使用）
 */
router.get('/active-case', (req: Request, res: Response) => {
  try {
    const ac = readJson<any>(ACTIVE_CASE_FILE, null);
    if (!ac) { res.json({ hasActiveCase: false }); return; }
    // 返回摘要（不返回完整caseText避免过大）
    res.json({
      hasActiveCase: true,
      caseId: ac.caseId,
      title: ac.title,
      sessionId: ac.sessionId,
      updatedAt: ac.updatedAt,
      caseTextPreview: ac.caseText?.slice(0, 200) || '',
      caseText: ac.caseText || '',
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
