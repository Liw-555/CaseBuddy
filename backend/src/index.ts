import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import chatRoutes from './routes/chat';
import pptMasterRoutes from './routes/pptMaster';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/ppt-master', pptMasterRoutes);

// Proxy route for LLM APIs (non-streaming)
app.post('/api/proxy/chat/completions', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, max_tokens = 4000 } = req.body;

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
        temperature,
        max_tokens,
        stream: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      const text = await response.text();
      res.status(response.status).json({ error: text || `HTTP ${response.status}` });
      return;
    }

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: errMsg });
  }
});

// Proxy route for LLM APIs (SSE streaming)
app.post('/api/proxy/chat/completions/stream', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, messages, temperature = 0.7, max_tokens = 4000 } = req.body;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).json({ error: err });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Forward the stream using Node.js compatible approach
    if (!response.body) {
      res.status(500).json({ error: 'No response body' });
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // Node.js fetch returns a NodeJS.ReadableStream, use for-await-of
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          res.write(`data: ${data}\n\n`);
        }
      }
    }

    res.end();
  } catch (error) {
    console.error('Stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    } else {
      res.write(`data: ${JSON.stringify({ error: String(error) })}\n\n`);
      res.end();
    }
  }
});

// File upload and parse endpoints
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, TabStopType, TabStopPosition
} from 'docx';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Only PDF and DOCX are supported.`));
    }
  },
});

app.post('/api/parse/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const buffer = req.file.buffer;
    const mimetype = req.file.mimetype;
    let text = '';
    let pageCount = 0;

    if (mimetype === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      text = result.text;
      pageCount = result.total;
      await parser.destroy();
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
      pageCount = 1;
    }

    // Clean up text
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Limit to 30K characters
    if (text.length > 30000) {
      text = text.slice(0, 30000) + '\n\n[... 文本已截断，共 ' + text.length + ' 字符 ...]';
    }

    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      mimetype,
      pageCount,
      text,
    });
  } catch (error) {
    console.error('File parse error:', error);
    res.status(500).json({ error: `文件解析失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// DOCX export endpoint
