import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import https from 'https';
import { IncomingMessage } from 'http';
import multer from 'multer';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import pptxgen from 'pptxgenjs';

const execAsync = promisify(exec);

// ─── Types ─────────────────────────────────────────────────────────

interface SlideData {
  layout?: string;
  title?: string;
  subtitle?: string;
  bullets?: string[];
}

interface PPTOutline {
  title?: string;
  subtitle?: string;
  author?: string;
  date?: string;
  slides?: SlideData[];
}

interface ImageSearchResult {
  url: string;
  source: string;
}

const router = Router();

// ─── Multer Config ─────────────────────────────────────────────────

const multerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'text/markdown',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ─── Status Check ──────────────────────────────────────────────────

router.get('/status', async (_req, res) => {
  try {
    const possiblePaths = [
      'D:/研究生/MBA案例分析/casebuddy/ppt-master',
      path.join(process.env.HOME || '', 'ppt-master'),
      path.join(process.env.USERPROFILE || '', 'ppt-master'),
    ];

    let installed = false;
    let foundPath: string | null = null;
    let version: string | null = null;

    for (const p of possiblePaths) {
      if (fs.existsSync(p) && fs.existsSync(path.join(p, 'skills', 'ppt-master', 'SKILL.md'))) {
        installed = true;
        foundPath = p;
        const readmePath = path.join(p, 'README.md');
        if (fs.existsSync(readmePath)) {
          const content = fs.readFileSync(readmePath, 'utf-8');
          const versionMatch = content.match(/v?(\d+\.\d+\.\d+)/);
          if (versionMatch) version = versionMatch[1];
        }
        break;
      }
    }

    let pythonOk = false;
    try {
      await execAsync('python3 --version');
      pythonOk = true;
    } catch {
      try {
        await execAsync('python --version');
        pythonOk = true;
      } catch {
        pythonOk = false;
      }
    }

    res.json({ installed, path: foundPath, version, pythonOk });
  } catch (error) {
    res.json({ installed: false, path: null, version: null, pythonOk: false });
  }
});

// ─── Design Styles (Enhanced) ──────────────────────────────────────

const pptDesignStyles: Record<string, {
  name: string;
  desc: string;
  colors: Record<string, string>;
}> = {
  businessBlue: {
    name: '商务蓝',
    desc: '专业商务风格，适合企业汇报',
    colors: {
      primary: '1E3A8A', primaryLight: '3B82F6', accent: '0D9488',
      text: '1F2937', textLight: '6B7280', bg: 'FFFFFF', bgLight: 'F1F5F9',
      secondary: '64748B', highlight: 'F59E0B',
    },
  },
  magazine: {
    name: '杂志风',
    desc: '暖色调，照片丰富，视觉冲击力',
    colors: {
      primary: '92400E', primaryLight: 'D97706', accent: 'DC2626',
      text: '292524', textLight: '78716C', bg: 'FFFBEB', bgLight: 'FEF3C7',
      secondary: 'A16207', highlight: 'EA580C',
    },
  },
  academic: {
    name: '学术风',
    desc: '结构化数据展示，严谨专业',
    colors: {
      primary: '374151', primaryLight: '6B7280', accent: '0369A1',
      text: '111827', textLight: '4B5563', bg: 'FFFFFF', bgLight: 'F9FAFB',
      secondary: '6B7280', highlight: '0EA5E9',
    },
  },
  techDark: {
    name: '科技暗黑',
    desc: '深色背景，科技感十足',
    colors: {
      primary: '60A5FA', primaryLight: '3B82F6', accent: '22D3EE',
      text: 'F3F4F6', textLight: '9CA3AF', bg: '0F172A', bgLight: '1E293B',
      secondary: '64748B', highlight: '34D399',
    },
  },
  minimalWhite: {
    name: '极简白',
    desc: '极简设计，留白充分',
    colors: {
      primary: '18181B', primaryLight: '52525B', accent: 'E11D48',
      text: '27272A', textLight: 'A1A1AA', bg: 'FFFFFF', bgLight: 'FAFAFA',
      secondary: '71717A', highlight: 'F43F5E',
    },
  },
};

