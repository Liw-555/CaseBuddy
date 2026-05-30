/**
 * CaseAgent — 长时工作 Agent
 * 用户输入公司/事件 → 自动完成：
 *   Plan → 网络检索 → 模型选择 → 多维框架分析 → 深度洞察 → PPT大纲 → PPT生成 → 豆包提示词
 * 详细展示每步进度和输出内容
 *
 * v2: 修复白屏 + 断点续传 + 历史保存
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  BrainCircuit, Globe, BarChart3, Lightbulb, Presentation, Sparkles,
  Play, StopCircle, ChevronDown, ChevronUp, CheckCircle2, XCircle,
  Loader2, Clock, Send, Download, Copy, Check, Zap, Target, FileText,
  Pause, RotateCcw, History, Trash2, ChevronRight, MessageSquare
} from 'lucide-react';

const API_BASE = 'http://localhost:3001/api';

// ─── 类型定义 ───

type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

interface AgentStep {
  id: string;
  name: string;
  description: string;
  icon: string; // lucide icon name for serialization
  status: StepStatus;
  output: string;
  startedAt?: number;
  completedAt?: number;
  expanded: boolean;
}

interface AgentJob {
  id: string;
  query: string;
  companies: string[];
  steps: AgentStep[];
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  finalPptxUrl?: string;
  // 断点续传
  currentStepIndex?: number; // 当前执行到第几步（-1=未开始）
}

// ─── Icon 映射 ───

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Target, Globe, BrainCircuit, BarChart3, Lightbulb, FileText, Presentation, Sparkles,
};

function getIcon(iconName: string): React.FC<{ className?: string }> {
  return ICON_MAP[iconName] || Target;
}

// ─── 初始步骤定义 ───

const STEP_DEFS: Omit<AgentStep, 'status' | 'output' | 'expanded' | 'startedAt' | 'completedAt'>[] = [
  { id: 'plan', name: '制定分析计划', description: 'Agent 分析任务，拆解步骤，选择分析框架', icon: 'Target' },
  { id: 'search', name: '网络检索 & 知识整合', description: '搜索公司近期动态、财务数据、行业新闻', icon: 'Globe' },
  { id: 'framework_select', name: '分析框架选择', description: '根据案例类型自动选择最适合的 MBA 分析模型', icon: 'BrainCircuit' },
  { id: 'analysis', name: '多维度框架分析', description: '运用选定框架进行结构化深度分析', icon: 'BarChart3' },
  { id: 'insight', name: '深度洞察思考', description: '挖掘非显性规律、跨行业类比、颠覆性假设', icon: 'Lightbulb' },
  { id: 'ppt_outline', name: 'PPT 大纲生成', description: '基于分析结果生成符合答辩逻辑的 PPT 大纲', icon: 'FileText' },
  { id: 'ppt_generate', name: 'PPT 生成', description: '将大纲转化为可下载的 .pptx 文件', icon: 'Presentation' },
  { id: 'doubao_prompt', name: '豆包润色提示词', description: '生成用于豆包 AI 进一步优化 PPT 的专业提示词', icon: 'Sparkles' },
];

function makeInitialSteps(): AgentStep[] {
  return STEP_DEFS.map(def => ({
    ...def,
    status: 'pending',
    output: '',
    expanded: false,
  }));
}

// ─── 状态样式 ───

const statusStyle: Record<StepStatus, { color: string; bg: string; label: string }> = {
  pending: { color: 'text-surface-400', bg: 'bg-surface-100', label: '等待' },
  running: { color: 'text-blue-500', bg: 'bg-blue-50', label: '执行中' },
  completed: { color: 'text-emerald-500', bg: 'bg-emerald-50', label: '完成' },
  failed: { color: 'text-red-500', bg: 'bg-red-50', label: '失败' },
  skipped: { color: 'text-surface-300', bg: 'bg-surface-50', label: '跳过' },
};

// ─── 历史持久化 ───

const HISTORY_KEY = 'casebuddy_agent_history';
const MAX_HISTORY = 20;

function loadHistory(): AgentJob[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(jobs: AgentJob[]) {
  try {
    const trimmed = jobs.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

function addToHistory(job: AgentJob) {
  const jobs = loadHistory();
  // 去重（同 ID）
  const filtered = jobs.filter(j => j.id !== job.id);
  filtered.unshift(job);
  saveHistory(filtered);
}

function updateHistory(job: AgentJob) {
  const jobs = loadHistory();
  const idx = jobs.findIndex(j => j.id === job.id);
  if (idx >= 0) {
    jobs[idx] = job;
    saveHistory(jobs);
  } else {
    addToHistory(job);
  }
}

function deleteFromHistory(jobId: string) {
  const jobs = loadHistory().filter(j => j.id !== jobId);
  saveHistory(jobs);
}

// ─── 主页面 ───

export default function CaseAgent() {
  const [query, setQuery] = useState('');
  const [companies, setCompanies] = useState('');
  const [job, setJob] = useState<AgentJob | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<AgentJob[]>(loadHistory);
  const [wxPushStatus, setWxPushStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // 断点续传 ref — 记录当前执行到哪一步
  const stepIndexRef = useRef(0);
  // ★ 关键修复：用 ref 追踪 paused 状态，避免 runAgentSteps 闭包读到旧值
  const pausedRef = useRef(false);
  // ★ 追踪任务是否正在异步执行中（用于导航切换后恢复状态）
  const runningRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), 100);
  }, []);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* ignore */ }
  };

  const toggleExpand = (stepId: string) => {
    setJob(prev => prev ? {
      ...prev,
      steps: prev.steps.map(s => s.id === stepId ? { ...s, expanded: !s.expanded } : s),
    } : prev);
  };

  const updateStep = (stepId: string, patch: Partial<AgentStep>) => {
    setJob(prev => prev ? {
      ...prev,
      updatedAt: Date.now(),
      steps: prev.steps.map(s => s.id === stepId ? { ...s, ...patch } : s),
    } : prev);
  };

  const appendOutput = (stepId: string, chunk: string) => {
    setJob(prev => prev ? {
      ...prev,
      updatedAt: Date.now(),
      steps: prev.steps.map(s => s.id === stepId ? { ...s, output: s.output + chunk } : s),
    } : prev);
    scrollToBottom();
  };

  // 持久化当前 job 到 localStorage（每次 job 更新时）
  useEffect(() => {
    if (job) {
      updateHistory(job);
    }
  }, [job]);

  // ★ 导航切换恢复：如果 job 状态是 running 但实际没有在运行（runningRef=false），
  // 说明是切换页面后回来的，自动将状态改为 paused 以便用户可以继续
  useEffect(() => {
    if (job && job.status === 'running' && !runningRef.current) {
      // 给一个小延迟，避免和正常的 setRunning 竞争
      const timer = setTimeout(() => {
        if (job.status === 'running' && !runningRef.current) {
          setJob(prev => prev && prev.status === 'running' && !runningRef.current
            ? { ...prev, status: 'paused', updatedAt: Date.now() }
            : prev
          );
          setPaused(true);
          setRunning(false);
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [job?.id]); // 只在 job.id 变化时触发（首次加载/从历史恢复）

  // ─── 流式执行单步 ───

  const runStreamStep = async (stepId: string, prompt: string): Promise<boolean> => {
    updateStep(stepId, { status: 'running', startedAt: Date.now(), expanded: true, output: '' });
    scrollToBottom();

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      // 获取模型配置
      let baseUrl = 'https://chat.ecnu.edu.cn/open/api/v1';
      let apiKey = '';
      let model = 'ecnu-plus';
      try {
        const stored = localStorage.getItem('casebuddy-models');
        const models = stored ? JSON.parse(stored) : [];
        const mc = models.find((m: any) => m.isDefault) || models[0];
        if (mc) {
          baseUrl = mc.baseUrl || baseUrl;
          apiKey = mc.apiKey || '';
          model = mc.model || model;
        }
      } catch { /* ignore */ }

      // ── 优先使用流式端点 ──
      try {
        const resp = await fetch(`${API_BASE}/proxy/chat/completions/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            baseUrl,
            apiKey,
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 3000,
            stream: true,
          }),
          signal: controller.signal,
        });

        if (resp.ok && resp.body) {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

            while (true) {
            // 检查是否暂停（用 ref 而非 state，避免闭包陈旧值）
            if (pausedRef.current) {
              reader.cancel();
              updateStep(stepId, { status: 'pending', output: '', startedAt: undefined });
              return false; // paused
            }

            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') break;
                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta?.content
                    ?? parsed.delta?.content
                    ?? parsed.content
                    ?? '';
                  if (delta) appendOutput(stepId, delta);
                } catch { /* ignore malformed SSE */ }
              }
            }
          }

          updateStep(stepId, { status: 'completed', completedAt: Date.now() });
          return true;
        }
      } catch (e: any) {
        if (e?.name === 'AbortError' || pausedRef.current) {
          updateStep(stepId, { status: 'pending', output: '', startedAt: undefined });
          return false;
        }
        console.warn('[CaseAgent] 流式请求失败，尝试 fallback:', e.message);
      }

      // ── Fallback: 非流式端点 ──
      try {
        const fallbackResp = await fetch(`${API_BASE}/gateway/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: prompt }),
        });
        if (fallbackResp.ok) {
          const data = await fallbackResp.json();
          const text = data.response || data.text || JSON.stringify(data) || '（无输出）';
          updateStep(stepId, { status: 'completed', completedAt: Date.now(), output: text });
          scrollToBottom();
          return true;
        }
        const errText = await fallbackResp.text().catch(() => '');
        throw new Error(`Fallback HTTP ${fallbackResp.status}: ${errText}`);
      } catch (e2: any) {
        if (e2?.name === 'AbortError' || pausedRef.current) {
          updateStep(stepId, { status: 'pending', output: '', startedAt: undefined });
          return false;
        }
        // 标记失败 — output 必须是字符串，不能是函数！
        updateStep(stepId, {
          status: 'failed',
          completedAt: Date.now(),
          output: `\u274c 执行失败：${e2?.message || String(e2)}\n\n请重试此步骤或检查后端服务是否正常运行。`,
        });
        return true; // 不要中断整个流程，继续下一步
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || pausedRef.current) {
        updateStep(stepId, { status: 'pending', output: '', startedAt: undefined });
        return false;
      }
      updateStep(stepId, {
        status: 'failed',
        completedAt: Date.now(),
        output: `\u274c 未知错误：${String(err)}`,
      });
      return true;
    }
  };

  // ─── 构建 prompt ───

  const buildPrompts = (queryText: string, companyList: string[]): Record<string, string> => {
    const cs = companyList.length > 0
      ? `\n\n分析对象：${companyList.join('、')}`
      : '';
    const companyNote = companyList.length > 0
      ? `（${companyList.join('、')}）`
      : '';

    return {
      plan: `你是一个MBA案例分析专家Agent。请对以下任务进行详细规划：

任务：${queryText}${cs}

请输出以下内容：
1. **任务理解**：这是什么类型的分析（战略/财务/商业模式/竞争分析等）
2. **分析维度规划**：列出将要分析的5-8个核心维度
3. **推荐分析框架**：选出3个最适合的MBA框架并说明原因（SWOT/波特五力/BMC/财务三表/MECE等）
4. **数据需求**：需要哪些关键数据和信息
5. **预期输出结构**：最终报告的结构大纲

直接输出，不要有任何前置说明。`,

      search: `你正在协助分析"${queryText}"${cs}。

请模拟一个专业调研人员，整合以下信息（基于你的知识库）：

1. **公司基本情况**${companyNote}：成立时间、主营业务、收入规模、市值/估值
2. **近期重要动态**（2023-2025年）：重大战略调整、并购、产品发布、人事变动
3. **财务数据摘要**：营收增速、利润率、现金流关键指标
4. **行业背景**：行业规模、增速、主要玩家、近期趋势
5. **相关事件时间线**：与分析主题直接相关的5-10个关键事件

请明确标注信息来源（知识截止日期）。如有不确定信息，标注"需进一步核实"。`,

      framework_select: `基于前面的规划和信息整合，针对"${queryText}"${cs}，请进行分析框架的精确选择和定制：

1. **主框架选择**（选1-2个最核心的）：
   - 框架名称
   - 选择理由（与本案例的匹配度）
   - 该框架在本案例中的重点模块

2. **辅助框架**（选1-2个）：
   - 框架名称及补充分析的价值

3. **框架组合逻辑**：这几个框架如何配合，形成完整分析体系

4. **分析重心**：哪个维度是本案例最核心、最值得深挖的

输出完成后，给出一个简洁的"分析框架图谱"示意。`,

      analysis: `现在对"${queryText}"${cs}进行全面深度的结构化分析。

请按以下结构输出（每个部分都要有实质性内容，不要空洞）：

## 一、核心背景与情境设置
- 关键背景事实（3-5条，每条配数据）
- 分析的核心问题是什么

## 二、[主框架分析]（按前面选定的框架展开）
（如SWOT：S/W/O/T各5条以上，每条有具体数据或事实支撑）
（如波特五力：每力详细分析+1-5分评分+权重）
（如BMC：九要素逐一填写）

## 三、[辅助框架分析]
- 补充视角下的关键发现

## 四、核心矛盾与关键问题
- 企业/事件面临的3个核心战略矛盾
- 每个矛盾的成因、影响和可能出路

## 五、战略选项评估
- 列出3个可行战略选项
- 用简单的SAFe框架（适宜/可接受/可行）评估

请用Markdown格式输出，适当使用表格。`,

      insight: `基于前面对"${queryText}"${cs}的分析，现在进行深度洞察挖掘：

## 洞察一：被忽略的关键视角
请提供3个非主流但极具价值的分析视角——那些常规分析报告不会提到的洞察

## 洞察二：跨行业类比
找出2-3个与本案例有相似模式的其他行业/公司案例，分析其成败得失对本案例的启示

## 洞察三：颠覆性假设
提出1个核心假设：「如果[关键假设]是错误的，一切将如何改变？」

## 洞察四：反向思维
常规结论是A，但如果从对立面思考：「不A」的逻辑是什么？这有什么价值？

## 洞察五：第二序变化
表面现象背后，有什么深层的系统性变化正在发生？这对未来3-5年意味着什么？

## 综合洞察结论
整合以上，给出1-2个"最值得关注但最容易被忽视"的核心洞察`,

      ppt_outline: `基于对"${queryText}"${cs}的完整分析，生成一份专业MBA答辩PPT大纲。

要求：
- 遵循MECE原则，每页只讲一个核心观点
- 每张幻灯片标题使用Action Title（观点句，而非描述句）
- 符合金字塔原理：结论先行
- 总共12-16张幻灯片
- 适合15-20分钟答辩

请按以下格式输出：

---
**PPT大纲**

**封面**
- 标题：[演讲主标题]
- 副标题：[副标题]

**目录页**（建议3-4个章节）

**[第一章节名]**（建议3-4张）
- 第1张：[Action Title] | 核心内容：[1句话]
- 第2张：[Action Title] | 核心内容：[1句话]
...

（以此类推）

**结论页**
- 标题：[核心结论]
- 内容：3个最重要的战略建议

**问答准备页**（可选）
- 预判评委最可能问的2-3个问题

---

所有幻灯片标题必须是完整的观点句（如"安踏多品牌战略已从风险积累期进入规模收益期"），而非描述性标题（如"品牌战略分析"）。`,

      doubao_prompt: `基于对"${queryText}"${cs}的完整分析结果，生成一套专业的豆包AI PPT润色提示词。

请生成以下3类提示词：

---
## 提示词一：整体风格优化

[直接可复制使用的提示词]

---
## 提示词二：数据可视化优化

[直接可复制使用的提示词]

---
## 提示词三：逐页深度润色（通用模板）

[直接可复制使用的提示词]

---
## 提示词四：答辩演讲稿生成

[直接可复制使用的提示词]

---

每个提示词必须：
1. 可以直接粘贴到豆包对话框使用，不需要修改
2. 包含具体的风格要求（如配色、字体、图表类型）
3. 引用本案例的具体内容（公司名、框架名、核心观点）
4. 字数在200-400字之间`,
    };
  };

  // ─── PPT 生成步骤 ───

  const runPptStep = async (jobRef: AgentJob, queryText: string, companyList: string[]): Promise<boolean> => {
    updateStep('ppt_generate', { status: 'running', startedAt: Date.now(), expanded: true });

    try {
      // 获取 outline 文本（直接从 jobRef 读取，不依赖 setState 副作用）
      const outlineStep = jobRef.steps.find(s => s.id === 'ppt_outline');
      const outlineText = outlineStep?.output || '';

      const resp = await fetch(`${API_BASE}/ppt/generate-from-outline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outline: outlineText || `请基于"${queryText}"的分析生成PPT`,
          title: queryText,
          companies: companyList,
        }),
        signal: abortRef.current?.signal,
      });

      if (resp.ok) {
        const data = await resp.json();
        const pptxUrl = data.downloadUrl || data.url;
        updateStep('ppt_generate', {
          status: 'completed',
          completedAt: Date.now(),
          output: `\u2705 PPT 已生成！\n\n下载链接：${pptxUrl || '（见右侧下载按钮）'}\n\n共 ${data.slideCount || '?'} 张幻灯片`,
        });
        setJob(prev => prev ? { ...prev, finalPptxUrl: pptxUrl } : prev);
      } else {
        const err = await resp.json().catch(() => ({}));
        updateStep('ppt_generate', {
          status: 'failed',
          completedAt: Date.now(),
          output: `PPT 生成失败：${err.error || resp.statusText}\n\n大纲已在上一步保存，可手动在 PPT 助手页面生成。`,
        });
      }
      return true;
    } catch (e: any) {
      if (e?.name === 'AbortError' || pausedRef.current) {
        updateStep('ppt_generate', { status: 'pending', output: '', startedAt: undefined });
        return false;
      }
      updateStep('ppt_generate', {
        status: 'failed',
        completedAt: Date.now(),
        output: `PPT 生成出错：${String(e)}\n\n大纲已在上一步保存，可手动在 PPT 助手页面生成。`,
      });
      return true;
    }
  };

  // ─── 执行 Agent 步骤（支持从断点续传） ───

  const runAgentSteps = async (queryText: string, companyList: string[], startFromIndex: number = 0) => {
    const prompts = buildPrompts(queryText, companyList);
    const stepsOrder = ['plan', 'search', 'framework_select', 'analysis', 'insight', 'ppt_outline', 'ppt_generate', 'doubao_prompt'];

    for (let i = startFromIndex; i < stepsOrder.length; i++) {
      // 检查是否暂停（用 ref，闭包安全）
      if (pausedRef.current) {
        stepIndexRef.current = i;
        setJob(prev => prev ? { ...prev, currentStepIndex: i, status: 'paused', updatedAt: Date.now() } : prev);
        runningRef.current = false;
        setRunning(false);
        return;
      }

      const stepId = stepsOrder[i];
      stepIndexRef.current = i;
      setJob(prev => prev ? { ...prev, currentStepIndex: i, updatedAt: Date.now() } : prev);

      if (stepId === 'ppt_generate') {
        // PPT 生成不走流式
        const currentJob = job;
        if (currentJob) {
          const ok = await runPptStep(currentJob, queryText, companyList);
          if (!ok) return; // paused
        }
      } else if (prompts[stepId]) {
        const ok = await runStreamStep(stepId, prompts[stepId]);
        if (!ok) return; // paused
      }
    }

    // 全部完成
    setJob(prev => prev ? { ...prev, status: 'completed', updatedAt: Date.now(), currentStepIndex: stepsOrder.length } : prev);
    runningRef.current = false;
  };

  // ─── 操作按钮 ───

  const handleRun = async () => {
    if (!query.trim()) return;

    if (running) {
      // 暂停（不是停止）
      pausedRef.current = true;   // ★ 同步更新 ref
      setPaused(true);
      abortRef.current?.abort();
      setRunning(false);
      runningRef.current = false;
      return;
    }

    if (paused && job) {
      // 从断点继续
      pausedRef.current = false;  // ★ 同步更新 ref
      setPaused(false);
      setRunning(true);
      runningRef.current = true;
      setJob(prev => prev ? { ...prev, status: 'running', updatedAt: Date.now() } : prev);

      try {
        await runAgentSteps(job.query, job.companies, job.currentStepIndex ?? 0);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('Agent error:', err);
        }
      } finally {
        setRunning(false);
        runningRef.current = false;
      }
      return;
    }

    // 新建任务
    const newJob: AgentJob = {
      id: `agent_${Date.now()}`,
      query: query.trim(),
      companies: companies.split(/[，,、\n]/).map(s => s.trim()).filter(Boolean),
      steps: makeInitialSteps(),
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      currentStepIndex: 0,
    };
    setJob(newJob);
    setRunning(true);
    runningRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    addToHistory(newJob);

    try {
      await runAgentSteps(newJob.query, newJob.companies, 0);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('Agent error:', err);
      }
    } finally {
      setRunning(false);
      runningRef.current = false;
    }
  };

  const handleStop = () => {
    pausedRef.current = false;
    runningRef.current = false;
    abortRef.current?.abort();
    setRunning(false);
    setPaused(false);
    setJob(prev => prev ? { ...prev, status: 'failed', updatedAt: Date.now() } : prev);
  };

  const handleNewJob = () => {
    pausedRef.current = false;
    runningRef.current = false;
    abortRef.current?.abort();
    setJob(null);
    setRunning(false);
    setPaused(false);
    setQuery('');
    setCompanies('');
  };

  // 从历史加载
  const handleLoadHistory = (histJob: AgentJob) => {
    // 如果历史记录是"运行中"状态，实际已经中断了，改为暂停状态以便恢复
    if (histJob.status === 'running') {
      histJob = { ...histJob, status: 'paused' };
    }
    setJob(histJob);
    setQuery(histJob.query);
    setCompanies(histJob.companies.join(', '));
    setShowHistory(false);
    setRunning(false);
    runningRef.current = false;
    setPaused(histJob.status === 'paused');
  };

  const handleDeleteHistory = (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteFromHistory(jobId);
    setHistory(loadHistory());
    if (job?.id === jobId) {
      handleNewJob();
    }
  };

  // ─── 推送到微信 ───
  const handlePushToWeChat = async () => {
    if (!job) return;
    setWxPushStatus('sending');
    try {
      const steps = job.steps.filter(s => s.status === 'completed' && s.output.trim());
      if (steps.length === 0) {
        setWxPushStatus('empty');
        setTimeout(() => setWxPushStatus(null), 2000);
        return;
      }
      // 构造各步骤摘要
      const reportParts = steps.map(s =>
        `【${s.name}】\n${s.output.substring(0, 600)}${s.output.length > 600 ? '...(完整版请查看网页)' : ''}`
      ).join('\n\n---\n\n');

      // 通过网关 API 发送
      const gatewayBase = 'http://localhost:3002';
      const resp = await fetch(`${gatewayBase}/push-wechat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: job.query,
          content: reportParts,
          to_user_id: '',
        }),
      });

      if (resp.ok) {
        const data = await resp.json();
        if (data.status === 'ok') {
          setWxPushStatus('ok');
        } else {
          setWxPushStatus('error');
        }
      } else {
        setWxPushStatus('error');
      }
    } catch {
      setWxPushStatus('error');
    }
    setTimeout(() => setWxPushStatus(null), 3000);
  };

  const totalSteps = job?.steps.length ?? 0;
  const completedSteps = job?.steps.filter(s => s.status === 'completed').length ?? 0;
  const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  // ─── 渲染 ───

  return (
    <div className="h-full flex flex-col bg-surface-50 relative">
      {/* ─── 固定浮动控制按钮（始终可见，不依赖滚动） ─── */}
      {(running || paused) && job && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 shadow-xl">
          {running && (
            <button
              onClick={handleRun}
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm rounded-full transition-all shadow-lg hover:shadow-xl animate-bounce-once"
              title="暂停任务"
            >
              <Pause className="w-4 h-4" />
              <span className="font-medium">暂停</span>
            </button>
          )}
          {paused && (
            <button
              onClick={handleRun}
              className="flex items-center gap-2 px-4 py-2.5 bg-violet-500 hover:bg-violet-600 text-white text-sm rounded-full transition-all shadow-lg hover:shadow-xl"
              title="继续执行"
            >
              <Play className="w-4 h-4" />
              <span className="font-medium">继续执行</span>
            </button>
          )}
          <button
            onClick={handleStop}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-full transition-all shadow-lg hover:shadow-xl"
            title="终止任务"
          >
            <StopCircle className="w-4 h-4" />
            <span className="font-medium">终止</span>
          </button>
        </div>
      )}
      {/* ─── Header ─── */}
      <div className="bg-white border-b border-surface-200 px-6 py-4 flex-shrink-0">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-gradient-to-br from-violet-500 to-purple-600 rounded-xl">
              <BrainCircuit className="w-5 h-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-surface-900">CaseAgent</h1>
              <p className="text-xs text-surface-500">长时自主分析 · 从输入到 PPT 全自动完成</p>
            </div>
            {/* 历史记录按钮 */}
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors
                ${showHistory ? 'bg-violet-100 text-violet-700' : 'bg-surface-100 text-surface-600 hover:bg-surface-200'}`}
            >
              <History className="w-3.5 h-3.5" />
              历史记录
            </button>
            {job?.status === 'running' && (
              <div className="flex items-center gap-2 text-sm text-blue-600">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{completedSteps}/{totalSteps} 步</span>
              </div>
            )}
            {job?.status === 'paused' && (
              <div className="flex items-center gap-2 text-sm text-amber-600">
                <Pause className="w-4 h-4" />
                <span>已暂停</span>
              </div>
            )}
            {job?.status === 'completed' && (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="w-4 h-4" />
                <span>完成</span>
              </div>
            )}
          </div>
          {/* 进度条 */}
          {job && (
            <div className="mt-3">
              <div className="flex justify-between text-xs text-surface-400 mb-1">
                <span>总体进度</span>
                <span>{progress}%</span>
              </div>
              <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Content ─── */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-4">

          {/* ─── 历史记录面板 ─── */}
          {showHistory && (
            <div className="bg-white rounded-2xl border border-surface-200 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-surface-700 flex items-center gap-2">
                  <History className="w-4 h-4 text-violet-500" />
                  历史分析记录
                </h3>
                {history.length > 0 && (
                  <span className="text-xs text-surface-400">{history.length} 条记录</span>
                )}
              </div>
              {history.length === 0 ? (
                <p className="text-sm text-surface-400 text-center py-6">暂无历史记录</p>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-thin">
                  {history.map(hj => {
                    const completed = hj.steps.filter(s => s.status === 'completed').length;
                    const total = hj.steps.length;
                    const dateStr = new Date(hj.createdAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const statusLabel = hj.status === 'completed' ? '已完成' : hj.status === 'paused' ? '已暂停' : hj.status === 'running' ? '进行中' : '失败';
                    const statusColor = hj.status === 'completed' ? 'text-emerald-600 bg-emerald-50' : hj.status === 'paused' ? 'text-amber-600 bg-amber-50' : 'text-red-500 bg-red-50';

                    return (
                      <div
                        key={hj.id}
                        onClick={() => handleLoadHistory(hj)}
                        className="flex items-center gap-3 p-3 rounded-xl hover:bg-surface-50 cursor-pointer transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-surface-800 truncate">{hj.query}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-surface-400">{dateStr}</span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${statusColor}`}>{statusLabel}</span>
                            <span className="text-xs text-surface-400">{completed}/{total} 步</span>
                            {hj.companies.length > 0 && (
                              <span className="text-xs text-surface-400">对象: {hj.companies.join(', ')}</span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => handleDeleteHistory(hj.id, e)}
                          className="p-1.5 text-surface-300 hover:text-red-500 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                          title="删除记录"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ─── 输入区 ─── */}
          {!running && !paused && (!job || job.status === 'completed' || job.status === 'failed') && (
            <div className="bg-white rounded-2xl border border-surface-200 p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-surface-700 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-500" />
                新建分析任务
              </h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1.5">
                    分析主题 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="例：分析安踏体育近三年多品牌战略转型的成效与挑战"
                    className="w-full px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-xl text-sm
                      focus:ring-2 focus:ring-violet-500/25 focus:border-violet-400 outline-none"
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleRun()}
                  />
                  <p className="text-xs text-surface-400 mt-1">
                    可以是"分析某公司某年度战略"、"分析某行业趋势"、"对比A与B的竞争格局"等
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-surface-600 mb-1.5">
                    分析对象公司（可选，多个用逗号分隔）
                  </label>
                  <input
                    type="text"
                    value={companies}
                    onChange={e => setCompanies(e.target.value)}
                    placeholder="例：安踏体育，耐克，李宁"
                    className="w-full px-4 py-2.5 bg-surface-50 border border-surface-200 rounded-xl text-sm
                      focus:ring-2 focus:ring-violet-500/25 focus:border-violet-400 outline-none"
                  />
                </div>
                <button
                  onClick={handleRun}
                  disabled={!query.trim()}
                  className="w-full py-3 bg-gradient-to-br from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700
                    disabled:from-surface-300 disabled:to-surface-300 text-white rounded-xl font-semibold
                    flex items-center justify-center gap-2 transition-all shadow-lg shadow-violet-500/25 hover:shadow-xl"
                >
                  <Play className="w-4 h-4" />
                  开始自主分析
                </button>
              </div>

              {/* 示例 */}
              <div className="mt-4 pt-4 border-t border-surface-100">
                <p className="text-xs font-medium text-surface-500 mb-2">示例任务</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    '分析安踏体育多品牌战略',
                    '百度AI转型路径分析',
                    '东方财富商业模式研究',
                    '分析中国新能源汽车行业竞争格局',
                  ].map(example => (
                    <button
                      key={example}
                      onClick={() => setQuery(example)}
                      className="text-xs px-3 py-1.5 bg-violet-50 text-violet-600 rounded-lg hover:bg-violet-100 transition-colors"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ─── 任务信息栏（运行中 / 暂停 / 完成） ─── */}
          {(running || paused || job?.status === 'running' || job?.status === 'completed' || job?.status === 'paused' || job?.status === 'failed') && job && (
            <div className={`rounded-2xl border p-4 flex items-start gap-3
              ${job.status === 'completed' ? 'bg-emerald-50 border-emerald-200' :
                job.status === 'paused' ? 'bg-amber-50 border-amber-200' :
                job.status === 'failed' ? 'bg-red-50 border-red-200' :
                'bg-violet-50 border-violet-200'}`}
            >
              <div className={`p-2 rounded-lg flex-shrink-0
                ${job.status === 'completed' ? 'bg-emerald-100' :
                  job.status === 'paused' ? 'bg-amber-100' :
                  job.status === 'failed' ? 'bg-red-100' :
                  'bg-violet-100'}`}
              >
                <Target className={`w-4 h-4
                  ${job.status === 'completed' ? 'text-emerald-600' :
                    job.status === 'paused' ? 'text-amber-600' :
                    job.status === 'failed' ? 'text-red-500' :
                    'text-violet-600'}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-semibold
                  ${job.status === 'completed' ? 'text-emerald-800' :
                    job.status === 'paused' ? 'text-amber-800' :
                    job.status === 'failed' ? 'text-red-800' :
                    'text-violet-800'}`}
                >
                  {job.query}
                </div>
                {job.companies.length > 0 && (
                  <div className="text-xs text-surface-500 mt-0.5">
                    分析对象：{job.companies.join('、')}
                  </div>
                )}
                {job.status === 'paused' && job.currentStepIndex !== undefined && job.currentStepIndex < STEP_DEFS.length && (
                  <div className="text-xs text-amber-600 mt-1">
                    已暂停于：{STEP_DEFS[job.currentStepIndex]?.name || '未知步骤'}（可点击"继续执行"从断点恢复）
                  </div>
                )}
              </div>
              {/* 操作按钮组 */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {running && (
                  <button
                    onClick={handleRun}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg transition-colors"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    暂停
                  </button>
                )}
                {paused && (
                  <button
                    onClick={handleRun}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white text-xs rounded-lg transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    继续执行
                  </button>
                )}
                {(running || paused) && (
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg transition-colors"
                  >
                    <StopCircle className="w-3.5 h-3.5" />
                    终止
                  </button>
                )}
                {!running && !paused && (
                  <button
                    onClick={handleNewJob}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white text-xs rounded-lg transition-colors"
                  >
                    <Play className="w-3.5 h-3.5" />
                    新建任务
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ─── 步骤列表 ─── */}
          {job && job.steps.map((step, idx) => {
            const st = statusStyle[step.status];
            const StepIcon = getIcon(step.icon);
            const hasOutput = step.output.trim().length > 0;
            const duration = step.startedAt && step.completedAt
              ? ((step.completedAt - step.startedAt) / 1000).toFixed(1)
              : null;

            return (
              <div
                key={step.id}
                className={`bg-white rounded-2xl border transition-all duration-300 shadow-sm
                  ${step.status === 'running' ? 'border-blue-300 shadow-blue-100' : ''}
                  ${step.status === 'completed' ? 'border-emerald-200' : ''}
                  ${step.status === 'failed' ? 'border-red-200' : ''}
                  ${step.status === 'pending' ? 'border-surface-200 opacity-60' : ''}`}
              >
                {/* 步骤头部 */}
                <div
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none
                    ${hasOutput ? 'hover:bg-surface-50' : ''} rounded-t-2xl transition-colors`}
                  onClick={() => hasOutput && toggleExpand(step.id)}
                >
                  {/* 序号 */}
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${step.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : ''}
                    ${step.status === 'running' ? 'bg-blue-100 text-blue-600' : ''}
                    ${step.status === 'failed' ? 'bg-red-100 text-red-500' : ''}
                    ${step.status === 'pending' ? 'bg-surface-100 text-surface-400' : ''}`}
                  >
                    {step.status === 'running' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : step.status === 'completed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      idx + 1
                    )}
                  </div>

                  {/* 图标 */}
                  <div className={`p-1.5 rounded-lg flex-shrink-0 ${st.bg}`}>
                    <StepIcon className={`w-4 h-4 ${st.color}`} />
                  </div>

                  {/* 名称 & 描述 */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-surface-800">{step.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded-full ${st.bg} ${st.color}`}>
                        {st.label}
                      </span>
                      {duration && (
                        <span className="text-xs text-surface-400">{duration}s</span>
                      )}
                    </div>
                    <div className="text-xs text-surface-400 truncate">{step.description}</div>
                  </div>

                  {/* 操作 */}
                  {hasOutput && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={e => { e.stopPropagation(); handleCopy(step.output, step.id); }}
                        className="p-1.5 text-surface-400 hover:text-surface-600 rounded-lg hover:bg-surface-100 transition-colors"
                        title="复制输出"
                      >
                        {copied === step.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      {step.expanded
                        ? <ChevronUp className="w-4 h-4 text-surface-400" />
                        : <ChevronDown className="w-4 h-4 text-surface-400" />
                      }
                    </div>
                  )}
                </div>

                {/* 输出内容 */}
                {(step.expanded || step.status === 'running') && hasOutput && (
                  <div className="px-4 pb-4">
                    <div className="h-px bg-surface-100 mb-3" />
                    <div
                      className="text-sm text-surface-700 whitespace-pre-wrap leading-relaxed font-mono
                        bg-surface-50 rounded-xl p-4 border border-surface-100 max-h-[500px] overflow-y-auto scrollbar-thin"
                    >
                      {step.output}
                      {step.status === 'running' && (
                        <span className="inline-block w-1.5 h-4 bg-blue-400 animate-pulse ml-0.5 rounded-sm" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* ─── 完成后的下载区 ─── */}
          {job?.status === 'completed' && (
            <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-2xl border border-emerald-200 p-5">
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                <h3 className="font-semibold text-emerald-800">分析完成！</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => {
                    const allOutput = job.steps
                      .filter(s => s.status === 'completed')
                      .map(s => `## ${s.name}\n\n${s.output}`)
                      .join('\n\n---\n\n');
                    handleCopy(allOutput, 'full-report');
                  }}
                  className="flex items-center justify-center gap-2 py-2.5 bg-white border border-emerald-200 text-emerald-700 rounded-xl text-sm hover:bg-emerald-50 transition-colors"
                >
                  {copied === 'full-report' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  复制完整报告
                </button>
                {job.finalPptxUrl && (
                  <a
                    href={`${API_BASE.replace('/api', '')}${job.finalPptxUrl}`}
                    download
                    className="flex items-center justify-center gap-2 py-2.5 bg-emerald-500 text-white rounded-xl text-sm hover:bg-emerald-600 transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    下载 PPTX
                  </a>
                )}
                <button
                  onClick={handlePushToWeChat}
                  disabled={wxPushStatus === 'sending'}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-colors
                    ${wxPushStatus === 'ok' ? 'bg-green-100 border border-green-200 text-green-700' :
                      wxPushStatus === 'error' ? 'bg-red-100 border border-red-200 text-red-700' :
                      wxPushStatus === 'empty' ? 'bg-surface-100 border border-surface-200 text-surface-400' :
                      'bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 cursor-pointer'}`}
                >
                  <MessageSquare className="w-4 h-4" />
                  {wxPushStatus === 'sending' ? '发送中...' :
                   wxPushStatus === 'ok' ? '已推送' :
                   wxPushStatus === 'error' ? '推送失败' :
                   wxPushStatus === 'empty' ? '无内容' :
                   '推送到微信'}
                </button>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
