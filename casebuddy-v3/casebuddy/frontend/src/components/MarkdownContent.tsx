import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export default function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  return (
    <div className={`markdown-body ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl font-bold text-surface-900 mt-5 mb-3 pb-2 border-b border-surface-200">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-bold text-surface-800 mt-4 mb-2">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold text-surface-800 mt-3 mb-2">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="mb-3 leading-relaxed text-surface-700">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 mb-3 space-y-1.5 text-surface-700">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 mb-3 space-y-1.5 text-surface-700">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="leading-relaxed">{children}</li>
          ),
          code: ({ children, className: codeClass }) => {
            const isInline = !codeClass;
            if (isInline) {
              return (
                <code className="px-1.5 py-0.5 bg-surface-100 rounded text-sm font-mono text-accent-600">
                  {children}
                </code>
              );
            }
            return (
              <code className="text-sm font-mono text-surface-200">{children}</code>
            );
          },
          pre: ({ children }) => (
            <pre className="p-4 bg-surface-900 rounded-xl overflow-x-auto mb-3 shadow-inner">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="pl-4 border-l-4 border-accent-300 text-surface-500 italic my-3 bg-accent-50/50 py-2 pr-3 rounded-r-lg">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto mb-3">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-100">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-surface-200 px-3 py-2 text-left font-semibold text-surface-700">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-surface-200 px-3 py-2 text-surface-600">
              {children}
            </td>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-surface-800">{children}</strong>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-600 hover:text-primary-700 underline underline-offset-2 transition-colors"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-4 border-surface-200" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