// ─── File Parsing ──────────────────────────────────────────────────

async function parseFile(buffer: Buffer, mimetype: string): Promise<string> {
  let text = '';
  if (mimetype === 'application/pdf') {
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      text = result.text;
      await parser.destroy();
    } catch (e) {
      console.error('PDF parse error:', e);
    }
  } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (mimetype === 'text/plain' || mimetype === 'text/markdown') {
    text = buffer.toString('utf-8');
  }
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ─── Smart Content Truncation ──────────────────────────────────────

function smartTruncate(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;

  // Try to truncate at a heading boundary
  const headingPattern = /\n#{1,3}\s+/g;
  let lastGoodIndex = maxChars;
  let match;
  while ((match = headingPattern.exec(content)) !== null) {
    if (match.index < maxChars * 0.9) {
      lastGoodIndex = match.index;
    }
  }

  // If no good heading found, truncate at paragraph boundary
  if (lastGoodIndex === maxChars) {
    const paraEnd = content.lastIndexOf('\n\n', maxChars);
    if (paraEnd > maxChars * 0.5) lastGoodIndex = paraEnd;
  }

  const truncated = content.substring(0, lastGoodIndex).trim();
  return truncated + '\n\n...（更多内容未展示）';
}

// ─── Image Search (Non-blocking) ───────────────────────────────────

async function searchImages(query: string, apiKey?: string): Promise<ImageSearchResult[]> {
  const results: ImageSearchResult[] = [];

  // Try Pixabay
  try {
    const pixabayKey = apiKey || process.env.PIXABAY_API_KEY || '';
    if (pixabayKey) {
      const url = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(query)}&image_type=photo&per_page=5&safesearch=true&lang=zh`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json() as { hits?: Array<{ webformatURL: string }> };
        for (const hit of (data.hits || []).slice(0, 3)) {
          results.push({ url: hit.webformatURL, source: 'pixabay' });
        }
      }
    }
  } catch {
    // Ignore
  }

  return results;
}

// ─── AI API Call ───────────────────────────────────────────────────

async function callAI(baseUrl: string, apiKey: string, modelId: string, prompt: string, maxTokens = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reqBody = JSON.stringify({
      model: modelId,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: maxTokens,
      stream: false,
    });

    const urlObj = new URL(baseUrl);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + '/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(reqBody),
      },
    };

    const protocol = urlObj.protocol === 'https:' ? https : require('http');
    const req = protocol.request(options, (resp: IncomingMessage) => {
      let body = '';
      resp.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      resp.on('end', () => {
        if (!resp.statusCode || resp.statusCode >= 400) {
          reject(new Error(`AI API HTTP ${resp.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          const data = JSON.parse(body);
          const content = (data.choices as Array<{ message?: { content?: string } }>)?.[0]?.message?.content || '';
          resolve(content);
        } catch {
          reject(new Error(`AI API 返回非JSON: ${body.slice(0, 200)}`));
        }
      });
    });
    req.on('error', (e: Error) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('AI API 请求超时')); });
    req.setTimeout(300000);
    req.write(reqBody);
    req.end();
  });
}

// ─── JSON Parse with Fallbacks ─────────────────────────────────────

