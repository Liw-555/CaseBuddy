# CaseBuddy v3 技术深度解读

> **视角**：如何构建一个 Harness Buddy —— 从「裸模型」到「能干活的 AI 助手」
>
> **适用场景**：MBA 案例分析大赛 AI 助手产品
>
> **讲解时长**：30-60 分钟

---

## 目录

- [Part 1：构建一个 Buddy 需要什么？—— Harness 工程全景](#part-1构建一个-buddy-需要什么harness-工程全景)
  - [1.1 什么是 Harness？Agent = Model + Harness](#11-什么是-harnessagent--model--harness)
  - [1.2 六大核心组件](#12-六大核心组件)
  - [1.3 记忆系统：场景/语义/程序三重记忆](#13-记忆系统场景语义程序三重记忆)
- [Part 2：CaseBuddy 架构设计](#part-2casebuddy-架构设计)
  - [2.1 三层架构全景图](#21-三层架构全景图)
  - [2.2 技术栈与依赖全景](#22-技术栈与依赖全景)
  - [2.3 目录结构](#23-目录结构)
- [Part 3：各组件深度解读（对照业界方案）](#part-3各组件深度解读对照业界方案)
  - [3.1 前端层 —— React SPA](#31-前端层--react-spa)
  - [3.2 后端层 —— Node.js + Express](#32-后端层--nodejs--express)
  - [3.3 网关层 —— Python Bot 管理中心](#33-网关层--python-bot-管理中心)
  - [3.4 LLM 层 —— 大模型接入与路由](#34-llm-层--大模型接入与路由)
  - [3.5 记忆层 —— 对话记忆与上下文管理](#35-记忆层--对话记忆与上下文管理)
  - [3.6 RAG 层 —— BM25 检索增强](#36-rag-层--bm25-检索增强)
  - [3.7 工作流引擎 —— 多步骤编排](#37-工作流引擎--多步骤编排)
  - [3.8 文件解析层](#38-文件解析层)
  - [3.9 导出层](#39-导出层)
- [Part 4：导航模块逐一讲解](#part-4导航模块逐一讲解)
  - [4.1 首页（Home）](#41-首页home)
  - [4.2 分析工作台（WorkBench）](#42-分析工作台workbench)
  - [4.3 CaseAgent（智能案例代理）](#43-caseagent智能案例代理)
  - [4.4 AI PPT 助手](#44-ai-ppt-助手)
  - [4.5 PPT 对比分析](#45-ppt-对比分析)
  - [4.6 微信助手（WeChatAssistant）](#46-微信助手wechatassistant)
  - [4.7 智能工作流（WorkflowPage）](#47-智能工作流workflowpage)
  - [4.8 技能市场（SkillMarket）](#48-技能市场skillmarket)
  - [4.9 模型配置（ModelConfig）](#49-模型配置modelconfig)
  - [4.10 消息网关（GatewayConfig）](#410-消息网关gatewayconfig)
- [Part 5：关键技术深度剖析](#part-5关键技术深度剖析)
  - [5.1 微信 iLink Bot —— 核心技术揭秘](#51-微信-ilink-bot--核心技术揭秘)
  - [5.2 飞书 Bot —— WebSocket 长连接](#52-飞书-bot--websocket-长连接)
  - [5.3 Windows GBK 编码 —— 四层防御体系](#53-windows-gbk-编码--四层防御体系)
  - [5.4 TypeScript 模块加载顺序陷阱](#54-typescript-模块加载顺序陷阱)
  - [5.5 React 闭包陷阱与 runningRef](#55-react-闭包陷阱与-runningref)
  - [5.6 纯 Node.js PPT 解析（无 Python 依赖）](#56-纯-nodejs-ppt-解析无-python-依赖)
- [Part 6：与市面 Buddy/Claw 方案对比](#part-6与市面-buddyclaw-方案对比)
- [Part 7：中文讲稿](#part-7中文讲稿)

---

## Part 1：构建一个 Buddy 需要什么？—— Harness 工程全景

### 1.1 什么是 Harness？Agent = Model + Harness

2026 年业界提出的核心公式：

```
Agent = LLM Model + Harness
```

- **Model（模型）**：只提供推理和生成能力，是一个"裸脑"
- **Harness（套件）**：模型之外的整套系统，把状态、工具、反馈、执行环境和安全边界串联起来

> 比喻：**模型是 CPU，Harness 是操作系统。** CPU 再强，OS 如果天天崩，体验也不会好。

**裸模型的四大硬伤**（为什么光有模型不够）：

| 硬伤 | 缺失能力 | Harness 如何补 |
|------|----------|---------------|
| 无记忆 | 跨会话状态丢失 | 记忆系统 |
| 不能执行代码 | 只能"说"不能"做" | 执行环境 |
| 知识过时 | 训练数据截止 | Web Search / RAG |
| 无工作环境 | 不能操作文件 | 文件系统 |

### 1.2 六大核心组件

构建一个完整的 Buddy，通常需要以下六大组件，以及调用工具的能力：

```
┌─────────────────────────────────────────────────┐
│           System Prompt（行为规范）                │
├─────────────────────────────────────────────────┤
│ ① 前端界面      │ 用户交互、状态展示              │
│ ② 后端服务      │ API路由、业务逻辑、文件处理     │
│ ③ 网关层        │ 多渠道消息接入（微信/飞书/...） │
│ ④ 记忆系统      │ 会话记忆 + 持久记忆 + Skill     │
│ ⑤ 工作流引擎    │ 多步骤任务编排                  │
│ ⑥ LLM 接入层    │ 大模型API调用与路由             │
└─────────────────────────────────────────────────┘
```

### 1.3 记忆系统：场景/语义/程序三重记忆

认知科学将人类记忆分为三大类，AI Agent 的记忆系统也遵循同样分类：

| 记忆类型 | 认知科学含义 | AI Agent 对应 | CaseBuddy 实现 |
|---------|------------|--------------|---------------|
| **场景记忆** (Episodic) | "发生了什么"——具体事件、经历 | 会话记忆 (Session Memory) | ✅ 前端 `SessionContext`，网关 `session_summary` |
| **语义记忆** (Semantic) | "世界是什么"——知识、概念、事实 | 持久记忆 (Long-term Memory) | ⚠️ 部分实现：`gateway_config.json`、`push_history.json` |
| **程序记忆** (Procedural) | "怎么做事"——操作步骤、流程 | Skill / 工作流模板 | ✅ **充分实现**：5个预设工作流模板 + RAG知识库 + 分析框架 |

#### 1.3.1 场景记忆（Episodic Memory）—— "发生了什么"

**业界方案对比**：

| 产品/框架 | 场景记忆实现 | 特点 |
|----------|------------|------|
| **MemGPT** (10k+ stars) | 三层金字塔：Core Memory(2-4K token) + Recall Memory(对话历史) + Archival Memory(向量存储) | 最经典的 Agent 记忆架构 |
| **OpenClaw** (开源) | 按"发送者"自动隔离会话，每个会话独立 | 自动多会话管理 |
| **mem0** (25k+ stars) | 向量+图双引擎，带时间戳和用户ID | 支持关系推理 |
| **CaseBuddy** | 前端 `useContext(SessionContext)` 管理当前会话的 messages 数组 + 网关缓存最近20条 session_summary | **轻量实现**：无向量数据库，纯数组缓存 |

**CaseBuddy 的场景记忆设计**：

```typescript
// frontend/src/contexts/SessionContext.tsx
// 核心状态就是 messages 数组——对话的完整历史
const [sessions, setSessions] = useState<Session[]>([]);
// 每个 Session = { id, title, messages: Message[], createdAt }
// Message = { role: 'user'|'assistant', content: string }
```

```python
# gateway-python/gateway_server.py (line 109)
self.session_summary = []  # 缓存最近20条，用于微信端查看/推送
```

**与业界的差距**：没有向量嵌入（Embedding）和持久化检索，纯内存存储，会话结束即清空。但在 MBA 案例分析这个场景下，单次会话已经足够。

#### 1.3.2 语义记忆（Semantic Memory）—— "世界是什么" ——对应soul.md

**业界方案对比**：

| 产品/框架 | 语义记忆实现 | 特点 |
|----------|------------|------|
| **mem0** | Qdrant/Pinecone 向量库 + Neo4j 图数据库 | 知识+关系双引擎 |
| **OpenMemory** | HMD 认知分层架构，5种认知类型各有独立衰退率 | 最接近人类认知 |
| **Memobase** | 用户画像 + 事件时间线，批处理优化 | 延迟<100ms |
| **CaseBuddy** | `gateway_config.json`（Bot配置）+ `push_history.json`（推送历史）+ `~/.casebuddy/ppt_compare_history.json`（PPT对比历史） | **极简实现**：JSON 文件持久化 |

**CaseBuddy 的语义记忆设计**：

```python
# gateway-python/gateway_server.py
self._config_file = TEMP_DIR / 'gateway_config.json'     # Bot 配置（appId/secret等）
self._push_history_file = TEMP_DIR / 'push_history.json'  # 推送历史（最近200条）

# 活跃案例上下文（发送PDF后自动绑定）
self.active_case_text = ''   # 解析后的案例文本
self.active_case_title = ''  # 案例文件名
self.active_case_id = ''     # case_xxxx 格式 ID
```

**与业界的差距**：没有向量数据库，没有跨会话的长期知识积累。但通过 RAG 知识库部分弥补了案例知识的检索能力。

#### 1.3.3 程序记忆（Procedural Memory）—— "怎么做事"

这是 CaseBuddy **最充分实现**的记忆维度。

**业界方案对比**：

| 产品/框架 | 程序记忆实现 | 特点 |
|----------|------------|------|
| **OpenAI** | `AGENTS.md`（约100行，渐进式披露）+ `docs/` 目录下深层文档 | 零成本知识注入 |
| **LangChain** | Tool/Function Calling 定义 + ReAct 循环 | 标准化的工具调用协议 |
| **OpenClaw** | 插件系统 + 多智能体路由 | 模块化工具管理 |
| **CaseBuddy** | 5个预设工作流模板 + RAG知识库 + 意图关键词匹配 + 分析框架 | **充分实现**：工作流引擎 + 意图识别 |

**CaseBuddy 的程序记忆设计**：

```typescript
// backend/src/routes/workflow.ts — 5个预设模板
const TEMPLATES: Record<string, WorkflowTemplate> = {
  'quick-read':    { name: '案例速读',   steps: ['parse', 'llm-summary'] },
  'swot':          { name: 'SWOT分析',    steps: ['parse', 'rag', 'swot'] },
  'deep-insight':  { name: '深度洞察',    steps: ['parse', 'rag', 'multi-dim'] },
  'ppt-outline':   { name: 'PPT大纲',     steps: ['parse', 'ppt-structure'] },
  'full-pipeline': { name: '全流程',      steps: ['parse', 'rag', 'speed-read', 'swot', 'insight', 'ppt', 'pptx-gen'] },
};
```

```python
# gateway-python/gateway_server.py (line 388-400) — 微信端意图识别
wf_commands = {
    '案例速读': 'quick-read',
    'swot分析': 'swot',
    '深度洞察': 'deep-insight',
    'ppt大纲': 'ppt-outline',
    '全流程': 'full-pipeline',
    # ... 更多关键词映射
}
```

**与业界差距**：没有 MCP（Model Context Protocol）标准化工具协议，意图识别用的是硬编码关键词匹配而非 NLU 模型。但在 MBA 案例分析这个垂直场景下，关键词匹配已经足够准确且高效。

---

## Part 2：CaseBuddy 架构设计

### 2.1 三层架构全景图

```
┌──────────────────────────────────────────────────────────┐
│                    前端 (React SPA)                       │
│  端口 5173 | Vite + TypeScript + TailwindCSS             │
│  ┌──────┬──────┬──────┬──────┬──────┬──────┬──────┐      │
│  │ 首页 │工作台│CaseAgent│PPT │PPT对比│微信助手│工作流│ ... │
│  └──────┴──────┴──────┴──────┴──────┴──────┴──────┘      │
│         ↕ REST API           ↕ 直连（推送/状态）          │
├──────────────────────────────────────────────────────────┤
│                  后端 (Node.js + Express)                 │
│  端口 3001 | TypeScript                                  │
│  ┌─────────┬──────────┬──────────┬───────────┬────────┐  │
│  │ chat.ts │ workflow │ rag.ts   │ pptCompare│ gateway│  │
│  │(LLM对话)│(工作流)  │(BM25检索)│(PPT对比)  │(代理)  │  │
│  └─────────┴──────────┴──────────┴───────────┴────────┘  │
│         ↕ HTTPS              ↕ HTTP                       │
├──────────────────────────────────────────────────────────┤
│                  网关 (Python Gateway)                    │
│  端口 3002 | Python + Flask + threading                   │
│  ┌──────────┬──────────┬──────────┬──────────┐            │
│  │ 微信 Bot │ 飞书 Bot │ QQ Bot   │ 企微 Bot │            │
│  │(iLink API)│(lark_oapi)│(BotPy) │(@wecom)  │            │
│  └──────────┴──────────┴──────────┴──────────┘            │
│         ↕                                                    │
├──────────────────────────────────────────────────────────┤
│                  外部服务                                   │
│  ┌──────────────┬──────────────┬─────────────┐            │
│  │ ECNU LLM API │ 微信 iLink   │  飞书开放平台  │            │
│  │ chat.ecnu.edu│ilinkai.weixin│ open.feishu  │            │
│  └──────────────┴──────────────┴─────────────┘            │
└──────────────────────────────────────────────────────────┘
```

### 2.2 技术栈与依赖全景

#### 前端依赖（`frontend/package.json`）

| 依赖 | 版本 | 作用 | 常见程度 |
|------|------|------|---------|
| `react` | ^19.2.6 | UI 框架 | ⭐⭐⭐ 极常见 |
| `react-router-dom` | ^7.15.1 | 路由 | ⭐⭐⭐ 极常见 |
| `react-markdown` | ^10.1.0 | Markdown 渲染 | ⭐⭐ 常见 |
| `remark-gfm` | ^4.0.1 | GitHub Flavored Markdown | ⭐⭐ 常见 |
| `lucide-react` | ^1.16.0 | 图标库 | ⭐⭐ 常见 |
| `pdfjs-dist` | ^4.9.155 | PDF 预览 | ⭐⭐ 常见 |
| `pptxgenjs` | ^4.0.1 | PPT 生成 | ⭐⭐ 常见 |
| `html2pdf.js` | ^0.14.0 | HTML→PDF | ⭐⭐ 常见 |
| `tailwindcss` | ^3.4.19 | CSS 工具类 | ⭐⭐⭐ 极常见 |

#### 后端依赖（`backend/package.json`）

| 依赖 | 作用 | 常见程度 |
|------|------|---------|
| `express` | HTTP 框架 | ⭐⭐⭐ 极常见 |
| `multer` | 文件上传中间件 | ⭐⭐⭐ 极常见 |
| `pdf-parse` | PDF 文本提取 | ⭐⭐ 常见 |
| `mammoth` | DOCX→HTML 转换 | ⭐⭐ 常见 |
| `docx` | Word 文档生成 | ⭐⭐ 常见 |
| `pptxgenjs` | PPT 文件生成 | ⭐⭐ 常见 |
| `@wecom/aibot-node-sdk` | 企业微信 Bot SDK | ⭐⭐ 常见 |
| `dotenv` | 环境变量管理 | ⭐⭐⭐ 极常见 |

#### Python 网关依赖（`gateway-python/requirements.txt`）

| 依赖 | 作用 | 常见程度 |
|------|------|---------|
| `requests` | HTTP 客户端 | ⭐⭐⭐ 极常见 |
| `qrcode` | 二维码生成 | ⭐⭐ 常见 |
| `pycryptodome` | AES 加密/解密（微信文件传输） | ⭐⭐ **不太常见** |
| `lark-oapi` | 飞书 SDK（WebSocket 长连接） | ⭐⭐ 常见 |
| `qq-botpy` | QQ Bot SDK | ⭐⭐ 常见 |
| `aiohttp` | 异步 HTTP 客户端 | ⭐⭐⭐ 极常见 |

**关键发现**：CaseBuddy 几乎没用任何"重型"AI 依赖——没有 LangChain、没有向量数据库、没有 Embedding 模型。核心 AI 能力全部来自外部 LLM API，本系统只负责"编排"和"交互"。

### 2.3 目录结构

```
casebuddy/
├── frontend/                          # 前端 React SPA
│   ├── src/
│   │   ├── App.tsx                    # 路由注册
│   │   ├── pages/
│   │   │   ├── Layout.tsx             # 导航栏布局
│   │   │   ├── Home.tsx               # 首页
│   │   │   ├── WorkBench.tsx          # 分析工作台
│   │   │   ├── CaseAgent.tsx          # 智能案例代理
│   │   │   ├── PPTAssistant.tsx       # AI PPT 助手
│   │   │   ├── PPTCompare.tsx         # PPT 对比分析
│   │   │   ├── WeChatAssistant.tsx    # 微信助手
│   │   │   ├── WorkflowPage.tsx       # 智能工作流
│   │   │   ├── SkillMarket.tsx        # 技能市场
│   │   │   ├── ModelConfig.tsx        # 模型配置
│   │   │   └── GatewayConfig.tsx       # 消息网关
│   │   └── contexts/
│   │       └── SessionContext.tsx       # 会话记忆上下文
│   └── package.json
├── backend/                           # 后端 Node.js
│   ├── src/
│   │   ├── index.ts                   # 入口 + 路由注册
│   │   └── routes/
│   │       ├── chat.ts                # LLM 对话路由
│   │       ├── workflow.ts            # 工作流引擎
│   │       ├── rag.ts                 # RAG BM25 检索
│   │       ├── pptCompare.ts          # PPT 对比分析
│   │       ├── pptAssistant.ts        # PPT 助手后端
│   │       ├── gateway.ts             # 网关代理路由
│   │       └── ...
│   └── .env                           # LLM API Key 配置
└── gateway-python/                    # Python 网关
    ├── gateway_server.py              # 网关主服务（1340行）
    ├── casebuddy_cli.py               # CLI 启动器
    ├── requirements.txt               # Python 依赖
    ├── bots/
    │   ├── wechat_bot.py              # 微信 iLink Bot（605行）
    │   ├── feishu_bot_enhanced.py     # 飞书 Bot（增强版）
    │   ├── qq_bot.py                  # QQ Bot
    │   └── wecom_bot.py               # 企业微信 Bot
    └── temp/                          # 临时文件 + 持久化数据
        ├── gateway_config.json        # Bot 配置
        ├── push_history.json          # 推送历史
        └── workflow_pptx/             # 工作流生成的 PPT
```

---

## Part 3：各组件深度解读

### 3.1 前端层 —— React SPA

**文件**：`frontend/src/`

**核心设计**：
- React 19 + Vite 8 + TypeScript 6 + TailwindCSS 3
- 单页应用（SPA），React Router 管理路由
- `SessionContext` 作为全局状态管理（避免引入 Redux 的复杂度）

**业界对比**：

| 维度 | OpenClaw | CaseBuddy | 评价 |
|------|----------|-----------|------|
| 前端框架 | React (Web + macOS + iOS) | React SPA (纯Web) | CaseBuddy 聚焦 Web |
| 状态管理 | 内部状态管理 | React Context | 轻量方案，适合小型应用 |
| UI 框架 | 自定义 | TailwindCSS | Tailwind 是当前最流行的 CSS 方案 |
| 实时通信 | WebSocket | 轮询 (Polling) | 轮询足够简单可靠 |

**关键代码**：

```typescript
// frontend/src/App.tsx — 路由注册
<BrowserRouter>
  <Routes>
    <Route path="/" element={<Layout />}>
      <Route index element={<Home />} />
      <Route path="workbench" element={<WorkBench />} />
      <Route path="caseagent" element={<CaseAgent />} />
      <Route path="ppt-assistant" element={<PPTAssistant />} />
      <Route path="ppt-compare" element={<PPTCompare />} />
      <Route path="wechat-assistant" element={<WeChatAssistant />} />
      <Route path="workflow" element={<WorkflowPage />} />
      <Route path="skill-market" element={<SkillMarket />} />
      <Route path="model-config" element={<ModelConfig />} />
      <Route path="gateway-config" element={<GatewayConfig />} />
    </Route>
  </Routes>
</BrowserRouter>
```

### 3.2 后端层 —— Node.js + Express

**文件**：`backend/src/`

**核心路由**：

| 路由文件 | 路由前缀 | 功能 | 关键技术 |
|---------|---------|------|---------|
| `chat.ts` | `/api/chat` | LLM 对话 | Node.js `https` 模块（避免 fetch 不稳定） |
| `gateway.ts` | `/api/gateway/*` | 网关代理 | 请求转发到 Python 网关 |
| `workflow.ts` | `/api/workflow/*` | 工作流引擎 | 模板解析 + 步骤串行执行 |
| `rag.ts` | `/api/rag/*` | BM25 检索 | 纯 Node.js BM25 分词+TF-IDF |
| `pptCompare.ts` | `/api/ppt-compare/*` | PPT 对比分析 | JSZip 解析 + LLM 评分 |
| `pptAssistant.ts` | `/api/ppt/*` | PPT 生成 | pptxgenjs 生成 .pptx |

**业界对比**：

| 维度 | OpenClaw | CaseBuddy | 评价 |
|------|----------|-----------|------|
| 后端语言 | TypeScript (Node 24) | TypeScript (Node 22) | 相同 |
| Web 框架 | 自定义 | Express 4 | CaseBuddy 用成熟框架 |
| 文件解析 | 内置 | `pdf-parse` + `mammoth` + `JSZip` | 组合式方案 |
| RAG | 向量检索 | BM25 关键词匹配 | BM25 更简单但召回率较低 |
| 工作流 | 状态机编排 | 模板+串行步骤 | 简化实现 |

**关键代码 —— LLM 调用**：

```typescript
// backend/src/routes/chat.ts — 使用原生 https 模块避免 Node.js 22 fetch 不稳定
import * as https from 'https';

function callLLM(message: string, systemPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: process.env.LLM_MODEL || 'ecnu-plus',
      messages: [{ role: 'user', content: systemPrompt + '\n' + message }],
      max_tokens: 3000,  // ECNU API 限制
    });
    const req = https.request(options, (res) => { /* ... */ });
    req.end(body);
  });
}
```

content: systemPrompt + '\n' + message  // 直接拼接提示词


### 3.3 网关层 —— Python Bot 管理中心

**文件**：`gateway-python/gateway_server.py`（1340行）

这是 CaseBuddy 最独特的组件。它解决了一个核心问题：**如何让 AI 助手通过微信/飞书等平台与用户交互？**

**核心设计**：

```
Python Gateway Server (端口 3002)
├── HTTP API (BaseHTTPRequestHandler + ThreadingMixIn)
│   ├── GET  /status          → 网关状态
│   ├── GET  /qrcode          → 微信二维码图片
│   ├── POST /start/wechat    → 启动微信Bot（扫码+监听）
│   ├── POST /stop/wechat     → 停止微信Bot
│   ├── POST /push-wechat     → 推送内容到微信
│   ├── POST /sync-session    → 前端同步session摘要
│   └── POST /config/*        → 各平台配置
├── Bot 线程管理
│   ├── 微信: threading.Thread + WxBotClient.run_loop()
│   ├── 飞书: threading.Thread + FeishuBot.run()
│   ├── QQ:  threading.Thread + QQBot.run()
│   └── 企微: threading.Thread + WeComBot.run()
└── GatewayState (全局状态)
    ├── bots / bot_threads    → Bot 实例和线程
    ├── config                → 平台配置（持久化到JSON）
    ├── session_summary       → 分析工作台摘要
    ├── active_case_text      → 活跃案例上下文
    └── push_history          → 推送历史
```

**业界对比**：

| 维度 | OpenClaw Gateway | CaseBuddy Gateway | 评价 |
|------|-----------------|------------------|------|
| 语言 | TypeScript/Go | Python | Python 更适合 Bot SDK 生态 |
| 架构 | 单进程，内置Agent | HTTP服务器 + 线程 | CaseBuddy 用标准HTTP |
| 渠道 | 30+ (WhatsApp, Telegram, Discord...) | 4 (微信/飞书/QQ/企微) | CaseBuddy 聚焦国内平台 |
| 记忆 | 持久化向量存储 | JSON 文件 | CaseBuddy 极简 |
| 部署 | Docker / bare metal | CLI 一键启动 | CaseBuddy 更轻量 |

**为什么选择 Python 做网关？** 国内 Bot SDK（微信 iLink、飞书 lark-oapi、QQ BotPy）全部是 Python 优先，用 Python 可以直接使用官方 SDK，避免手写协议。

但是用python会慢一点

### 3.4 LLM 层 —— 大模型接入与路由

**文件**：`backend/src/routes/chat.ts`、`backend/.env`

**设计**：所有 LLM 调用集中在后端 `chat.ts`，前端和网关都通过后端代理访问 LLM。

```
前端/网关 → POST /api/chat → 后端 chat.ts → HTTPS POST chat.ecnu.edu.cn/open/api/v1
                                     ↓
                              ECNU ecnu-plus 模型
```

**关键约束**（ECNU API 的特殊性）：
1. 不支持 `system` role → 系统提示词合并到 user message
2. prompt 总长度 >3000 字会返回 500 Internal Server Error
3. `max_tokens` 建议 ≤3000

### 3.5 记忆层 —— 对话记忆与上下文管理

**文件**：`frontend/src/contexts/SessionContext.tsx`

**实现**：

```typescript
// SessionContext.tsx — 核心：一个 messages 数组 + localStorage 持久化
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface Session {
  id: string;         // 唯一标识
  title: string;      // 会话标题，由第一条消息生成
  messages: Message[];         // 核心数据：消息列表
  createdAt: string;           // 创建时间，用于排序
}

// 使用 React Context + useState + localStorage
// 持久化：每次 sessions 变化自动保存
```

**业界对比**：

| 产品 | 记忆存储 | 检索方式 | 持久化 |
|------|---------|---------|--------|
| ChatGPT | 服务端数据库 + 向量索引 | 语义检索 | 云端 |
| MemGPT | 三层金字塔 | 向量+文本+日期 | 本地/云端 |
| OpenClaw | 按发送者隔离会话 | 简单KV | 本地JSON |
| **CaseBuddy** | **messages 数组** | **无检索（全量注入）** | **localStorage** |

**三重记忆在 CaseBuddy 中的映射**：

```
场景记忆 → SessionContext (前端) + session_summary (网关)
         ↓
         "这个会话中用户说了什么、AI回复了什么"

语义记忆 → gateway_config.json + push_history.json + active_case_text
         ↓
         "用户的Bot配置、历史推送记录、当前正在分析的案例"

程序记忆 → workflow templates + RAG知识库 + 意图关键词映射
         ↓
         "案例速读怎么做、SWOT分析包含哪些步骤、如何生成PPT"
```

### 3.6 RAG 层 —— BM25 检索增强

**文件**：`backend/src/routes/rag.ts`

**设计**：纯 Node.js 实现，无需 Python 依赖或向量数据库。

```
PDF 上传 → 文本提取 → BM25 分词 → 倒排索引（内存） → topK 召回
                                                              ↓
                                                     注入 LLM prompt
```

**业界对比**：

| 维度 | LangChain RAG | OpenClaw RAG | CaseBuddy RAG |
|------|--------------|-------------|---------------|
| 检索算法 | 向量余弦相似度 + BM25 混合 | 向量检索 | **纯 BM25** |
| 向量数据库 | Chroma/Pinecone/Weaviate | 内置 | **无** |
| Embedding | OpenAI/本地模型 | 内置 | **无** |
| 切片策略 | 递归字符切片 | 固定长度 | 按段落 |
| 优点 | 语义理解好 | 多源统一 | **零外部依赖** |
| 缺点 | 需要向量DB | 需要Embedding | **语义理解弱** |

**为什么选择 BM25？**：MBA 案例分析的术语相对固定（如"SWOT"、"波特五力"、"商业模式画布"），关键词匹配已经足够准确。省去向量化开销是务实的选择。

### 3.7 工作流引擎 —— 多步骤编排

**文件**：`backend/src/routes/workflow.ts`

**设计**：模板驱动 + 串行步骤执行

```typescript
// 5个预设模板
const TEMPLATES = {
  'quick-read':    { name: '案例速读',  steps: ['parse', 'llm-summary'] },
  'swot':          { name: 'SWOT分析',   steps: ['parse', 'rag', 'swot'] },
  'deep-insight':  { name: '深度洞察',   steps: ['parse', 'rag', 'multi-dim'] },
  'ppt-outline':   { name: 'PPT大纲',    steps: ['parse', 'ppt-structure'] },
  'full-pipeline': { name: '全流程',     steps: ['parse', 'rag', 'speed-read', 'swot', 'insight', 'ppt', 'pptx-gen'] },
};

// 步骤类型
type StepType = 'parse' | 'llm' | 'rag' | 'ppt' | 'pptx-gen';
// parse → 调用 /api/parse/file
// llm   → 构建 prompt 调用 ECNU API
// rag   → 先查询 RAG 索引，再拼入 prompt
// ppt   → 生成 slides JSON
// pptx-gen → 调用 pptxgenjs 生成真实 .pptx 文件
```

**业界对比**：

| 维度 | Stripe (混合状态机) | LangGraph (DAG) | CaseBuddy (模板串行) |
|------|---------------------|-----------------|---------------------|
| 编排模式 | 确定性节点 + Agent 节点混合 | 有向无环图 | **线性串行** |
| 并行能力 | 支持 | 支持 | **不支持** |
| 条件分支 | 状态机转换 | 图节点路由 | **无** |
| 错误恢复 | 重试+降级 | Checkpoint | **简单失败标记** |
| 优点 | 生产级可靠性 | 灵活可组合 | **极简实现** |

### 3.8 文件解析层

**文件**：`backend/src/routes/` (parse 相关)

| 文件格式 | 解析库 | 实现位置 |
|---------|--------|---------|
| PDF | `pdf-parse` | `backend/src/routes/chat.ts` |
| DOCX | `mammoth` (DOCX→HTML→Text) | `backend/src/routes/chat.ts` |
| PPTX | `JSZip` (纯Node.js XML解析) | `backend/src/routes/pptCompare.ts` |



office-oxide	基于Rust编写，速度极快；支持文本、Markdown、HTML提取	追求极致性能，处理大量文件或大文件

@icjia/pdf-search-index	|功能全面，支持元数据、文本去重；或专为全文搜索构建索引	|需要提取作者、页数等元数据；为PPTX内容建立搜索引擎索引	

js-pptx	纯JS实现，可直接读写和创建PPTX；API既可高层操作，也可底层修改XML	不仅需要解析，还需要生成或修改PPTX文件；对预算敏感	

python-pptx/pyxtxt	Python社区标准库；pyxtxt则是一个集成多种格式的通用解析器

**PPT 解析的关键技术**（纯 JSZip，无 Python 依赖）：

```typescript
// pptCompare.ts — 不依赖 python-pptx，直接解析 OOXML
async function parsePptx(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);
  // 提取 ppt/slides/slideN.xml 中的 <a:t> 文本节点
  const textRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  // 同时提取表格 <a:tbl> 中的内容
  // 按幻灯片编号排序输出
}
```

### 3.9 导出层

| 格式 | 实现方式 | 文件 |
|------|---------|------|
| Markdown | 前端 `exportUtils.ts`（纯字符串拼接） | `frontend/src/utils/exportUtils.ts` |
| PDF | `html2pdf.js`（html2canvas + jsPDF） | 前端调用 |
| Word (.docx) | 后端 `docx` 库 | `backend/src/routes/` |
| PPT (.pptx) | `pptxgenjs` | 前端+后端都可用 |

---

## Part 4：导航模块逐一讲解

### 4.1 首页（Home）

**文件**：`frontend/src/pages/Home.tsx`

**功能**：项目介绍、快速入口、功能概览。

**设计思路**：给用户一个"这是什么"的第一印象，提供到各模块的快速跳转。

---

### 4.2 分析工作台（WorkBench）

**文件**：`frontend/src/pages/WorkBench.tsx`

**功能**：与 LLM 进行 MBA 案例分析对话的核心界面。

**核心交互**：

```
用户输入 → POST /api/chat → LLM 处理 → 流式/非流式返回 → 渲染 Markdown
                                                         ↓
                                                 同步到网关 session_summary
                                                         ↓
                                                    微信可查看/推送
```

**关键代码**：

```typescript
// WorkBench.tsx — 核心对话逻辑
const sendMessage = async (content: string) => {
  setMessages(prev => [...prev, { role: 'user', content }]);
  const res = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: content, sessionId }),
  });
  const data = await res.json();
  setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
};
```

**推送功能**：调用 `POST localhost:3001/api/gateway/push-wechat`，后端代理到 Python 网关，网关通过 `_push_to_wechat()` 发送到微信。

---

### 4.3 CaseAgent（智能案例代理）

**文件**：`frontend/src/pages/CaseAgent.tsx`

**功能**：自动化的多轮对话案例代理，支持暂停/继续/停止。

主要是编排了一个自动化工作流：输入选题——plan（规划如何分析、模拟子agent）——网络检索＋内部知识整合——分析框架选择——按框架分析——深度思考（挖掘）——PPT大纲生成——PPT生成——豆包润色PPT提示词

**核心设计**：
- 使用 `runningRef = useRef(false)` 解决 React 闭包陷阱
- 浮动控制按钮（`fixed bottom-6 right-6`），避免页面滚动导致控制按钮不可见
- 导航栏切换时自动检测"假运行"状态并转为暂停

**关键技术点**：

```typescript
// CaseAgent.tsx — 浮动控制按钮
<div className="fixed bottom-6 right-6 z-50 flex gap-3">
  <button onClick={togglePause}>
    {isPaused ? '▶ 继续' : '⏸ 暂停'}
  </button>
  <button onClick={stopGeneration}>⏹ 停止</button>
</div>

// runningRef 解决闭包陷阱
const runningRef = useRef(false);
useEffect(() => {
  // 如果 job 显示 "running" 但 runningRef 为 false，说明是"假运行"
  if (job?.status === 'running' && !runningRef.current) {
    updateJob(job.id, { status: 'paused' });
  }
}, [job?.id]);
```

---

### 4.4 AI PPT 助手

**文件**：`frontend/src/pages/PPTAssistant.tsx` + `backend/src/routes/pptAssistant.ts`

**功能**：通过 AI 生成 PPT 结构，并支持导出 .pptx 文件。

**核心流程**：

```
用户输入主题 → AI 生成 slides JSON → 后端构建完整结果 → 前端预览 → 导出 .pptx
```

**界面设计**：左侧交互面板 + 右侧5标签页（大纲/风格/豆包提示词/预览/导出）

---

### 4.5 PPT 对比分析

**文件**：`frontend/src/pages/PPTCompare.tsx` + `backend/src/routes/pptCompare.ts`

**功能**：上传两个 PPT 文件（案例PPT + 获奖PPT），AI 对比评分。

**核心流程**：

```
上传两个PPT → JSZip解析文本 → 拼入LLM prompt → AI评分(1-10) → 保存历史记录
                                                         ↓
                                              推送到微信（可选）
```

**关键技术**：
- 纯 Node.js JSZip 解析 PPTX（不依赖 python-pptx）
- 历史记录保存到 `~/.casebuddy/ppt_compare_history.json`
- 外层 catch 也保存失败记录（确保任何情况都能保存）

---

### 4.6 微信助手（WeChatAssistant）

**文件**：`frontend/src/pages/WeChatAssistant.tsx`

**功能**：前端网页版微信聊天界面，显示网关收到的微信消息和回复。

**核心交互**：

```
前端轮询 GET /api/gateway/wechat-messages → 显示最新消息
前端发送 POST /api/gateway/send-wechat-text → 通过网关发送消息
```

---

### 4.7 智能工作流（WorkflowPage）

**文件**：`frontend/src/pages/WorkflowPage.tsx` + `backend/src/routes/workflow.ts`

**功能**：选择预设模板，一键执行多步骤分析任务。

**核心流程**：

```
选择模板 → POST /api/workflow/create → POST /api/workflow/:id/run → 轮询状态
                                                                      ↓
                                                               步骤完成后查看结果
```

---

### 4.8 技能市场（SkillMarket）

**文件**：`frontend/src/pages/SkillMarket.tsx`

**功能**：展示可用的分析框架和技能（SWOT、波特五力、商业模式画布等）。

---

### 4.9 模型配置（ModelConfig）

**文件**：`frontend/src/pages/ModelConfig.tsx`

**功能**：配置 LLM 的 API 地址、Key、模型名称。

---

### 4.10 消息网关（GatewayConfig）

**文件**：`frontend/src/pages/GatewayConfig.tsx` + `gateway-python/gateway_server.py`

**功能**：管理各平台 Bot 的启动/停止/配置。

**核心设计**：前端通过 REST API 控制网关，网关通过线程管理各 Bot 的生命周期。

---

## Part 5：关键技术深度剖析

### 5.1 微信 iLink Bot —— 核心技术揭秘

**文件**：`gateway-python/bots/wechat_bot.py`（605行）

这是整个项目技术含量最高的模块。它通过逆向工程微信 iLink 平台的私有 API 实现了 Bot 功能。

#### 5.1.1 使用的库和原理

| 库 | 作用 | 原理 | 常见程度 |
|----|------|------|---------|
| `requests` | HTTP 请求 | 同步 HTTP 客户端，发送 JSON 请求到 iLink API | ⭐⭐⭐ 极常见 |
| `qrcode` | 二维码生成 | 将登录 URL 编码为 QR 码图片 | ⭐⭐ 常见 |
| `pycryptodome` (Crypto.Cipher.AES) | AES 加密/解密 | 微信文件传输使用 AES-ECB 加密 | ⭐⭐ **不太常见** |
| `struct` | 二进制打包 | 生成随机 UIN（`base64(struct.pack('>I', ...))`） | ⭐⭐ 常见 |
| `hashlib` | MD5 哈希 | 计算文件 MD5 用于上传校验 | ⭐⭐⭐ 极常见 |
| `PIL` (Pillow) | 图片处理 | 生成缩略图（240x240 JPEG）用于微信图片发送 | ⭐⭐⭐ 极常见 |
| `io.BytesIO` | 内存文件 | 在内存中处理图片缩略图，不落盘 | ⭐⭐⭐ 极常见 |

#### 5.1.2 微信登录流程（二维码机制）

```
1. GET /ilink/bot/get_bot_qrcode?bot_type=3
   → 返回 {qrcode: "qr_id", qrcode_img_content: "url"}

2. 用 qrcode 库将 url 生成 PNG 图片
   → box_size=10（大尺寸确保清晰）
   → os.startfile() 在 Windows 上弹出图片（比 webbrowser.open 更可靠）

3. 轮询 GET /ilink/bot/get_qrcode_status?qrcode=qr_id
   → status: "waiting" → "scanning" → "confirmed" → token 返回
   → status: "expired" → 需要重新获取

4. 确认后保存 token 到 ~/.casebuddy/wx_token.json
```

#### 5.1.3 消息收发机制（长轮询）

```python
# 收消息：长轮询 getupdates（timeout=30s）
def get_updates(self, timeout=30):
    resp = self._post('ilink/bot/getupdates', {
        'get_updates_buf': self._buf,  # 增量游标
        'base_info': {'channel_version': VER}
    }, timeout=timeout + 5)
    # 更新 buf（幂等游标）
    self._buf = resp.get('get_updates_buf', '')
    return resp.get('msgs', [])

# 发消息：sendmessage
def send_text(self, to_user_id, text, context_token=''):
    msg = {
        'to_user_id': to_user_id,
        'message_type': 2,  # MSG_BOT
        'item_list': [{'type': 1, 'text_item': {'text': text}}]
    }
    return self._post('ilink/bot/sendmessage', {'msg': msg, ...})
```

如果没有新消息，服务器会挂起请求最多30秒

30秒内：

有新消息 → 立即返回

无新消息 → 30秒后返回空结果

timeout + 5：客户端超时时间比服务器多5秒，防止网络波动

为什么需要游标buf？

去重：防止重复收取同一条消息

断点续传：网络断开后从上次位置继续

增量同步：只拉取新消息，不重复拉历史


#### 5.1.4 文件传输（AES 加密 CDN 上传）

这是最复杂的部分——微信使用 **AES-ECB 加密** 上传文件到 CDN：

```
1. POST /ilink/bot/getuploadurl → 获取 upload_url + upload_param

2. 生成随机 AES key（16字节）→ AES-ECB 加密文件内容 → 上传到 CDN

3. 返回 encrypt_query_param + aes_key → 封装在消息的 media 字段中

4. 接收方用 aes_key 解密 CDN 下载的密文 → PKCS7 去填充 → 原始文件
```

```python
# 加密上传
def _enc(self, raw, aes_key):
    pad = 16 - (len(raw) % 16)  # PKCS7 padding
    return AES.new(aes_key, AES.MODE_ECB).encrypt(raw + bytes([pad] * pad))

# 下载解密
ct = requests.get(f'{CDN_BASE}/download?encrypted_query_param={eq}').content
pt = AES.new(aes_key, AES.MODE_ECB).decrypt(ct)
pt = pt[:-pt[-1]]  # 去除 PKCS7 padding
```

#### 5.1.5 代理绕过（关键细节）

```python
# 清除所有代理环境变量（iLink 是国内腾讯服务，不需要代理）
for _k in ('HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'):
    os.environ.pop(_k, None)

# 所有 requests 调用强制不走代理（避免 Clash 等工具拦截 localhost 请求）
_NO_PROXY = {'http': '', 'https': ''}
```

### 5.2 飞书 Bot —— WebSocket 长连接

**文件**：`gateway-python/bots/feishu_bot_enhanced.py`

**技术**：使用飞书官方 SDK `lark-oapi` 的 WebSocket 模式。

```python
from lark_oapi.event.dispatcher_handler import EventDispatcherHandler
from lark_oapi.ws import Client as WSClient

# 创建事件处理器
event_handler = EventDispatcherHandler.builder("", "")
    .register_p2_im_message_receive_v1(callback)
    .build()

# 创建 WebSocket 客户端
ws_app = WSClient(app_id, app_secret, event_handler=event_handler)
ws_app.start()  # 长连接，自动接收消息
```

**文件下载**（踩坑经验）：
```python
# 飞书文件下载必须带 ?type=file 查询参数
GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}?type=file
# 如果不带 ?type=file，下载会失败
```

### 5.3 Windows GBK 编码 —— 四层防御体系

Windows 控制台默认使用 GBK 编码，Python print 输出中文时会触发 `UnicodeEncodeError`。

```python
# gateway_server.py — 四层防御

# 第1层：环境变量强制 UTF-8
os.environ['PYTHONUTF8'] = '1'

# 第2层：安全包装 stdout/stderr
def _ensure_utf8(stream):
    if hasattr(stream, 'buffer') and not getattr(stream, 'closed', False):
        return io.TextIOWrapper(stream.buffer, encoding='utf-8', errors='replace')
sys.stdout = _ensure_utf8(sys.stdout)

# 第3层：覆盖 builtins.print 为安全版本
def _safe_print(*args, **kwargs):
    try: _original_print(*args, **kwargs)
    except (UnicodeEncodeError, ValueError, Exception): pass
builtins.print = _safe_print

# 第4层：文件操作显式 encoding='utf-8'
with open(filepath, 'w', encoding='utf-8') as f: ...
```

### 5.4 TypeScript 模块加载顺序陷阱

**问题**：`const DEFAULT_CONFIG = { apiKey: process.env.X }` 在编译后会在 `require()` 时立即求值，即使源码写在 `dotenv.config()` 之后。

**根因**：TypeScript 编译后，`require('./routes/gateway')` 可能在 `dotenv.config()` 之前执行。

**解决方案**：

```typescript
// ❌ 错误：模块加载时立即求值，dotenv 可能还没执行
const DEFAULT_CONFIG = { apiKey: process.env.LLM_API_KEY };

// ✅ 正确：延迟求值，调用时才读取环境变量
function getConfig() {
  return { apiKey: process.env.LLM_API_KEY };
}
```

### 5.5 React 闭包陷阱与 runningRef

**问题**：`setInterval`/`setTimeout` 中的回调函数捕获的是创建时的闭包，无法读到最新的 state 值。

```typescript
// ❌ 错误：isPaused 在闭包中被"冻结"
useEffect(() => {
  const timer = setInterval(() => {
    if (isPaused) return;  // isPaused 永远是创建时的值！
    // ...
  }, 1000);
  return () => clearInterval(timer);
}, []);

// ✅ 正确：用 Ref 同步最新值
const runningRef = useRef(false);
runningRef.current = isPaused;

useEffect(() => {
  const timer = setInterval(() => {
    if (runningRef.current) return;  // 每次都读到最新值
    // ...
  }, 1000);
  return () => clearInterval(timer);
}, []);
```

### 5.6 纯 Node.js PPT 解析（无 Python 依赖）

**文件**：`backend/src/routes/pptCompare.ts`

OOXML 格式的 .pptx 本质是 ZIP 压缩包，里面的 XML 包含幻灯片内容。JSZip 可以直接解压和解析。

```typescript
async function parsePptx(filePath: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(fileBuffer);

  // 提取所有幻灯片文本
  const slideFiles: { path: string; num: number }[] = [];
  zip.forEach((relativePath) => {
    const match = relativePath.match(/^ppt\/slides\/slide(\d+)\.xml$/);
    if (match) slideFiles.push({ path: relativePath, num: parseInt(match[1]) });
  });
  slideFiles.sort((a, b) => a.num - b.num);

  // 正则提取 <a:t> 标签中的文本
  const textRegex = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  for (const sf of slideFiles) {
    const xml = await zip.file(sf.path)?.async('string');
    let match;
    while ((match = textRegex.exec(xml)) !== null) {
      slides.push(`Slide ${sf.num}: ${match[1]}`);
    }
  }
}
```

---

## Part 6：与市面 Buddy/Claw 方案对比

### 6.1 整体对比

| 维度 | OpenClaw | CaseBuddy | 评价 |
|------|----------|-----------|------|
| **定位** | 通用 AI 助手框架 | MBA 案例分析专用 | CaseBuddy 垂直深耕 |
| **渠道** | 30+ (WhatsApp/Telegram/Discord...) | 4 (微信/飞书/QQ/企微) | 聚焦国内 |
| **Agent** | Pi (编码智能体) | CaseAgent + 工作流 | 领域定制 |
| **记忆** | 向量+持久化 | JSON文件 | CaseBuddy 极简 |
| **工具** | MCP 协议 | 硬编码 | CaseBuddy 简单可靠 |
| **部署** | Docker | CLI 一键 | 都很轻量 |
| **代码量** | 大型项目 | ~5000行核心代码 | CaseBuddy 精简 |
| **AI依赖** | Claude/GPT/本地模型 | ECNU API | CaseBuddy 用国内API |

### 6.2 记忆系统对比

| 维度 | MemGPT | mem0 | CaseBuddy |
|------|--------|------|-----------|
| 场景记忆 | Core(2-4K)+Recall+Archival | 向量+图+SQLite | messages数组+JSON |
| 语义记忆 | Archival Memory(向量) | 向量+图双引擎 | JSON文件(配置+历史) |
| 程序记忆 | System Prompt | 无专门实现 | 5个工作流模板+意图映射 |
| 向量DB | Chroma/Milvus | Qdrant/Pinecone | **无** |
| 检索方式 | 文本+向量+日期 | 向量+图并行 | **无检索(全量注入)** |
| 衰退机制 | 无 | 无 | **无(手动清理)** |
| 跨会话 | Archival持久化 | 持久化 | **有限(配置文件)** |

### 6.3 工作流引擎对比

| 维度 | Stripe (混合状态机) | LangGraph (DAG) | CaseBuddy |
|------|---------------------|-----------------|-----------|
| 编排模式 | 确定性+Agent混合 | 有向无环图 | **线性串行** |
| 步骤定义 | 代码定义节点 | 装饰器+状态图 | **JSON模板** |
| 并行执行 | 支持 | 支持 | **不支持** |
| 条件分支 | 状态转换 | 图路由 | **不支持** |
| 人工审批 | Pre-push hook | Checkpoint | **无** |
| 错误恢复 | 重试+降级 | 恢复点 | **失败标记** |

### 6.4 CaseBuddy 的设计哲学

```
"在垂直场景下，简单可靠的方案往往优于大而全的框架"
```

1. **不用向量数据库** → BM25 对 MBA 案例术语已经够用
2. **不用 LangChain** → 直接 HTTPS 调用 LLM API，更可控
3. **不用 Redis/MongoDB** → JSON 文件持久化，CLI 一键启动无需额外服务
4. **不用 Docker** → 直接运行，降低部署门槛
5. **Python 做网关** → 直接使用国内 Bot SDK，不造轮子

---



> **附录：关键文件路径速查**
>
> | 组件 | 文件路径 | 行数 |
> |------|---------|------|
> | 前端入口 | `frontend/src/App.tsx` | ~30 |
> | 导航栏 | `frontend/src/pages/Layout.tsx` | ~80 |
> | 会话上下文 | `frontend/src/contexts/SessionContext.tsx` | ~100 |
> | 分析工作台 | `frontend/src/pages/WorkBench.tsx` | ~400 |
> | CaseAgent | `frontend/src/pages/CaseAgent.tsx` | ~500 |
> | PPT 助手 | `frontend/src/pages/PPTAssistant.tsx` | ~400 |
> | PPT 对比 | `frontend/src/pages/PPTCompare.tsx` | ~500 |
> | 后端入口 | `backend/src/index.ts` | ~60 |
> | LLM 对话 | `backend/src/routes/chat.ts` | ~200 |
> | 工作流引擎 | `backend/src/routes/workflow.ts` | ~300 |
> | RAG 检索 | `backend/src/routes/rag.ts` | ~200 |
> | PPT 对比后端 | `backend/src/routes/pptCompare.ts` | ~350 |
> | 网关代理 | `backend/src/routes/gateway.ts` | ~100 |
> | 网关主服务 | `gateway-python/gateway_server.py` | 1340 |
> | 微信 Bot | `gateway-python/bots/wechat_bot.py` | 605 |
> | 飞书 Bot | `gateway-python/bots/feishu_bot_enhanced.py` | ~400 |
> | CLI 启动器 | `gateway-python/casebuddy_cli.py` | ~300 |
