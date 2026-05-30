/**
 * Parse AI-generated markdown text into structured slide data for PPT generation.
 * Cleans markdown syntax, splits content into reasonable pages, detects layouts.
 */

export type SlideLayout = 'title' | 'content' | 'twoColumn' | 'data' | 'quote' | 'section' | 'chart';

export interface SlideData {
  title: string;
  layout: SlideLayout;
  bullets: string[];
  subTitle?: string;
  leftColumn?: string[];
  rightColumn?: string[];
  quote?: string;
  author?: string;
  chartData?: { label: string; value: number }[];
  tableData?: string[][];
  highlight?: string;
}

// ─── Markdown Cleaning ───────────────────────────────────────────────

function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/^[\s]*[-*+•·]\s+/gm, '')
    .replace(/^---+$/gm, '')
    .replace(/^===+$/gm, '')
    .trim();
}

// ─── Chart Data Extraction ───────────────────────────────────────────

function extractChartData(lines: string[]): { label: string; value: number }[] | undefined {
  const data: { label: string; value: number }[] = [];
  for (const line of lines) {
    const clean = cleanMarkdown(line);
    const match = clean.match(/^(.+?)[\s:：]+(\d+(?:\.\d+)?)\s*(%|亿|万|千|百万|亿美元|亿元|万人|个)?/);
    if (match) {
      const label = match[1].trim();
      const value = parseFloat(match[2]);
      const unit = match[3] || '';
      if (!isNaN(value) && label.length > 0 && label.length < 30) {
        data.push({ label: label + (unit ? ` (${unit})` : ''), value });
      }
    }
  }
  return data.length >= 3 ? data : undefined;
}

function extractHighlight(lines: string[]): string | undefined {
  for (const line of lines) {
    const clean = cleanMarkdown(line);
    const match = clean.match(/(\d+(?:\.\d+)?\s*%?)|(\d+[万亿]\s*\S+)/);
    if (match && clean.length < 80) {
      return clean;
    }
  }
  return undefined;
}

// ─── Layout Detection ────────────────────────────────────────────────

function isQuoteSlide(title: string, bullets: string[]): boolean {
  const quoteKeywords = ['结论', '洞察', '观点', '名言', '核心观点', '启示', '总结', '核心发现'];
  if (quoteKeywords.some(k => title.includes(k))) return true;
  if (bullets.length === 1 && bullets[0].length > 30) return true;
  return false;
}

function isDataSlide(bullets: string[]): boolean {
  let dataCount = 0;
  for (const b of bullets) {
    if (/\d+/.test(b) && (/[%亿万千]/.test(b) || /\d+\.\d+/.test(b))) {
      dataCount++;
    }
  }
  return dataCount >= 3;
}

function splitColumns(bullets: string[]): { left: string[]; right: string[] } {
  const mid = Math.ceil(bullets.length / 2);
  return { left: bullets.slice(0, mid), right: bullets.slice(mid) };
}

// ─── Slide Builder ───────────────────────────────────────────────────

function buildSlide(
  title: string,
  subTitle: string,
  bullets: string[],
  tableRows: string[][]
): SlideData {
  let layout: SlideLayout = 'content';
  let leftColumn: string[] | undefined;
  let rightColumn: string[] | undefined;
  let chartData: { label: string; value: number }[] | undefined;
  let tableData: string[][] | undefined;
  let quote: string | undefined;
  let author: string | undefined;
  let highlight: string | undefined;

  if (isQuoteSlide(title, bullets)) {
    layout = 'quote';
    quote = bullets[0] || title;
    author = title;
  } else if (tableRows.length > 0) {
    layout = 'data';
    tableData = tableRows;
  } else if (isDataSlide(bullets)) {
    const chart = extractChartData(bullets);
    if (chart && chart.length >= 3) {
      layout = 'chart';
      chartData = chart;
    } else {
      layout = 'data';
      highlight = extractHighlight(bullets);
    }
  } else if (bullets.length >= 5) {
    layout = 'twoColumn';
    const cols = splitColumns(bullets);
    leftColumn = cols.left;
    rightColumn = cols.right;
  }

  return {
    title,
    layout,
    bullets,
    subTitle: subTitle || undefined,
    leftColumn,
    rightColumn,
    quote,
    author,
    chartData,
    tableData,
    highlight,
  };
}

// ─── Content Chunking ────────────────────────────────────────────────