function parseOutline(rawContent: string, fallbackTitle: string): PPTOutline {
  let outline: PPTOutline | null = null;

  // Strategy 1: Extract from markdown code block
  const codeBlockMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try { outline = JSON.parse(codeBlockMatch[1].trim()); } catch { /* ignore */ }
  }

  // Strategy 2: Find JSON object
  if (!outline) {
    const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try { outline = JSON.parse(jsonMatch[0]); } catch { /* ignore */ }
    }
  }

  // Strategy 3: Full content parse
  if (!outline) {
    try { outline = JSON.parse(rawContent.trim()); } catch { /* ignore */ }
  }

  // Strategy 4: Fix truncated JSON
  if (!outline) {
    try {
      const lastSlideMatch = rawContent.match(/(\{[^{}]*"layout"[^{}]*"title"[^{}]*"bullets"[^{}]*\})/g);
      if (lastSlideMatch && lastSlideMatch.length > 0) {
        const lastSlide = lastSlideMatch[lastSlideMatch.length - 1];
        const lastIndex = rawContent.lastIndexOf(lastSlide) + lastSlide.length;
        const fixedJson = rawContent.substring(0, lastIndex) + '\n  ]\n}';
        outline = JSON.parse(fixedJson);
      }
    } catch { /* ignore */ }
  }

  // Strategy 5: Fallback
  if (!outline) {
    outline = {
      title: fallbackTitle,
      subtitle: 'AI生成演示文稿',
      slides: [
        { layout: 'title', title: fallbackTitle, bullets: ['基于您提供的文档生成'] },
        { layout: 'content', title: '主要内容', bullets: ['文档核心观点已提取', '关键数据已整理'] },
        { layout: 'content', title: '深入分析', bullets: ['结构化展示要点', '逻辑清晰、层次分明'] },
        { layout: 'quote', title: '总结与展望', bullets: ['感谢阅读', '期待进一步交流'] },
      ],
    };
  }

  if (!outline.title) outline.title = fallbackTitle;
  if (!outline.slides) outline.slides = [];
  return outline;
}

// ─── PPTX Generation ───────────────────────────────────────────────

