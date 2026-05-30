import PptxGenJS from 'pptxgenjs';
import type { SlideData } from './slideParser';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
 type Slide = any;

// ─── Design Styles ───────────────────────────────────────────────────

export interface DesignColors {
  primary: string;
  primaryLight: string;
  accent: string;
  text: string;
  textLight: string;
  bg: string;
  bgLight: string;
}

const DESIGN_STYLES: Record<string, DesignColors> = {
  businessBlue: {
    primary: '1E3A8A',
    primaryLight: '3B82F6',
    accent: '0D9488',
    text: '1F2937',
    textLight: '6B7280',
    bg: 'FFFFFF',
    bgLight: 'F8FAFC',
  },
  magazine: {
    primary: '92400E',
    primaryLight: 'D97706',
    accent: 'DC2626',
    text: '292524',
    textLight: '78716C',
    bg: 'FFFBEB',
    bgLight: 'FEF3C7',
  },
  academic: {
    primary: '374151',
    primaryLight: '6B7280',
    accent: '0369A1',
    text: '111827',
    textLight: '4B5563',
    bg: 'FFFFFF',
    bgLight: 'F9FAFB',
  },
  techDark: {
    primary: '60A5FA',
    primaryLight: '3B82F6',
    accent: '22D3EE',
    text: 'F3F4F6',
    textLight: '9CA3AF',
    bg: '0F172A',
    bgLight: '1E293B',
  },
  minimalWhite: {
    primary: '18181B',
    primaryLight: '52525B',
    accent: 'E11D48',
    text: '27272A',
    textLight: 'A1A1AA',
    bg: 'FFFFFF',
    bgLight: 'FAFAFA',
  },
};

function getColors(styleId: string): DesignColors {
  return DESIGN_STYLES[styleId] || DESIGN_STYLES.businessBlue;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function addFooter(slide: Slide, pageNum: number, total: number, colors: DesignColors, isDark: boolean) {
  const footerColor = isDark ? '64748B' : '94A3B8';
  const lineColor = isDark ? '334155' : 'E2E8F0';
  slide.addText(`CaseBuddy AI · ${pageNum} / ${total}`, {
    x: 0.5, y: 5.1, w: 9, h: 0.3,
    fontSize: 9, color: footerColor, fontFace: 'Microsoft YaHei',
  });
  slide.addShape('rect', { x: 0.5, y: 5.05, w: 9, h: 0.01, fill: { color: lineColor } });
}

// ─── Slide Builders ──────────────────────────────────────────────────

function buildTitleSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  _pageNum: number,
  _total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  slide.addShape('rect', {
    x: 0, y: 0, w: '100%', h: '100%',
    fill: { color: isDark ? colors.bg : colors.primary },
  });

  if (!isDark) {
    slide.addShape('rect', {
      x: 0, y: 0, w: 0.15, h: '100%',
      fill: { color: colors.primaryLight },
    });
  }

  const titleColor = isDark ? colors.primary : 'FFFFFF';
  const subTitleColor = isDark ? colors.textLight : 'BFDBFE';
  const footerColor = isDark ? colors.textLight : '93C5FD';

  slide.addText(slideData.title, {
    x: 0.8, y: 1.8, w: 8.4, h: 1.2,
    fontSize: 40, color: titleColor, fontFace: 'Microsoft YaHei', bold: true,
    align: 'center',
  });

  if (slideData.subTitle) {
    slide.addText(slideData.subTitle, {
      x: 0.8, y: 3.2, w: 8.4, h: 0.5,
      fontSize: 18, color: subTitleColor, fontFace: 'Microsoft YaHei',
      align: 'center',
    });
  }

  const footerText = slideData.bullets.join(' · ');
  slide.addText(footerText, {
    x: 0.8, y: 4.2, w: 8.4, h: 0.4,
    fontSize: 13, color: footerColor, fontFace: 'Microsoft YaHei',
    align: 'center',
  });

  slide.addShape('rect', {
    x: 3.5, y: 4.8, w: 3, h: 0.06,
    fill: { color: colors.primaryLight },
  });

  return slide;
}

function buildContentSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  pageNum: number,
  total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  const bgColor = isDark ? colors.bg : colors.bg;
  const topBarColor = isDark ? colors.primaryLight : colors.primary;

  slide.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: topBarColor } });

  slide.addText(slideData.title, {
    x: 0.5, y: 0.4, w: 9, h: 0.6,
    fontSize: 28, color: colors.primary, fontFace: 'Microsoft YaHei', bold: true,
  });

  slide.addShape('rect', { x: 0.5, y: 1.0, w: 1.2, h: 0.06, fill: { color: colors.primaryLight } });

  const bulletItems = slideData.bullets.map(b => ({
    text: b,
    options: { fontSize: 15, color: colors.text, fontFace: 'Microsoft YaHei', breakLine: true },
  }));

  slide.addText(bulletItems, {
    x: 0.5, y: 1.3, w: 9, h: 3.5,
    bullet: { type: 'number' },
    color: colors.primaryLight,
    lineSpacing: 28,
    paraSpaceAfter: 8,
  });

  addFooter(slide, pageNum, total, colors, isDark);
  return slide;
}

function buildTwoColumnSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  pageNum: number,
  total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  const topBarColor = isDark ? colors.primaryLight : colors.primary;
  const dividerColor = isDark ? '334155' : 'E2E8F0';

  slide.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: topBarColor } });

  slide.addText(slideData.title, {
    x: 0.5, y: 0.4, w: 9, h: 0.6,
    fontSize: 28, color: colors.primary, fontFace: 'Microsoft YaHei', bold: true,
  });
  slide.addShape('rect', { x: 0.5, y: 1.0, w: 1.2, h: 0.06, fill: { color: colors.primaryLight } });

  const left = slideData.leftColumn || slideData.bullets.slice(0, Math.ceil(slideData.bullets.length / 2));
  const right = slideData.rightColumn || slideData.bullets.slice(Math.ceil(slideData.bullets.length / 2));

  const leftItems = left.map(b => ({
    text: b,
    options: { fontSize: 14, color: colors.text, fontFace: 'Microsoft YaHei', breakLine: true },
  }));
  slide.addText(leftItems, {
    x: 0.5, y: 1.3, w: 4.2, h: 3.5,
    bullet: { type: 'bullet' },
    color: colors.primaryLight,
    lineSpacing: 26,
    paraSpaceAfter: 6,
  });

  slide.addShape('rect', { x: 4.9, y: 1.3, w: 0.01, h: 3.2, fill: { color: dividerColor } });

  const rightItems = right.map(b => ({
    text: b,
    options: { fontSize: 14, color: colors.text, fontFace: 'Microsoft YaHei', breakLine: true },
  }));
  slide.addText(rightItems, {
    x: 5.1, y: 1.3, w: 4.4, h: 3.5,
    bullet: { type: 'bullet' },
    color: colors.primaryLight,
    lineSpacing: 26,
    paraSpaceAfter: 6,
  });

  addFooter(slide, pageNum, total, colors, isDark);
  return slide;
}

function buildDataSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  pageNum: number,
  total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  const topBarColor = isDark ? colors.primaryLight : colors.primary;
  const tableHeaderFill = isDark ? colors.bgLight : colors.primary;
  const tableAltFill = isDark ? colors.bgLight : 'F8FAFC';
  const tableBorderColor = isDark ? '334155' : 'E2E8F0';

  slide.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: topBarColor } });

  slide.addText(slideData.title, {
    x: 0.5, y: 0.4, w: 9, h: 0.6,
    fontSize: 28, color: colors.primary, fontFace: 'Microsoft YaHei', bold: true,
  });
  slide.addShape('rect', { x: 0.5, y: 1.0, w: 1.2, h: 0.06, fill: { color: colors.primaryLight } });

  if (slideData.tableData && slideData.tableData.length > 0) {
    const rows = slideData.tableData;
    const colCount = Math.max(...rows.map(r => r.length));
    const tableRows = rows.map((row, ri) =>
      row.map(cell => ({
        text: cell,
        options: {
          fontSize: 12,
          fontFace: 'Microsoft YaHei',
          color: ri === 0 ? 'FFFFFF' : colors.text,
          bold: ri === 0,
          fill: { color: ri === 0 ? tableHeaderFill : (ri % 2 === 0 ? tableAltFill : colors.bg) },
        },
      }))
    );

    slide.addTable(tableRows, {
      x: 0.5, y: 1.3, w: 9, h: 3.2,
      fontSize: 12,
      color: colors.text,
      border: { type: 'solid', pt: 0.5, color: tableBorderColor },
      colW: Array(colCount).fill(9 / colCount),
    });
  } else if (slideData.highlight) {
    slide.addText(slideData.highlight, {
      x: 0.5, y: 1.6, w: 9, h: 1.5,
      fontSize: 24, color: colors.primary, fontFace: 'Microsoft YaHei',
      align: 'center', valign: 'middle',
    });
    const bullets = slideData.bullets.filter(b => b !== slideData.highlight).slice(0, 4);
    const bulletItems = bullets.map(b => ({
      text: b,
      options: { fontSize: 14, color: colors.text, fontFace: 'Microsoft YaHei', breakLine: true },
    }));
    slide.addText(bulletItems, {
      x: 0.5, y: 3.2, w: 9, h: 1.6,
      bullet: { type: 'bullet' },
      color: colors.primaryLight,
      lineSpacing: 24,
    });
  } else {
    const bulletItems = slideData.bullets.map(b => ({
      text: b,
      options: { fontSize: 15, color: colors.text, fontFace: 'Microsoft YaHei', breakLine: true },
    }));
    slide.addText(bulletItems, {
      x: 0.5, y: 1.3, w: 9, h: 3.5,
      bullet: { type: 'number' },
      color: colors.primaryLight,
      lineSpacing: 28,
      paraSpaceAfter: 8,
    });
  }

  addFooter(slide, pageNum, total, colors, isDark);
  return slide;
}

function buildQuoteSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  pageNum: number,
  total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  const topBarColor = isDark ? colors.primaryLight : colors.primary;
  const quoteColor = isDark ? '64748B' : 'BFDBFE';

  slide.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: topBarColor } });

  slide.addText('"', {
    x: 0.5, y: 0.8, w: 1, h: 1,
    fontSize: 80, color: quoteColor, fontFace: 'Georgia',
  });

  const quoteText = slideData.quote || slideData.bullets[0] || slideData.title;
  const authorText = slideData.author || slideData.title;

  slide.addText(quoteText, {
    x: 0.8, y: 1.4, w: 8.4, h: 2.2,
    fontSize: 20, color: colors.primary, fontFace: 'Microsoft YaHei', italic: true,
    align: 'center', valign: 'middle',
  });

  slide.addText(`— ${authorText}`, {
    x: 0.8, y: 3.6, w: 8.4, h: 0.4,
    fontSize: 14, color: colors.textLight, fontFace: 'Microsoft YaHei',
    align: 'center',
  });

  slide.addShape('rect', { x: 3.5, y: 4.2, w: 3, h: 0.04, fill: { color: colors.primaryLight } });

  addFooter(slide, pageNum, total, colors, isDark);
  return slide;
}

function buildChartSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  pageNum: number,
  total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  const topBarColor = isDark ? colors.primaryLight : colors.primary;

  slide.addShape('rect', { x: 0, y: 0, w: '100%', h: 0.12, fill: { color: topBarColor } });

  slide.addText(slideData.title, {
    x: 0.5, y: 0.4, w: 9, h: 0.6,
    fontSize: 28, color: colors.primary, fontFace: 'Microsoft YaHei', bold: true,
  });
  slide.addShape('rect', { x: 0.5, y: 1.0, w: 1.2, h: 0.06, fill: { color: colors.primaryLight } });

  if (slideData.chartData && slideData.chartData.length > 0) {
    const labels = slideData.chartData.map(d => d.label);
    const values = slideData.chartData.map(d => d.value);

    slide.addChart(pptx.ChartType.bar, [
      {
        name: '数据',
        labels,
        values,
      },
    ], {
      x: 0.5, y: 1.3, w: 9, h: 3.2,
      chartColors: [colors.primaryLight],
      showValue: true,
      dataLabelFontSize: 11,
      dataLabelColor: colors.text,
      showLegend: false,
      barDir: 'bar',
      catAxisLabelColor: colors.text,
      catAxisLabelFontSize: 11,
      valAxisLabelColor: colors.text,
      valAxisLabelFontSize: 11,
      titleFontFace: 'Microsoft YaHei',
      titleFontSize: 14,
      titleColor: colors.text,
    });
  } else {
    const bulletItems = slideData.bullets.map(b => ({
      text: b,
      options: { fontSize: 15, color: colors.text, fontFace: 'Microsoft YaHei', breakLine: true },
    }));
    slide.addText(bulletItems, {
      x: 0.5, y: 1.3, w: 9, h: 3.5,
      bullet: { type: 'number' },
      color: colors.primaryLight,
      lineSpacing: 28,
    });
  }

  addFooter(slide, pageNum, total, colors, isDark);
  return slide;
}