const MAX_BULLETS_PER_SLIDE = 6;

function chunkIntoSlides(
  title: string,
  subTitle: string,
  bullets: string[],
  tableRows: string[][]
): SlideData[] {
  if (tableRows.length > 0) {
    return [buildSlide(title, subTitle, bullets, tableRows)];
  }

  const result: SlideData[] = [];
  for (let i = 0; i < bullets.length; i += MAX_BULLETS_PER_SLIDE) {
    const chunk = bullets.slice(i, i + MAX_BULLETS_PER_SLIDE);
    const chunkTitle = i === 0 ? title : `${title} (续)`;
    result.push(buildSlide(chunkTitle, subTitle, chunk, []));
  }

  return result.length > 0 ? result : [buildSlide(title, subTitle, bullets, [])];
}

// ─── Auto-split by keywords when no headers ───────────────────────────

const SECTION_MARKERS = [
  /^第[一二三四五六七八九十\d]+[页章节]/,
  /^【.+?】/,
  /^\*\*.+?[:：]\*\*/,
  /^(核心观点|可视化建议|核心摘要|商业模式|市场分析|竞争格局|SWOT|PESTEL|波特五力|结论|建议|总结|背景|简介|概述)/,
  /^(第\d+页[：:])/,
];

function isSectionMarker(line: string): boolean {
  const clean = cleanMarkdown(line);
  return SECTION_MARKERS.some(re => re.test(clean)) || /^#{1,2}\s+/.test(line.trim());
}

function extractSectionTitle(line: string): string {
  const clean = cleanMarkdown(line);
  // Extract title from patterns like **核心观点：** or 第1页： or 【标题】
  const match1 = clean.match(/^\*\*(.+?)[:：]\*\*/);
  if (match1) return match1[1];
  const match2 = clean.match(/^第[一二三四五六七八九十\d]+[页章节][：:]?\s*(.+)/);
  if (match2) return match2[1] || clean;
  const match3 = clean.match(/^【(.+?)】/);
  if (match3) return match3[1];
  return clean.slice(0, 40);
}

// ─── Main Parser ──────────────────────────────────────────────────────

interface RawChunk {
  title: string;
  subTitle: string;
  bullets: string[];
  tableRows: string[][];
}