app.post('/api/export/docx', async (req, res) => {
  try {
    const { title, messages } = req.body as {
      title: string;
      messages: { role: string; content: string }[];
    };

    if (!messages || messages.length === 0) {
      res.status(400).json({ error: 'No messages to export' });
      return;
    }

    // Build document sections
    const children: Paragraph[] = [];

    // Title
    children.push(
      new Paragraph({
        text: title || '案例分析报告',
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
      })
    );

    // Subtitle
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: `由 CaseBuddy AI 生成 · ${new Date().toLocaleDateString('zh-CN')}`,
            color: '888888',
            size: 20,
          }),
        ],
      })
    );

    // Separator
    children.push(
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' },
        },
        spacing: { after: 300 },
      })
    );

    // Messages
    for (const msg of messages) {
      const isUser = msg.role === 'user';

      // Role header
      children.push(
        new Paragraph({
          spacing: { before: 300, after: 100 },
          children: [
            new TextRun({
              text: isUser ? '👤 用户' : '🤖 AI 分析',
              bold: true,
              color: isUser ? '1E40AF' : '166534',
              size: 24,
            }),
          ],
        })
      );

      // Content - split by lines and create paragraphs
      const lines = msg.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') {
          children.push(new Paragraph({ spacing: { after: 100 } }));
        } else if (trimmed.startsWith('# ')) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              spacing: { before: 240, after: 120 },
              children: [new TextRun({ text: trimmed.slice(2), bold: true, size: 32 })],
            })
          );
        } else if (trimmed.startsWith('## ')) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              spacing: { before: 200, after: 100 },
              children: [new TextRun({ text: trimmed.slice(3), bold: true, size: 28 })],
            })
          );
        } else if (trimmed.startsWith('### ')) {
          children.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_3,
              spacing: { before: 160, after: 80 },
              children: [new TextRun({ text: trimmed.slice(4), bold: true, size: 24 })],
            })
          );
        } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          children.push(
            new Paragraph({
              bullet: { level: 0 },
              spacing: { after: 40 },
              children: [new TextRun({ text: trimmed.slice(2), size: 21 })],
            })
          );
        } else if (/^\d+\.\s/.test(trimmed)) {
          children.push(
            new Paragraph({
              numbering: { reference: 'default-numbering', level: 0 },
              spacing: { after: 40 },
              children: [new TextRun({ text: trimmed.replace(/^\d+\.\s/, ''), size: 21 })],
            })
          );
        } else if (trimmed.startsWith('> ')) {
          children.push(
            new Paragraph({
              spacing: { before: 80, after: 80 },
              indent: { left: 400 },
              border: {
                left: { style: BorderStyle.SINGLE, size: 12, color: '3B82F6' },
              },
              children: [new TextRun({ text: trimmed.slice(2), italics: true, color: '64748B', size: 21 })],
            })
          );
        } else {
          // Handle bold markdown inline
          const parts = trimmed.split(/\*\*(.+?)\*\*/g);
          const runs = parts.map((part, i) => {
            if (i % 2 === 1) {
              return new TextRun({ text: part, bold: true, size: 21 });
            }
            return new TextRun({ text: part, size: 21 });
          });
          children.push(
            new Paragraph({
              spacing: { after: 80 },
              children: runs,
            })
          );
        }
      }

      // Separator between messages
      children.push(
        new Paragraph({
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 3, color: 'E2E8F0' },
          },
          spacing: { before: 200, after: 100 },
        })
      );
    }

    // Footer
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
        children: [
          new TextRun({
            text: 'CaseBuddy · AI 赋能 MBA 案例分析',
            color: '94A3B8',
            size: 18,
          }),
        ],
      })
    );

    const doc = new Document({
      numbering: {
        config: [{
          reference: 'default-numbering',
          levels: [{
            level: 0,
            format: 'decimal' as const,
            text: '%1.',
            alignment: AlignmentType.START,
          }],
        }],
      },
      sections: [{
        properties: {
          page: {
            margin: {
              top: 1440,    // 1 inch = 1440 twips
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children,
      }],
    });

    const buffer = await Packer.toBuffer(doc);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title || '分析报告')}.docx`);
    res.send(buffer);
  } catch (error) {
    console.error('DOCX export error:', error);
    res.status(500).json({ error: `导出失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// ─── PPT Generation API ──────────────────────────────────────────────

const pptDesignStyles: Record<string, { name: string; desc: string; colors: Record<string, string> }> = {
  businessBlue: {
    name: '商务蓝',
    desc: '专业商务风格，适合企业汇报',
    colors: { primary: '1E3A8A', primaryLight: '3B82F6', accent: '0D9488', text: '1F2937', textLight: '6B7280', bg: 'FFFFFF', bgLight: 'F8FAFC' },
  },
  magazine: {
    name: '杂志风',
    desc: '暖色调，照片丰富，视觉冲击力',
    colors: { primary: '92400E', primaryLight: 'D97706', accent: 'DC2626', text: '292524', textLight: '78716C', bg: 'FFFBEB', bgLight: 'FEF3C7' },
  },
  academic: {
    name: '学术风',
    desc: '结构化数据展示，严谨专业',
    colors: { primary: '374151', primaryLight: '6B7280', accent: '0369A1', text: '111827', textLight: '4B5563', bg: 'FFFFFF', bgLight: 'F9FAFB' },
  },
  techDark: {
    name: '科技暗黑',
    desc: '深色背景，科技感十足',
    colors: { primary: '60A5FA', primaryLight: '3B82F6', accent: '22D3EE', text: 'F3F4F6', textLight: '9CA3AF', bg: '0F172A', bgLight: '1E293B' },
  },
  minimalWhite: {
    name: '极简白',
    desc: '极简设计，留白充分',
    colors: { primary: '18181B', primaryLight: '52525B', accent: 'E11D48', text: '27272A', textLight: 'A1A1AA', bg: 'FFFFFF', bgLight: 'FAFAFA' },
  },
};

// Get PPT design styles
app.get('/api/ppt/styles', (_req, res) => {
  res.json({
    styles: Object.entries(pptDesignStyles).map(([id, s]) => ({
      id,
      name: s.name,
      desc: s.desc,
    })),
  });
});

// Search images via Pexels
app.get('/api/ppt/search-images', async (req, res) => {
  try {
    const { query, perPage = '6', apiKey: reqApiKey } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query parameter is required' });
      return;
    }

    const apiKey = typeof reqApiKey === 'string' && reqApiKey.trim()
      ? reqApiKey.trim()
      : process.env.PEXELS_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Pexels API Key 未配置，请在「模型配置」页面或环境变量中设置' });
      return;
    }

    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}&orientation=landscape`,
      {
        headers: { Authorization: apiKey },
      }
    );

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).json({ error: `Pexels API 错误: ${err}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;
    const images = ((data.photos as unknown[]) || []).map((p: unknown) => {
      const photo = p as { src: { medium: string; large: string; }; photographer: string; alt: string; };
      return {
        thumb: photo.src.medium,
        url: photo.src.large,
        photographer: photo.photographer,
        alt: photo.alt,
      };
    });

    res.json({ images, total: (data.total_results as number) || 0 });
  } catch (error) {
    console.error('Image search error:', error);
    res.status(500).json({ error: `图片搜索失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// Search images via Pixabay (fallback)
app.get('/api/ppt/search-images-pixabay', async (req, res) => {
  try {
    const { query, perPage = '6', apiKey: reqApiKey } = req.query;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query parameter is required' });
      return;
    }

    const apiKey = typeof reqApiKey === 'string' && reqApiKey.trim()
      ? reqApiKey.trim()
      : process.env.PIXABAY_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'Pixabay API Key 未配置，请在「模型配置」页面或环境变量中设置' });
      return;
    }

    const response = await fetch(
      `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&per_page=${perPage}&orientation=horizontal&image_type=photo&lang=zh`
    );

    if (!response.ok) {
      const err = await response.text();
      res.status(response.status).json({ error: `Pixabay API 错误: ${err}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;
    const images = ((data.hits as unknown[]) || []).map((h: unknown) => {
      const hit = h as { webformatURL: string; largeImageURL: string; user: string; tags: string; };
      return {
        thumb: hit.webformatURL,
        url: hit.largeImageURL,
        photographer: hit.user,
        alt: hit.tags,
      };
    });

    res.json({ images, total: (data.totalHits as number) || 0 });
  } catch (error) {
    console.error('Pixabay search error:', error);
    res.status(500).json({ error: `图片搜索失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// Generate PPT outline via LLM
app.post('/api/ppt/generate-outline', async (req, res) => {
  try {
    const { baseUrl, apiKey, model, content, style, nSlides = 10, instructions, conversationHistory } = req.body;

    if (!baseUrl || !apiKey || !model || !content) {
      res.status(400).json({ error: 'Missing required parameters: baseUrl, apiKey, model, content' });
      return;
    }

    const styleInfo = pptDesignStyles[style || 'businessBlue'] || pptDesignStyles.businessBlue;

    // Build prompt - ECNU API doesn't support system role well, merge into user message
    const promptHeader = `你是一位专业的PPT设计专家和MBA案例分析顾问。请根据用户提供的分析内容，生成一份结构化的PPT大纲。

请严格按以下JSON格式输出（不要输出任何其他内容，只输出JSON）：

{\n  "title": "PPT标题",\n  "subtitle": "副标题",\n  "slides": [\n    {\n      "layout": "title|content|twoColumn|data|quote|chart|section",\n      "title": "页面标题（必须是完整观点句，不是名词短语）",\n      "bullets": ["要点1", "要点2", "要点3"],\n      "tableData": [["列1", "列2", "列3"], ["数据1", "数据2", "数据3"]]\n    }\n  ]\n}

设计规范：
- 风格：${styleInfo.name} - ${styleInfo.desc}
- 总页数：${nSlides}页以内
- 布局说明：
  - title: 封面页
  - section: 章节过渡页
  - content: 标准内容页（要点列表）
  - twoColumn: 双栏对比页
  - data: 数据展示页（必须包含tableData表格或高亮数字）
  - chart: 图表页（柱状图数据）
  - quote: 引用/结论页
- 每页bullet不超过5个
- 内容要精炼、有洞察力，避免大段文字
- 标题要简洁有力，必须是完整的观点句（Action Title），不超过20个字
- 遵循麦肯锡金字塔原理，结论先行
- MBA案例分析标准结构：封面→执行摘要→目录→情境分析→问题诊断→解决方案→实施路径→财务预测→结论

【数据表格要求】
1. 至少2页必须使用data布局，包含tableData表格
2. tableData格式：二维数组，第一行为表头，后续为数据行
3. 必须提取案例中的关键数据填入表格（财务数据、市场规模、增长率、用户数据等）
4. 如果原始内容没有具体数据，基于合理推断填写估算值并标注"估算"
5. 表格要有清晰的表头和单位

示例tableData：
[["指标", "数值", "单位", "年份"], ["营业收入", "120", "亿元", "2023"], ["用户增长率", "35", "%", "同比"]]
`;

    const conversationContext = conversationHistory
      ? `【对话历史】\n${conversationHistory.slice(-10).map((m: { role: string; content: string; }) => `${m.role}: ${m.content.slice(0, 300)}`).join('\n\n')}\n\n`
      : '';

    const userPrompt = `${promptHeader}\n\n${conversationContext}【分析内容】\n${content.slice(0, 3000)}\n\n${instructions ? `【用户要求】\n${instructions}\n\n` : ''}请根据以上内容生成PPT大纲。只输出JSON，不要其他内容。`;

    // Use Node.js https for ECNU API compatibility
    const { hostname, pathname, protocol, port } = new URL(baseUrl);
    const https = await import('https');
    const http = await import('http');
    const apiModule = protocol === 'https:' ? https : http;

    const apiResponse = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const apiReq = apiModule.request(
        {
          hostname,
          path: `${pathname}/chat/completions`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          port: port || (protocol === 'https:' ? 443 : 80),
        },
        (apiRes) => {
          let data = '';
          apiRes.on('data', chunk => data += chunk);
          apiRes.on('end', () => resolve({ statusCode: apiRes.statusCode || 0, body: data }));
        }
      );
      apiReq.on('error', reject);
      apiReq.write(JSON.stringify({
        model,
        messages: [{ role: 'user', content: userPrompt }],
        temperature: 0.7,
        max_tokens: 3000,
        stream: false,
      }));
      apiReq.end();
    });

    if (apiResponse.statusCode < 200 || apiResponse.statusCode >= 300) {
      res.status(apiResponse.statusCode).json({ error: `LLM API 错误: ${apiResponse.body.slice(0, 500)}` });
      return;
    }

    const llmData = JSON.parse(apiResponse.body);
    const rawContent = llmData.choices?.[0]?.message?.content || '';

    // Multi-layer JSON extraction
    let outline: Record<string, unknown> | null = null;
    const extractionStrategies = [
      // 1. Code block
      () => {
        const m = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
        return m ? JSON.parse(m[1].trim()) : null;
      },
      // 2. Direct JSON
      () => JSON.parse(rawContent.trim()),
      // 3. Find JSON object in text
      () => {
        const m = rawContent.match(/\{[\s\S]*"slides"[\s\S]*\}/);
        return m ? JSON.parse(m[0]) : null;
      },
      // 4. Truncation fix - missing closing brackets
      () => {
        const fixed = rawContent.trim() + ']}';
        return JSON.parse(fixed);
      },
    ];

    for (const strategy of extractionStrategies) {
      try {
        outline = strategy();
        if (outline && outline.slides) break;
      } catch { /* continue */ }
    }

    if (!outline || !outline.slides) {
      res.status(422).json({ error: 'LLM 返回内容不是有效 JSON', raw: rawContent.slice(0, 2000) });
      return;
    }

    // Build full PPTResult with styleGuide and platform prompts
    const result = buildPPTResult(outline, style || 'businessBlue', styleInfo);
    res.json({ result, raw: rawContent });

  } catch (error) {
    console.error('PPT outline generation error:', error);
    res.status(500).json({ error: `生成失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// Build full PPTResult from AI outline
function buildPPTResult(
  outline: Record<string, unknown>,
  styleId: string,
  styleInfo: { name: string; desc: string; colors: Record<string, string> }
): Record<string, unknown> {
  const c = styleInfo.colors;
  const slides = (outline.slides as Array<Record<string, unknown>> || []).map((s, i) => {
    const layout = (s.layout as string) || 'content';
    const bullets = (s.bullets as string[]) || [];
    const visualMap: Record<string, string> = {
      title: '全屏背景图+居中标题+副标题',
      toc: '章节列表配编号和图标',
      section: '大号章节编号+章节名+过渡背景',
      content: '标题+要点列表+右侧配图或图标',
      twoColumn: '左右双栏对比布局，各配要点列表',
      data: '数据表格或KPI卡片展示',
      chart: '柱状图/折线图/饼图展示数据',
      quote: '大号引号+居中引用文字+出处',
    };
    return {
      page: i + 1,
      title: (s.title as string) || '无标题',
      subtitle: (s.subTitle as string) || (s.subtitle as string) || undefined,
      layout: ['title', 'toc', 'section', 'content', 'twoColumn', 'data', 'chart', 'quote'].includes(layout) ? layout : 'content',
      keyPoints: bullets,
      visualSuggestion: visualMap[layout] || '要点列表配图标',
      speakerNote: undefined,
    };
  });

  const title = (outline.title as string) || '案例分析PPT';
  const subtitle = (outline.subtitle as string) || '';

  // Build platform prompts
  const doubaoPrompt = buildDoubaoPromptBackend(title, subtitle, slides, styleInfo, c);
  const gammaPrompt = buildGammaPromptBackend(title, slides, styleInfo);
  const canvaPrompt = buildCanvaPromptBackend(title, slides, styleInfo);

  return {
    title,
    subtitle,
    totalSlides: slides.length,
    slides,
    styleGuide: {
      theme: styleInfo.name,
      themeDesc: styleInfo.desc,
      colorScheme: {
        primary: '#' + c.primary,
        secondary: '#' + c.primaryLight,
        accent: '#' + c.accent,
        background: '#' + c.bg,
        text: '#' + c.text,
      },
      fonts: { heading: 'Microsoft YaHei', body: 'Microsoft YaHei' },
      imageStyle: styleId === 'magazine' ? '高质量摄影图片，暖色调，生活场景' :
        styleId === 'techDark' ? '深色背景科技图，霓虹光效，抽象几何' :
        styleId === 'academic' ? '简洁数据图表，专业示意图，留白充分' :
        styleId === 'minimalWhite' ? '极简几何图形，单色摄影，大量留白' :
        '商务场景摄影，蓝色调，专业人物',
      chartStyle: styleId === 'techDark' ? '深色主题图表，发光效果，对比鲜明' :
        styleId === 'magazine' ? '暖色图表，圆角设计，视觉冲击力' :
        '扁平化设计，与主色调一致，数据标签清晰',
      layoutPrinciples: [
        '一页一观点（Action Title），标题必须是完整观点句',
        '结论先行，金字塔结构，从上到下论证',
        '每页不超过5个要点，遵循MECE原则',
        '适当留白，避免信息过载，行距1.5倍',
        '数据驱动，用具体数字和百分比说话',
        '字体大小层次分明：标题32-40pt，正文18-24pt',
      ],
    },
    platformPrompts: {
      doubao: doubaoPrompt,
      gamma: gammaPrompt,
      canva: canvaPrompt,
    },
  };
}

function buildDoubaoPromptBackend(title: string, subtitle: string, slides: Array<Record<string, unknown>>, styleInfo: { name: string; desc: string }, colors: Record<string, string>): string {
  const lines: string[] = [
    `请为我生成一份关于「${title}」的PPT，共${slides.length}页。`,
    ``,
    `=== 整体风格要求 ===`,
    `主题：${styleInfo.name}`,
    `配色：主色 #${colors.primary}，辅色 #${colors.primaryLight}，强调色 #${colors.accent}，背景 #${colors.bg}`,
    `字体：标题用 Microsoft YaHei，正文用 Microsoft YaHei`,
    ``,
    `=== 每页详细内容 ===`,
  ];

  for (const slide of slides) {
    const layoutName: Record<string, string> = {
      title: '标题页', toc: '目录页', section: '章节页',
      content: '内容页', twoColumn: '双栏页', data: '数据页',
      chart: '图表页', quote: '引用页',
    };
    lines.push(`\n【第${slide.page}页 | ${layoutName[slide.layout as string] || '内容页'}】`);
    lines.push(`标题：${slide.title}`);
    if (slide.subtitle) lines.push(`副标题：${slide.subtitle}`);
    lines.push(`要点：`);
    for (const pt of (slide.keyPoints as string[]) || []) {
      lines.push(`  · ${pt}`);
    }
    lines.push(`可视化建议：${slide.visualSuggestion}`);
  }

  lines.push(`\n=== 输出要求 ===`);
  lines.push(`1. 每页标题必须是完整的观点句（Action Title），不是名词短语`);
  lines.push(`2. 使用麦肯锡金字塔原理，结论先行`);
  lines.push(`3. 每页不超过5个要点，遵循MECE原则`);
  lines.push(`4. 数据页要有具体数字和百分比`);
  lines.push(`5. 配色严格使用我指定的颜色方案`);
  lines.push(`6. 字体大小层次分明：标题32-40pt，正文18-24pt`);
  lines.push(`7. 适当留白，不要拥挤`);
  lines.push(`8. 使用高质量配图，与内容相关`);

  return lines.join('\n');
}

function buildGammaPromptBackend(title: string, slides: Array<Record<string, unknown>>, styleInfo: { name: string; desc: string }): string {
  return `Create a professional presentation titled "${title}" with ${slides.length} slides.\n\n` +
    `Theme: ${styleInfo.name}\n` +
    `Style: ${styleInfo.desc}\n\n` +
    `Slide outline:\n` +
    slides.map(s =>
      `Slide ${s.page}: ${s.title}\n` +
      ((s.keyPoints as string[]) || []).map((p: string) => `  - ${p}`).join('\n')
    ).join('\n\n');
}

function buildCanvaPromptBackend(title: string, slides: Array<Record<string, unknown>>, styleInfo: { name: string; desc: string }): string {
  return `Design a presentation about "${title}". ${slides.length} slides.\n\n` +
    `Style: ${styleInfo.name} - ${styleInfo.desc}\n\n` +
    slides.map(s =>
      `Slide ${s.page}: ${s.title}\n` +
      ((s.keyPoints as string[]) || []).map((p: string) => `- ${p}`).join('\n')
    ).join('\n\n');
}

app.listen(PORT, () => {
  console.log(`CaseBuddy backend running on http://localhost:${PORT}`);
});