function buildSectionSlide(
  pptx: PptxGenJS,
  slideData: SlideData,
  pageNum: number,
  total: number,
  colors: DesignColors,
  isDark: boolean
): Slide {
  const slide = pptx.addSlide();

  const bgColor = isDark ? colors.bg : colors.bgLight;
  const leftBarColor = isDark ? colors.primaryLight : colors.primary;

  slide.addShape('rect', {
    x: 0, y: 0, w: '100%', h: '100%',
    fill: { color: bgColor },
  });

  slide.addShape('rect', {
    x: 0, y: 0, w: 0.15, h: '100%',
    fill: { color: leftBarColor },
  });

  slide.addText(slideData.title, {
    x: 0.8, y: 2.0, w: 8.4, h: 1,
    fontSize: 36, color: colors.primary, fontFace: 'Microsoft YaHei', bold: true,
  });

  if (slideData.subTitle) {
    slide.addText(slideData.subTitle, {
      x: 0.8, y: 3.0, w: 8.4, h: 0.5,
      fontSize: 16, color: colors.textLight, fontFace: 'Microsoft YaHei',
    });
  }

  addFooter(slide, pageNum, total, colors, isDark);
  return slide;
}

// ─── Main Export Functions ───────────────────────────────────────────

export async function generatePPTX(
  slides: SlideData[],
  fileName: string,
  styleId: string = 'businessBlue'
): Promise<void> {
  const colors = getColors(styleId);
  const isDark = styleId === 'techDark';

  const pptx = new PptxGenJS();

  pptx.layout = 'LAYOUT_16x9';
  pptx.title = fileName;
  pptx.author = 'CaseBuddy AI';
  pptx.company = 'CaseBuddy';
  pptx.subject = 'MBA案例分析报告';
  pptx.theme = {
    headFontFace: 'Microsoft YaHei',
    bodyFontFace: 'Microsoft YaHei',
  };

  const total = slides.length;

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const pageNum = i + 1;

    switch (slide.layout) {
      case 'title':
        buildTitleSlide(pptx, slide, pageNum, total, colors, isDark);
        break;
      case 'twoColumn':
        buildTwoColumnSlide(pptx, slide, pageNum, total, colors, isDark);
        break;
      case 'data':
        buildDataSlide(pptx, slide, pageNum, total, colors, isDark);
        break;
      case 'quote':
        buildQuoteSlide(pptx, slide, pageNum, total, colors, isDark);
        break;
      case 'chart':
        buildChartSlide(pptx, slide, pageNum, total, colors, isDark);
        break;
      case 'section':
        buildSectionSlide(pptx, slide, pageNum, total, colors, isDark);
        break;
      default:
        buildContentSlide(pptx, slide, pageNum, total, colors, isDark);
    }
  }

  await pptx.writeFile({ fileName: `${fileName}.pptx` });
}

export async function exportMessageAsPPTX(
  content: string,
  title: string,
  fileName: string,
  styleId?: string
): Promise<void> {
  const { parseSlidesFromText } = await import('./slideParser');
  const slides = parseSlidesFromText(content, title);
  await generatePPTX(slides, fileName, styleId);
}
