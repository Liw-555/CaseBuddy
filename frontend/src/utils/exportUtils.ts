import html2pdf from 'html2pdf.js';
import type { ChatMessage, AnalysisSession } from '../types';

/**
 * Export conversation as Markdown file
 */
export function exportAsMarkdown(session: AnalysisSession): void {
  const lines: string[] = [];

  lines.push(`# ${session.title || '案例分析报告'}`);
  lines.push('');
  lines.push(`> 由 CaseBuddy AI 生成 · ${new Date(session.updatedAt).toLocaleDateString('zh-CN')}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of session.messages) {
    if (msg.role === 'user') {
      lines.push(`## 用户`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    } else if (msg.role === 'assistant') {
      lines.push(`## AI 分析`);
      lines.push('');
      lines.push(msg.content);
      lines.push('');
    }
    lines.push('---');
    lines.push('');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${session.title || '分析报告'}.md`);
}

/**
 * Export conversation as PDF (direct download via html2pdf.js)
 */
export async function exportAsPDF(session: AnalysisSession): Promise<void> {
  // Create a temporary container for rendering
  const container = document.createElement('div');
  container.innerHTML = buildExportHTML(session);
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '210mm'; // A4 width
  document.body.appendChild(container);

  try {
    const opt = {
      margin: [10, 10, 10, 10] as [number, number, number, number], // mm: top, left, bottom, right
      filename: `${session.title || '分析报告'}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        letterRendering: true,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait' as const,
      },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    await html2pdf().set(opt).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Export a single message as Markdown
 */
export function exportMessageAsMarkdown(msg: ChatMessage, sessionTitle: string): void {
  const lines: string[] = [];
  lines.push(`# ${sessionTitle} - ${msg.role === 'user' ? '用户提问' : 'AI分析'}`);
  lines.push('');
  lines.push(msg.content);
  lines.push('');
  lines.push(`> 导出时间: ${new Date().toLocaleString('zh-CN')}`);

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
  downloadBlob(blob, `${sessionTitle}-${msg.role === 'user' ? '提问' : '分析'}-${msg.id}.md`);
}

/**
 * Export a single message as PDF (direct download via html2pdf.js)
 */
