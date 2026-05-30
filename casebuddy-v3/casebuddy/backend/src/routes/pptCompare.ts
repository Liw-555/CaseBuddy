/**
 * PPT 对比分析 API 路由
 * - 解析上传的两个 PPT 文件
 * - 调用 LLM 进行多维度对比分析
 * - 历史记录持久化
 */

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import JSZip from 'jszip';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// 历史记录文件路径
const HISTORY_FILE = path.join(
  process.env.WORKSPACE_ROOT || path.join(os.homedir(), '.casebuddy'),
  'ppt_compare_history.json'
);

interface HistoryRecord {
  id: string;
  timestamp: string;
  caseBuddyFileName: string;
  awardFileName: string;
  overallScore: number;
  dimensions: { name: string; caseBuddyScore: number; awardScore: number }[];
  strengths: string[];
  weaknesses: string[];
  suggestions: string[];
  fullReport: string;
}

function loadHistory(): HistoryRecord[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[PPTCompare] 加载历史记录失败:', e);
  }
  return [];
}

function saveHistory(records: HistoryRecord[]): void {
  try {
    const dir = path.dirname(HISTORY_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2), 'utf-8');
  } catch (e) {
    console.error('[PPTCompare] 保存历史记录失败:', e);
  }
}

function addHistoryRecord(record: Omit<HistoryRecord, 'id' | 'timestamp'>): HistoryRecord {
  const records = loadHistory();
  const newRecord: HistoryRecord = {
    ...record,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
  };
  records.unshift(newRecord);
  // 保留最近 50 条
  if (records.length > 50) records.splice(50);
  saveHistory(records);
  return newRecord;
}

// 从 .env 或默认值获取 LLM 配置
function getLLMConfig() {
  return {
    baseUrl: process.env.LLM_BASE_URL || 'https://chat.ecnu.edu.cn/open/api/v1',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'ecnu-plus',
  };
}

/**
 * 纯 Node.js 解析 PPT/PPTX 文件（使用 JSZip，无需 Python）
 * .pptx 本质是 ZIP 包，直接解析 XML 提取文本
 */
async function parsePptx(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);

  const texts: string[] = [];

  // 读取 [Content_Types].xml 找到幻灯片文件名模式
  // 标准 pptx 的幻灯片在 ppt/slides/slide1.xml, slide2.xml, ...
  const slideFiles: { path: string; num: number }[] = [];
  zip.forEach((relativePath) => {
    const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (match) {
      slideFiles.push({ path: relativePath, num: parseInt(match[1]) });
    }
  });
  // 按幻灯片编号排序
  slideFiles.sort((a, b) => a.num - b.num);

  for (const sf of slideFiles) {
    const slidePath = sf.path;
    const slideXml = await zip.file(slidePath)?.async('string');
    if (!slideXml) continue;

    const slideNum = slidePath.match(/slide(\d+)\.xml$/)?.[1] || '?';
    texts.push(`=== 第${slideNum}页 ===`);

    // 提取所有 <a:t> 标签的文本内容（PPT XML 中的文本节点）
    const textRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
    let lastText = '';
    let match: RegExpExecArray | null;
    while ((match = textRegex.exec(slideXml)) !== null) {
      const t = match[1].trim();
      if (t) {
        // 如果当前文本和上一个文本之间没有分隔符，可能属于同一段落
        texts.push(t);
        lastText = t;
      }
    }

    // 提取表格内容
    const tableRegex = /<a:tbl[^>]*>([\s\S]*?)<\/a:tbl>/g;
    let tableMatch: RegExpExecArray | null;
    while ((tableMatch = tableRegex.exec(slideXml)) !== null) {
      const tableXml = tableMatch[1];
      const rows: string[] = [];
      const rowRegex = /<a:tr[^>]*>([\s\S]*?)<\/a:tr>/g;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowRegex.exec(tableXml)) !== null) {
        const rowXml = rowMatch[1];
        const cells: string[] = [];
        const cellRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const cellText = cellMatch[1].trim();
          if (cellText) cells.push(cellText);
        }
        if (cells.length > 0) {
          rows.push(cells.join(' | '));
        }
      }
      if (rows.length > 0) {
        texts.push('\n' + rows.join('\n'));
      }
    }

    texts.push(''); // 幻灯片之间空行
  }

  return texts.join('\n');
}