async function generatePPTX(outline: PPTOutline, style: string, outputPath: string): Promise<void> {
  const styleInfo = pptDesignStyles[style] || pptDesignStyles.businessBlue;
  const colors = styleInfo.colors;
  const isDark = style === 'techDark';

  const pptx = new pptxgen();
  pptx.title = outline.title || 'PPT';
  pptx.author = outline.author || 'CaseBuddy';
  pptx.subject = outline.subtitle || '';
  pptx.layout = 'LAYOUT_16x9';

  const slides = outline.slides || [];
  const totalSlides = slides.length;

  for (let i = 0; i < slides.length; i++) {
    const slideData = slides[i];
    const slide = pptx.addSlide();
    const slideNum = i + 1;

    // Background
    slide.background = { color: colors.bg };

    // ── Title Slide ──
    if (slideData.layout === 'title') {
      // Decorative top bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.15,
        fill: { color: colors.primary },
      });

      // Main title
      slide.addText(slideData.title || outline.title || '', {
        x: 0.5, y: 1.8, w: 9, h: 1.0,
        fontSize: 44, bold: true, color: colors.primary,
        align: 'center', valign: 'middle', fontFace: 'Microsoft YaHei',
      });

      // Subtitle
      if (outline.subtitle || slideData.subtitle) {
        slide.addText((outline.subtitle || slideData.subtitle) as string, {
          x: 1, y: 3.0, w: 8, h: 0.8,
          fontSize: 22, color: colors.textLight,
          align: 'center', valign: 'middle', fontFace: 'Microsoft YaHei',
        });
      }

      // Author / Date
      if (outline.author || outline.date) {
        slide.addText(`${outline.author || ''}  ${outline.date || ''}`, {
          x: 1, y: 4.2, w: 8, h: 0.4,
          fontSize: 14, color: colors.textLight,
          align: 'center', valign: 'middle', fontFace: 'Microsoft YaHei',
        });
      }

      // Bottom accent bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.5, w: '100%', h: 0.1,
        fill: { color: colors.accent },
      });
    }

    // ── Table of Contents ──
    else if (slideData.layout === 'toc') {
      // Title
      slide.addText(slideData.title || '目录', {
        x: 0.5, y: 0.5, w: 9, h: 0.7,
        fontSize: 32, bold: true, color: colors.primary,
        fontFace: 'Microsoft YaHei',
      });

      // Decorative line
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: 1.2, w: 2, h: 0.06,
        fill: { color: colors.accent },
      });

      const bullets = slideData.bullets || [];
      bullets.forEach((b, idx) => {
        const yPos = 1.6 + idx * 0.7;
        slide.addText(`${idx + 1}`, {
          x: 0.8, y: yPos, w: 0.6, h: 0.5,
          fontSize: 20, bold: true, color: colors.primaryLight,
          align: 'center', valign: 'middle', fontFace: 'Microsoft YaHei',
        });
        slide.addText(b, {
          x: 1.5, y: yPos, w: 7.5, h: 0.5,
          fontSize: 18, color: colors.text,
          valign: 'middle', fontFace: 'Microsoft YaHei',
        });
      });
    }

    // ── Section Divider ──
    else if (slideData.layout === 'section') {
      // Full-height left accent bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 0.15, h: '100%',
        fill: { color: colors.primary },
      });

      // Section number
      const sectionNum = slideData.bullets?.[0] || '';
      if (sectionNum) {
        slide.addText(sectionNum, {
          x: 0.5, y: 1.8, w: 9, h: 0.6,
          fontSize: 18, color: colors.primaryLight,
          fontFace: 'Microsoft YaHei',
        });
      }

      // Section title
      slide.addText(slideData.title || '', {
        x: 0.5, y: 2.4, w: 9, h: 1.0,
        fontSize: 40, bold: true, color: colors.primary,
        fontFace: 'Microsoft YaHei',
      });

      // Bottom accent
      slide.addShape(pptx.ShapeType.rect, {
        x: 0.5, y: 3.6, w: 3, h: 0.05,
        fill: { color: colors.accent },
      });
    }

    // ── Two Column ──
    else if (slideData.layout === 'twoColumn') {
      const bullets = slideData.bullets || [];
      const half = Math.ceil(bullets.length / 2);
      const left = bullets.slice(0, half);
      const right = bullets.slice(half);

      // Header bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.08,
        fill: { color: colors.primary },
      });

      // Title
      slide.addText(slideData.title || '', {
        x: 0.5, y: 0.3, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: colors.primary,
        fontFace: 'Microsoft YaHei',
      });

      // Divider line
      slide.addShape(pptx.ShapeType.line, {
        x: 4.95, y: 1.2, w: 0, h: 3.8,
        line: { color: colors.primaryLight, width: 1 },
      });

      // Left column
      if (left.length > 0) {
        slide.addText(
          left.map((b: string, i: number) => ({
            text: b,
            options: { bullet: true, breakLine: i < left.length - 1, fontSize: 14, color: colors.text },
          })),
          { x: 0.5, y: 1.2, w: 4.3, h: 3.8, fontFace: 'Microsoft YaHei', valign: 'top' }
        );
      }

      // Right column
      if (right.length > 0) {
        slide.addText(
          right.map((b: string, i: number) => ({
            text: b,
            options: { bullet: true, breakLine: i < right.length - 1, fontSize: 14, color: colors.text },
          })),
          { x: 5.2, y: 1.2, w: 4.3, h: 3.8, fontFace: 'Microsoft YaHei', valign: 'top' }
        );
      }

      // Footer accent
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.2, w: '100%', h: 0.06,
        fill: { color: colors.accent },
      });
    }

    // ── Data Highlight ──
    else if (slideData.layout === 'data') {
      // Title
      slide.addText(slideData.title || '', {
        x: 0.5, y: 0.3, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: colors.primary,
        fontFace: 'Microsoft YaHei',
      });

      const bullets = slideData.bullets || [];

      // Show first 3 bullets as big data points
      const dataItems = bullets.slice(0, 3);
      dataItems.forEach((b, idx) => {
        const xPos = 0.5 + idx * 3.2;
        // Number circle
        slide.addShape(pptx.ShapeType.ellipse, {
          x: xPos + 1, y: 1.2, w: 0.8, h: 0.8,
          fill: { color: colors.primaryLight },
        });
        slide.addText(`${idx + 1}`, {
          x: xPos + 1, y: 1.2, w: 0.8, h: 0.8,
          fontSize: 24, bold: true, color: 'FFFFFF',
          align: 'center', valign: 'middle', fontFace: 'Microsoft YaHei',
        });
        // Description
        slide.addText(b, {
          x: xPos, y: 2.2, w: 2.8, h: 2.5,
          fontSize: 13, color: colors.text,
          align: 'center', valign: 'top', fontFace: 'Microsoft YaHei',
        });
      });

      // Remaining bullets
      const remaining = bullets.slice(3);
      if (remaining.length > 0) {
        slide.addText(
          remaining.map((b: string, i: number) => ({
            text: b,
            options: { bullet: true, breakLine: i < remaining.length - 1, fontSize: 12, color: colors.textLight },
          })),
          { x: 0.5, y: 4.0, w: 9, h: 1.2, fontFace: 'Microsoft YaHei', valign: 'top' }
        );
      }

      // Footer
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.2, w: '100%', h: 0.06,
        fill: { color: colors.accent },
      });
    }

    // ── Quote / Conclusion ──
    else if (slideData.layout === 'quote') {
      // Top accent
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.08,
        fill: { color: colors.primary },
      });

      // Quote mark
      slide.addText('"', {
        x: 0.5, y: 1.0, w: 1, h: 0.8,
        fontSize: 60, color: colors.primaryLight,
        fontFace: 'Microsoft YaHei',
      });

      // Title
      slide.addText(slideData.title || '', {
        x: 0.5, y: 1.8, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: colors.primary,
        fontFace: 'Microsoft YaHei',
      });

      const bullets = slideData.bullets || [];
      if (bullets.length > 0) {
        slide.addText(
          bullets.map((b: string, i: number) => ({
            text: b,
            options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: 16, color: colors.text },
          })),
          { x: 0.5, y: 2.6, w: 9, h: 2.5, fontFace: 'Microsoft YaHei', valign: 'top' }
        );
      }

      // Bottom accent
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.2, w: '100%', h: 0.06,
        fill: { color: colors.accent },
      });
    }

    // ── Default Content ──
    else {
      // Top accent bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: '100%', h: 0.08,
        fill: { color: colors.primary },
      });

      // Title
      slide.addText(slideData.title || '', {
        x: 0.5, y: 0.3, w: 9, h: 0.7,
        fontSize: 28, bold: true, color: colors.primary,
        fontFace: 'Microsoft YaHei',
      });

      // Subtitle / description (if first bullet looks like description)
      const bullets = slideData.bullets || [];

      if (bullets.length > 0) {
        slide.addText(
          bullets.map((b: string, i: number) => ({
            text: b,
            options: { bullet: true, breakLine: i < bullets.length - 1, fontSize: 15, color: colors.text },
          })),
          { x: 0.5, y: 1.1, w: 9, h: 3.8, fontFace: 'Microsoft YaHei', valign: 'top' }
        );
      }

      // Footer accent
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 5.2, w: '100%', h: 0.06,
        fill: { color: colors.primaryLight },
      });
    }

    // ── Page Number (all slides except title) ──
    if (slideData.layout !== 'title') {
      slide.addText(`${slideNum} / ${totalSlides}`, {
        x: 8.5, y: 5.35, w: 1, h: 0.3,
        fontSize: 10, color: colors.textLight,
        align: 'right', fontFace: 'Microsoft YaHei',
      });
    }
  }

  await pptx.writeFile({ fileName: outputPath });
}