export async function exportMessageAsPDF(msg: ChatMessage, sessionTitle: string): Promise<void> {
  const html = `
  <div style="font-family: 'Microsoft YaHei', 'Noto Sans SC', sans-serif; line-height: 1.8; color: #1a1a2e; padding: 20px;">
    <h1 style="font-size: 24px; color: #1e3a8a; margin-bottom: 20px; border-bottom: 3px solid #3b82f6; padding-bottom: 10px;">
      ${sessionTitle} - ${msg.role === 'user' ? '用户提问' : 'AI分析'}
    </h1>
    ${renderMarkdownToHTML(msg.content)}
    <div style="margin-top: 30px; padding-top: 12px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 12px;">
      由 CaseBuddy AI 生成 · ${new Date().toLocaleString('zh-CN')}
    </div>
  </div>`;

  const container = document.createElement('div');
  container.innerHTML = html;
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '210mm';
  document.body.appendChild(container);

  try {
    const opt = {
      margin: [15, 15, 15, 15] as [number, number, number, number],
      filename: `${sessionTitle}-${msg.role === 'user' ? '提问' : '分析'}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
      pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
    };

    await html2pdf().set(opt).from(container).save();
  } finally {
    document.body.removeChild(container);
  }
}

/**
 * Export full conversation via backend as DOCX
 */
export async function exportAsDocx(session: AnalysisSession): Promise<void> {
  try {
    const response = await fetch('http://localhost:3001/api/export/docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: session.title || '案例分析报告',
        messages: session.messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      }),
    });

    if (!response.ok) {
      throw new Error('导出失败');
    }

    const blob = await response.blob();
    downloadBlob(blob, `${session.title || '分析报告'}.docx`);
  } catch (error) {
    console.error('DOCX export error:', error);
    // Fallback: export as HTML that Word can open
    const html = buildWordHTML(session);
    const blob = new Blob([html], { type: 'application/msword;charset=utf-8' });
    downloadBlob(blob, `${session.title || '分析报告'}.doc`);
  }
}

// --- Helper functions ---

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildExportHTML(session: AnalysisSession): string {
  const messages = session.messages.map(msg => {
    const isUser = msg.role === 'user';
    return `
      <div style="margin-bottom: 20px; page-break-inside: avoid;">
        <div style="display: inline-block; padding: 4px 12px; border-radius: 6px; font-size: 13px; font-weight: 600; margin-bottom: 8px;
          ${isUser ? 'background: #eff6ff; color: #1e40af;' : 'background: #f0fdf4; color: #166534;'}">
          ${isUser ? '👤 用户' : '🤖 AI 分析'}
        </div>
        <div style="padding: 12px 16px; border-left: 3px solid ${isUser ? '#3b82f6' : '#22c55e'}; margin-left: 8px;">
          ${renderMarkdownToHTML(msg.content)}
        </div>
      </div>`;
  }).join('');

  return `
  <div style="font-family: 'Microsoft YaHei', 'Noto Sans SC', sans-serif; line-height: 1.8; color: #1a1a2e;">
    <div style="text-align: center; padding: 30px 40px; background: linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%); color: white; margin: -20px -20px 20px -20px;">
      <h1 style="font-size: 28px; margin-bottom: 8px; color: white;">${session.title || '案例分析报告'}</h1>
      <p style="opacity: 0.8; font-size: 14px;">由 CaseBuddy AI 生成 · ${new Date(session.updatedAt).toLocaleString('zh-CN')}</p>
    </div>
    <div style="padding: 0 20px;">
      ${messages}
    </div>
    <div style="text-align: center; padding: 20px; color: #94a3b8; font-size: 12px; border-top: 1px solid #e2e8f0; margin-top: 30px;">
      CaseBuddy · AI 赋能 MBA 案例分析
    </div>
  </div>`;
}

function buildWordHTML(session: AnalysisSession): string {
  const messages = session.messages.map(msg => {
    const isUser = msg.role === 'user';
    return `
    <div style="margin-bottom:20px;">
      <div style="font-weight:bold;color:${isUser ? '#1e40af' : '#166534'};margin-bottom:6px;font-size:14px;">
        ${isUser ? '👤 用户' : '🤖 AI 分析'}
      </div>
      <div style="padding:10px 14px;border-left:3px solid ${isUser ? '#3b82f6' : '#22c55e'};margin-left:4px;">
        ${renderMarkdownToHTML(msg.content)}
      </div>
    </div>`;
  }).join('');

  return `
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="utf-8">
  <title>${session.title || '案例分析报告'}</title>
  <style>
    body { font-family: 'Microsoft YaHei', sans-serif; font-size: 14px; line-height: 1.8; }
    h1 { font-size: 22px; color: #1e3a8a; }
    h2 { font-size: 18px; color: #1e3a8a; }
    h3 { font-size: 15px; color: #1e3a8a; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; }
    th { background: #f0f0f0; }
    blockquote { border-left: 3px solid #3b82f6; padding-left: 12px; color: #666; font-style: italic; }
  </style>
</head>
<body>
  <h1>${session.title || '案例分析报告'}</h1>
  <p style="color:#888;font-size:12px;">由 CaseBuddy AI 生成 · ${new Date().toLocaleString('zh-CN')}</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:16px 0;" />
  ${messages}
  <hr style="border:none;border-top:1px solid #ddd;margin:20px 0;" />
  <p style="color:#aaa;font-size:11px;text-align:center;">CaseBuddy · AI 赋能 MBA 案例分析</p>
</body>
</html>`;
}

/**
 * Simple markdown-to-HTML renderer for export (no React dependency)
 */
function renderMarkdownToHTML(md: string): string {
  let html = md
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.+)$/gm, '<h3 style="color:#1e3a8a;font-size:16px;margin-top:16px;margin-bottom:8px;">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="color:#1e3a8a;font-size:20px;margin-top:20px;margin-bottom:10px;">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="color:#1e3a8a;font-size:24px;margin-top:24px;margin-bottom:12px;">$1</h1>')
    // Bold & italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px;">$1</code>')
    // Blockquote
    .replace(/^&gt; (.+)$/gm, '<blockquote style="border-left:4px solid #3b82f6;padding-left:16px;color:#64748b;font-style:italic;margin:12px 0;">$1</blockquote>')
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, '<li style="margin-bottom:4px;">$1</li>')
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, '<li style="margin-bottom:4px;">$1</li>')
    // Horizontal rule
    .replace(/^---$/gm, '<hr style="border:none;border-top:1px solid #e2e8f0;margin:12px 0;" />')
    // Line breaks to paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');

  // Wrap loose <li> in <ul>
  html = html.replace(/(<li.*?<\/li>)+/g, '<ul style="padding-left:24px;margin-bottom:12px;">$&</ul>');

  return `<p>${html}</p>`;
}