/**
 * 解析 PPT 文件入口（自动识别格式）
 */
async function parsePptFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pptx') {
    return parsePptx(filePath);
  }
  // .ppt 格式（旧版二进制）不支持，提示用户转换
  if (ext === '.ppt') {
    throw new Error('不支持 .ppt 格式，请将文件另存为 .pptx 格式后重试');
  }
  throw new Error(`不支持的文件格式: ${ext}，请上传 .pptx 文件`);
}

/**
 * POST /api/ppt-compare/parse
 * 上传并解析两个 PPT 文件
 */
router.post('/parse', upload.fields([
  { name: 'casebuddy', maxCount: 1 },
  { name: 'award', maxCount: 1 },
]), async (req: Request, res: Response) => {
  try {
    const files = req.files as { [fieldname: string]: Express.Multer.File[] };
    if (!files?.casebuddy?.[0] || !files?.award?.[0]) {
      res.status(400).json({ error: '请上传两个 PPT 文件' });
      return;
    }

    const caseBuddyFile = files.casebuddy[0];
    const awardFile = files.award[0];

    // 保存到临时目录
    const tempDir = path.join(os.tmpdir(), 'pptcompare_' + Date.now());
    fs.mkdirSync(tempDir, { recursive: true });

    const caseBuddyPath = path.join(tempDir, 'casebuddy_' + caseBuddyFile.originalname);
    const awardPath = path.join(tempDir, 'award_' + awardFile.originalname);

    fs.writeFileSync(caseBuddyPath, caseBuddyFile.buffer);
    fs.writeFileSync(awardPath, awardFile.buffer);

    try {
      const caseBuddyText = await parsePptFile(caseBuddyPath);
      const awardText = await parsePptFile(awardPath);

      // 清理临时文件
      fs.rmSync(tempDir, { recursive: true, force: true });

      res.json({ caseBuddyText, awardText });
    } catch (parseErr) {
      // 清理临时文件
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
      throw parseErr;
    }
  } catch (error) {
    console.error('[PPTCompare] 解析错误:', error);
    res.status(500).json({
      error: 'PPT 解析失败',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /api/ppt-compare/analyze
 * 调用 LLM 进行对比分析
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { caseBuddyText, awardText, caseBuddyFileName, awardFileName } = req.body;
    if (!caseBuddyText || !awardText) {
      res.status(400).json({ error: '缺少 PPT 文本内容' });
      return;
    }

    const llm = getLLMConfig();
    const prompt = `你是一位资深的 MBA 案例竞赛 PPT 评审专家。请对比分析以下两个 PPT 的内容，给出专业的对比分析和改进建议。

【CaseBuddy 生成的 PPT 内容】
${caseBuddyText.slice(0, 8000)}

【获奖优质 PPT 内容】
${awardText.slice(0, 8000)}

请从以下维度进行对比分析，并以 JSON 格式返回（不要包含 markdown 代码块标记）：

{
  "overallScore": 数字(1-10)，
  "dimensions": [
    {
      "name": "维度名称",
      "caseBuddyScore": 数字(1-10)，
      "awardScore": 数字(1-10)，
      "comment": "对比评论（中文，不超过100字）",
      "suggestions": ["改进建议1", "改进建议2"]
    }
  ],
  "strengths": ["CaseBuddy PPT 的优势1", "优势2"],
  "weaknesses": ["CaseBuddy PPT 的待改进点1", "待改进点2"],
  "suggestions": ["具体改进方案1", "方案2", "方案3"],
  "fullReport": "完整的对比分析报告（Markdown 格式，包含：整体评价、各维度详细对比、具体改进建议、示例修改方案）"
}

维度必须包含以下 6 个方面：
1. 内容结构与逻辑
2. 视觉设计与排版
3. 逻辑表达与论证
4. 数据呈现与分析深度
5. 创新性与亮点
6. 实战答辩适配性

请确保 fullReport 字段是完整的 Markdown 格式报告，长度至少 1000 字。`;

    const response = await fetch(`${llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llm.apiKey}`,
      },
      body: JSON.stringify({
        model: llm.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 8000,
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: `LLM 请求失败: ${errText}` });
      return;
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // 提取 JSON（处理可能的 markdown 代码块）
    let jsonStr = content;
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1];
    }

    try {
      const result = JSON.parse(jsonStr.trim());
      // 保存到历史记录
      try {
        addHistoryRecord({
          caseBuddyFileName: caseBuddyFileName || '未知文件',
          awardFileName: awardFileName || '未知文件',
          overallScore: typeof result.overallScore === 'number' ? result.overallScore : parseFloat(result.overallScore) || 5,
          dimensions: result.dimensions || [],
          strengths: result.strengths || [],
          weaknesses: result.weaknesses || [],
          suggestions: result.suggestions || [],
          fullReport: result.fullReport || content || '',
        });
      } catch (e) {
        console.error('[PPTCompare] 保存历史记录失败:', e);
      }
      res.json(result);
    } catch (parseErr) {
      // JSON 解析失败，也保存基本记录（用原始文本作为报告）
      console.error('[PPTCompare] JSON 解析失败，返回原始内容');
      try {
        addHistoryRecord({
          caseBuddyFileName: caseBuddyFileName || '未知文件',
          awardFileName: awardFileName || '未知文件',
          overallScore: 5,
          dimensions: [],
          strengths: [],
          weaknesses: [],
          suggestions: [],
          fullReport: content || '分析结果解析失败，请重试',
        });
      } catch (e) {
        console.error('[PPTCompare] 保存历史记录失败:', e);
      }
      res.json({
        overallScore: 5,
        dimensions: [],
        strengths: [],
        weaknesses: [],
        suggestions: [],
        fullReport: content || '分析结果解析失败，请重试',
      });
    }
  } catch (error) {
    console.error('[PPTCompare] 分析错误:', error);
    // 即使出错也保存基本历史记录
    try {
      addHistoryRecord({
        caseBuddyFileName: req.body?.caseBuddyFileName || '未知文件',
        awardFileName: req.body?.awardFileName || '未知文件',
        overallScore: 0,
        dimensions: [],
        strengths: [],
        weaknesses: [],
        suggestions: [],
        fullReport: `分析失败: ${error instanceof Error ? error.message : String(error)}`,
      });
      console.log('[PPTCompare] 已在 catch 分支保存失败记录');
    } catch (saveErr) {
      console.error('[PPTCompare] catch 分支保存历史记录也失败:', saveErr);
    }
    res.status(500).json({
      error: '对比分析失败',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * GET /api/ppt-compare/history — 获取历史对比记录
 */
router.get('/history', (_req: Request, res: Response) => {
  try {
    const records = loadHistory();
    // 返回摘要列表（不含 fullReport，减少传输量）
    const summaries = records.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      caseBuddyFileName: r.caseBuddyFileName,
      awardFileName: r.awardFileName,
      overallScore: r.overallScore,
      dimensions: r.dimensions,
      strengths: r.strengths,
      weaknesses: r.weaknesses,
      suggestions: r.suggestions,
    }));
    res.json(summaries);
  } catch (e) {
    res.status(500).json({ error: '获取历史记录失败' });
  }
});

/**
 * GET /api/ppt-compare/history/:id — 获取单条记录的完整详情
 */
router.get('/history/:id', (req: Request, res: Response) => {
  try {
    const records = loadHistory();
    const record = records.find((r) => r.id === req.params.id);
    if (!record) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }
    res.json(record);
  } catch (e) {
    res.status(500).json({ error: '获取历史记录详情失败' });
  }
});

/**
 * DELETE /api/ppt-compare/history/:id — 删除指定记录
 */
router.delete('/history/:id', (req: Request, res: Response) => {
  try {
    let records = loadHistory();
    const newRecords = records.filter((r) => r.id !== req.params.id);
    if (newRecords.length === records.length) {
      res.status(404).json({ error: '记录不存在' });
      return;
    }
    saveHistory(newRecords);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '删除历史记录失败' });
  }
});

/**
 * DELETE /api/ppt-compare/history — 清空全部历史
 */
router.delete('/history', (_req: Request, res: Response) => {
  try {
    saveHistory([]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: '清空历史记录失败' });
  }
});

export default router;