export function parseSlidesFromText(text: string, sessionTitle: string): SlideData[] {
  const lines = text.split('\n');
  const rawChunks: RawChunk[] = [];

  let currentTitle = '';
  let currentSubTitle = '';
  let currentBullets: string[] = [];
  let tableRows: string[][] = [];
  let hasHeaders = false;

  // First pass: check if content has ## headers
  for (const line of lines) {
    if (/^#{1,2}\s+/.test(line.trim())) {
      hasHeaders = true;
      break;
    }
  }

  function pushChunk(forceTitle?: string) {
    if (!currentTitle && currentBullets.length === 0 && tableRows.length === 0) return;

    const cleanTitle = cleanMarkdown(forceTitle || currentTitle);
    const cleanSubTitle = cleanMarkdown(currentSubTitle);
    const cleanBullets = currentBullets
      .map(b => cleanMarkdown(b))
      .filter(b => b.length > 0 && b !== cleanTitle);

    if (cleanBullets.length === 0 && !cleanTitle && tableRows.length === 0) return;

    rawChunks.push({
      title: cleanTitle || '内容概览',
      subTitle: cleanSubTitle,
      bullets: cleanBullets,
      tableRows,
    });

    currentTitle = '';
    currentSubTitle = '';
    currentBullets = [];
    tableRows = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      // In no-header mode, empty line might signal section break
      // but only if next line is also empty or a section marker
      continue;
    }

    // Skip dividers, URLs, images
    if (/^---+/.test(trimmed) || /^===+/.test(trimmed)) continue;
    if (/^https?:\/\//.test(trimmed)) continue;
    if (/^!\[/.test(trimmed)) continue;
    if (/^\[[\s]*\]/.test(trimmed)) continue;

    // Table
    if (trimmed.startsWith('|')) {
      const cells = trimmed
        .split('|')
        .map(c => cleanMarkdown(c))
        .filter(c => c.length > 0 && !/^[-:]+$/.test(c));
      if (cells.length > 0) {
        tableRows.push(cells);
      }
      continue;
    }

    // Header ## Title
    if (/^#{1,2}\s+/.test(trimmed)) {
      if (currentTitle || currentBullets.length > 0 || tableRows.length > 0) {
        pushChunk();
      }
      currentTitle = trimmed.replace(/^#{1,2}\s+/, '');
      continue;
    }

    // Sub-header ### SubTitle
    if (/^#{3,}\s+/.test(trimmed)) {
      const sub = trimmed.replace(/^#{3,}\s+/, '');
      if (!currentSubTitle && currentTitle) {
        currentSubTitle = sub;
      } else if (currentTitle || currentBullets.length > 0) {
        currentBullets.push(sub);
      }
      continue;
    }

    // In no-header mode, detect section markers like **核心观点：** or 第1页：
    if (!hasHeaders && isSectionMarker(trimmed)) {
      if (currentTitle || currentBullets.length > 0 || tableRows.length > 0) {
        pushChunk();
      }
      currentTitle = extractSectionTitle(trimmed);
      // Also add the line itself as a bullet (minus the marker part)
      const clean = cleanMarkdown(trimmed);
      // Remove the marker prefix, keep the rest as first bullet
      const rest = clean.replace(/^第[一二三四五六七八九十\d]+[页章节][：:]?\s*/, '')
                       .replace(/^【.+?】\s*/, '')
                       .replace(/^\*\*.+?[:：]\*\*\s*/, '');
      if (rest.length > 0 && rest !== currentTitle) {
        currentBullets.push(rest);
      }
      continue;
    }

    // Numbered list
    if (/^\d+[.、]\s*/.test(trimmed)) {
      currentBullets.push(trimmed.replace(/^\d+[.、]\s*/, ''));
      continue;
    }

    // Bullet list
    if (/^[-*+•·]\s+/.test(trimmed)) {
      currentBullets.push(trimmed.replace(/^[-*+•·]\s+/, ''));
      continue;
    }

    // Regular paragraph
    const clean = cleanMarkdown(trimmed);
    if (clean.length === 0) continue;

    if (currentBullets.length > 0) {
      const lastIdx = currentBullets.length - 1;
      const last = currentBullets[lastIdx];
      if (!/^\d+/.test(clean) && last.length + clean.length < 200) {
        currentBullets[lastIdx] = last + ' ' + clean;
      } else {
        currentBullets.push(clean);
      }
    } else {
      currentBullets.push(clean);
    }
  }

  pushChunk();

  // ─── Fallback: if no chunks parsed, split by empty lines ────────────

  if (rawChunks.length === 0) {
    const paragraphs: string[] = [];
    let currentPara = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (currentPara) {
          paragraphs.push(currentPara);
          currentPara = '';
        }
      } else {
        currentPara += (currentPara ? ' ' : '') + cleanMarkdown(trimmed);
      }
    }
    if (currentPara) paragraphs.push(currentPara);

    for (const para of paragraphs) {
      if (para.length > 0) {
        rawChunks.push({ title: '内容概览', subTitle: '', bullets: [para], tableRows: [] });
      }
    }
  }

  // ─── Convert to slides ─────────────────────────────────────────────

  const slides: SlideData[] = [];
  for (const chunk of rawChunks) {
    const chunked = chunkIntoSlides(chunk.title, chunk.subTitle, chunk.bullets, chunk.tableRows);
    slides.push(...chunked);
  }

  // Fallback
  if (slides.length === 0) {
    const allLines = lines
      .map(l => cleanMarkdown(l))
      .filter(l => l.length > 0)
      .slice(0, 8);
    slides.push({
      title: sessionTitle || '分析结果',
      layout: 'content',
      bullets: allLines,
    });
  }

  // ─── Title slide ────────────────────────────────────────────────────

  const titleSlide: SlideData = {
    title: sessionTitle || '案例分析报告',
    layout: 'title',
    bullets: ['由 CaseBuddy AI 生成', new Date().toLocaleDateString('zh-CN')],
    subTitle: slides.length > 0 ? slides[0].title : '',
  };

  const filtered = slides.filter(s => s.bullets.length > 0 || s.title.length > 0);

  if (filtered.length > 0 && /报告|分析|大纲|PPT|总结/.test(filtered[0].title)) {
    filtered[0].layout = 'title';
    filtered[0].bullets = ['由 CaseBuddy AI 生成', new Date().toLocaleDateString('zh-CN')];
    return filtered.slice(0, 20);
  }

  return [titleSlide, ...filtered].slice(0, 20);
}