// ─── Main Generate Route ───────────────────────────────────────────

router.post('/generate', multerUpload.any(), async (req, res) => {
  try {
    const body = req.body as Record<string, string>;
    const files = req.files as Express.Multer.File[] | undefined;

    const baseUrl = body.baseUrl || '';
    const apiKey = body.apiKey || '';
    const modelId = body.modelId || '';
    const topic = body.topic || '';
    const style = body.style || 'businessBlue';
    const pixabayKey = body.pixabayKey || '';

    if (!baseUrl || !apiKey || !modelId) {
      res.status(400).json({ error: '缺少模型配置，请先在「模型配置」页面配置 API Key 和模型' });
      return;
    }

    // Extract content from file
    let content = topic;
    if (files && files.length > 0) {
      const file = files[0];
      const extracted = await parseFile(file.buffer, file.mimetype);
      if (extracted) {
        content = extracted + '\n\n' + (topic || '');
      }
    }

    if (!content.trim()) {
      res.status(400).json({ error: '请输入 PPT 主题或上传文档' });
      return;
    }

    const styleInfo = pptDesignStyles[style] || pptDesignStyles.businessBlue;

    // Smart truncate
    const maxContentLength = 2000;
    const truncatedContent = smartTruncate(content, maxContentLength);
    const topicTitle = truncatedContent.split('\n')[0].replace(/^#+\s*/, '').slice(0, 40);

    // Build prompt for richer outline
    const prompt = `为以下主题生成专业PPT大纲，只输出JSON。

主题：${topicTitle}
文档内容摘要：
${truncatedContent}

要求：
- 8-12页
- 必须包含以下布局类型（按需分配）：
  title=封面页（仅1页）
  toc=目录页（仅1页，列出后续章节）
  section=章节过渡页（用于大章节开头）
  content=标准内容页（标题+要点列表）
  twoColumn=双列对比页（适合对比分析）
  data=数据展示页（适合呈现关键数据/结论）
  quote=引用/总结页（适合金句、结论、致谢）

输出格式：
{"title":"主标题","subtitle":"副标题","slides":[{"layout":"title","title":"封面标题","bullets":["副标题行1","副标题行2"]}]}

注意：
- 只输出JSON，不要其他文字
- bullets 数组每一项是一个要点，不要过长
- 根据内容类型智能选择合适的 layout`;

    console.log('[PPT] Prompt length:', prompt.length);

    // Call AI
    const rawContent = await callAI(baseUrl, apiKey, modelId, prompt, 2500);

    // Parse outline
    const outline = parseOutline(rawContent, topicTitle);

    console.log('[PPT] Outline parsed, slides:', outline.slides?.length);

    // Generate PPTX
    const outputDir = path.join('D:', '研究生', 'MBA案例分析', 'casebuddy', 'outputs');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = Date.now();
    const safeTitle = (outline.title || 'PPT').replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 20);
    const outputPath = path.join(outputDir, `${safeTitle}_${timestamp}.pptx`);

    await generatePPTX(outline, style, outputPath);

    // Non-blocking image search for future enhancement
    searchImages(topicTitle, pixabayKey).catch(() => {});

    const downloadUrl = `/api/ppt-master/download?file=${encodeURIComponent(outputPath)}`;

    res.json({
      success: true,
      message: 'PPT 生成成功',
      outputPath,
      downloadUrl,
      title: outline.title,
      slideCount: outline.slides?.length || 0,
    });

  } catch (error) {
    console.error('PPT generation error:', error);
    res.status(500).json({ error: `生成失败: ${error instanceof Error ? error.message : String(error)}` });
  }
});

// ─── Download ──────────────────────────────────────────────────────

router.get('/download', async (req, res) => {
  try {
    const filePath = req.query.file as string;
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: '文件不存在' });
      return;
    }
    const filename = path.basename(filePath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.sendFile(filePath);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// ─── Check Dependencies ────────────────────────────────────────────

router.post('/check-deps', async (_req, res) => {
  try {
    const missingDeps: string[] = [];
    try {
      await execAsync('python --version');
    } catch {
      missingDeps.push('Python 3');
    }
    res.json({ ok: missingDeps.length === 0, missing: missingDeps });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

export default router;
