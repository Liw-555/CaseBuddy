import { useState } from 'react';
import { Search, Calculator, Database, Wrench, Check, X } from 'lucide-react';

export interface Tool {
  id: string;
  name: string;
  description: string;
  icon: React.ElementType;
  parameters: { name: string; type: string; description: string }[];
}

export const availableTools: Tool[] = [
  {
    id: 'web_search',
    name: '网络搜索',
    description: '搜索互联网获取最新行业数据、新闻和竞争情报',
    icon: Search,
    parameters: [
      { name: 'query', type: 'string', description: '搜索关键词' },
    ],
  },
  {
    id: 'calculate',
    name: '数值计算',
    description: '执行财务计算、比率分析、增长预测等数学运算',
    icon: Calculator,
    parameters: [
      { name: 'expression', type: 'string', description: '数学表达式' },
    ],
  },
  {
    id: 'extract_data',
    name: '数据提取',
    description: '从案例文本中提取结构化数据（财务数据、时间线、关键指标）',
    icon: Database,
    parameters: [
      { name: 'data_type', type: 'string', description: '提取类型：财务/时间线/人物/指标' },
    ],
  },
];

export interface ToolCall {
  id: string;
  tool: string;
  arguments: Record<string, string>;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: string;
}

interface AgentToolsProps {
  toolCalls: ToolCall[];
  enabled: boolean;
  onToggle: () => void;
}

// Tool execution — tools that need intelligence go through LLM, pure computation stays local
export async function executeTool(
  call: ToolCall,
  caseText?: string,
  llmCaller?: (prompt: string) => Promise<string>
): Promise<string> {
  switch (call.tool) {
    case 'web_search': {
      if (!llmCaller) return `[搜索] 无法执行：LLM 未连接`;
      const query = call.arguments.query || '';
      const result = await llmCaller(
        `你是一个网络搜索助手。用户搜索"${query}"，请基于你的知识提供相关信息。如果你不知道，请诚实说"未找到相关信息"。不要编造数据。`
      );
      return `[搜索结果] ${query}\n${result}`;
    }

    case 'calculate':
      try {
        // Only allow safe math expressions
        const expr = call.arguments.expression || '';
        if (!/^[0-9+\-*/().%\s]+$/.test(expr)) {
          return '计算错误：表达式包含非法字符，仅支持数字和基本运算符';
        }
        // eslint-disable-next-line no-new-func
        const result = new Function('return ' + expr)();
        return `计算结果：${expr} = ${result}`;
      } catch {
        return '计算错误：表达式无效';
      }

    case 'extract_data': {
      if (!caseText || !caseText.trim()) {
        return '数据提取失败：案例文本为空，无法提取数据。请先在左侧输入或上传案例文本。';
      }
      if (!llmCaller) return `[数据提取] 无法执行：LLM 未连接`;

      const dataType = call.arguments.data_type || '通用';
      const result = await llmCaller(
        `你是一个数据提取专家。请从以下案例文本中提取"${dataType}"类型的结构化数据。

要求：
1. 只提取文本中**明确提到**的数据，不要编造或推测
2. 如果文本中没有相关数据，请直接说"案例文本中未找到${dataType}类数据"
3. 提取到的数据请用 Markdown 表格或列表格式展示
4. 标注数据来源位置

案例文本：
${caseText.slice(0, 8000)}`
      );
      return `[数据提取] 类型：${dataType}\n${result}`;
    }

    default:
      return `未知工具：${call.tool}`;
  }
}

export default function AgentTools({ toolCalls, enabled, onToggle }: AgentToolsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-white border border-surface-200 rounded-xl mb-4 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-50 min-h-[44px]"
        aria-expanded={expanded}
        aria-label="Agent 工具面板"
      >
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-accent-500" />
          <span className="font-medium text-sm text-surface-800">Agent 工具</span>
          {toolCalls.length > 0 && (
            <span className="px-2 py-0.5 bg-accent-50 text-accent-600 text-xs rounded-full">
              {toolCalls.length} 次调用
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => { e.stopPropagation(); onToggle(); }}
              className="w-3.5 h-3.5 rounded border-surface-300 text-accent-500"
            />
            <span className="text-surface-500">启用</span>
          </label>
          {expanded ? <X className="w-4 h-4 text-surface-400" /> : <span className="text-surface-400 text-xs">展开</span>}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-surface-100">
          {/* Available Tools */}
          <div className="mt-3">
            <div className="text-xs font-medium text-surface-400 mb-2">可用工具</div>
            <div className="grid grid-cols-1 gap-2">
              {availableTools.map(tool => {
                const Icon = tool.icon;
                return (
                  <div key={tool.id} className="flex items-start gap-2 p-2 bg-surface-50 rounded-lg">
                    <Icon className="w-4 h-4 text-surface-400 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-surface-700">{tool.name}</div>
                      <div className="text-xs text-surface-400">{tool.description}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tool Call History */}
          {toolCalls.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-medium text-surface-400 mb-2">调用记录</div>
              <div className="space-y-2">
                {toolCalls.map(call => (
                  <div key={call.id} className="flex items-start gap-2 p-2 bg-surface-50 rounded-lg text-sm">
                    {call.status === 'completed' && <Check className="w-4 h-4 text-emerald-500 mt-0.5" />}
                    {call.status === 'error' && <X className="w-4 h-4 text-rose-500 mt-0.5" />}
                    {call.status === 'running' && <div className="w-4 h-4 border-2 border-accent-400 border-t-transparent rounded-full animate-spin mt-0.5" />}
                    <div>
                      <div className="font-medium text-surface-700">{call.tool}</div>
                      <div className="text-xs text-surface-400">{JSON.stringify(call.arguments)}</div>
                      {call.result && (
                        <div className="text-xs text-surface-500 mt-1 bg-white p-1.5 rounded">{call.result}</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
