import { X, Download, FileText, FileDown } from 'lucide-react';
import MarkdownContent from './MarkdownContent';
import { exportMessageAsMarkdown, exportMessageAsPDF } from '../utils/exportUtils';
import type { ChatMessage } from '../types';

interface MessagePreviewProps {
  message: ChatMessage;
  sessionTitle: string;
  onClose: () => void;
}

export default function MessagePreview({ message, sessionTitle, onClose }: MessagePreviewProps) {
  const isUser = message.role === 'user';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-8 animate-fade-in-scale"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-200 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-md
              ${isUser
                ? 'bg-gradient-to-br from-primary-500 to-primary-600'
                : 'bg-gradient-to-br from-accent-500 to-accent-600'}`}>
              {isUser ? (
                <span className="text-white text-lg">👤</span>
              ) : (
                <span className="text-white text-lg">🤖</span>
              )}
            </div>
            <div>
              <h3 className="font-semibold text-surface-900">
                {isUser ? '用户提问' : 'AI 分析结果'}
              </h3>
              <p className="text-xs text-surface-400">
                {new Date(message.timestamp).toLocaleString('zh-CN')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportMessageAsMarkdown(message, sessionTitle)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-surface-600 bg-surface-100 hover:bg-surface-200 rounded-lg transition-colors font-medium"
              title="导出为 Markdown"
            >
              <FileText className="w-3.5 h-3.5" />
              MD
            </button>
            <button
              onClick={() => void exportMessageAsPDF(message, sessionTitle)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors font-medium"
              title="导出为 PDF"
            >
              <FileDown className="w-3.5 h-3.5" />
              PDF
            </button>
            <button
              onClick={onClose}
              className="p-2 text-surface-400 hover:text-surface-600 hover:bg-surface-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 overscroll-contain scrollbar-thin">
          <div className="prose prose-slate max-w-none">
            <MarkdownContent content={message.content} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-surface-100 bg-surface-50/50 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-surface-400">
            {message.content.length} 字符 · {sessionTitle}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => exportMessageAsMarkdown(message, sessionTitle)}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              导出 Markdown
            </button>
            <span className="text-surface-300">|</span>
            <button
              onClick={() => void exportMessageAsPDF(message, sessionTitle)}
              className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              导出 PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
