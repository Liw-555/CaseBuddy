# CaseBuddy - AI 赋能 MBA 案例分析大赛专家产品

> 让 AI Agent 成为你的"超级外脑"，5 小时极限挑战中的全流程智能助手

CaseBuddy 是专为 **MBA 案例分析大赛** 设计的 AI 协同专家产品。在 5 小时极限挑战中，帮你完成从案例解构、深度分析、数据整理到 PPT 生成、答辩准备的全流程，同时支持微信/飞书/QQ 远程操控。

---

## 目录

1. [项目组件与架构](#1-项目组件与架构)
2. [快速启动指南](#2-快速启动指南)
3. [模块详解](#3-模块详解)
4. [API 端点参考](#4-api-端点参考)
5. [项目讲解指引（代码导航）](#5-项目讲解指引代码导航)
6. [环境变量参考](#6-环境变量参考)
7. [注意事项与已知限制](#7-注意事项与已知限制)

---

## 1. 项目组件与架构

### 1.1 系统架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                     用户交互层                                │
│  Web 浏览器 (:5173)  │  微信 Bot  │  飞书 Bot  │  QQ Bot   │
└─────────┬───────────┴─────┬──────┴─────┬──────┴────────────┘
          │                 │            │
          ▼                 │            ▼
┌──────────────────┐        │    ┌──────────────────┐
│   前端 (React)    │        │    │  Python 网关      │
│   Vite :5173      │        │    │  Express :3002   │
│   TypeScript      │        │    │  bots/*.py       │
└────────┬─────────┘        │    └────────┬─────────┘
         │                  │             │
         │ HTTP REST/SSE    │    HTTP     │
         ▼                  ▼             │
┌──────────────────┐   ┌─────────┐        │
│  后端 (Node.js)   │◄──┤  LLM    │◄───────┘
│  Express :3001    │   │  API    │   代理转发到后端
│  TypeScript       │   │(ECNU/  │   调用 LLM
│  工作流引擎/RAG    │   │ DeepSeek│
└──────────────────┘   └─────────┘
```

### 1.2 三个核心服务

| 服务 | 目录 | 端口 | 语言 | 职责 |
|:---|:---|:---|:---|:---|
| **前端** | `frontend/` | 5173 | TypeScript (React 18) | 用户界面、会话管理、Markdown/PPT 渲染 |
| **后端** | `backend/` | 3001 | TypeScript (Express) | LLM 代理、文件解析、RAG、工作流引擎、PPT 生成 |
| **网关** | `gateway-python/` | 3002 | Python 3.12 | 微信/飞书/QQ Bot 管理、消息收发、文件下载、结果推送 |

### 1.3 目录结构详解

```
casebuddy/
├── frontend/                      # React 前端
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx               # 首页（功能介绍 + 导航）
│   │   │   ├── WorkBench.tsx          # 智能分析工作台（核心，1642 行）
│   │   │   ├── PPTAssistant.tsx       # AI PPT 助手
│   │   │   ├── WorkflowPage.tsx       # 智能工作流（模板选择 + 执行）
│   │   │   ├── WeChatAssistant.tsx    # 微信助手（聊天界面）
│   │   │   ├── GatewayConfig.tsx      # 消息网关配置
│   │   │   ├── SkillMarket.tsx        # 技能市场
│   │   │   ├── ModelConfig.tsx        # 模型配置中心
│   │   │   └── Layout.tsx             # 全局布局（侧边栏 + 路由）
│   │   ├── components/
│   │   │   ├── AgentTools.tsx          # Agent 工具调用 UI
│   │   │   ├── MarkdownContent.tsx     # Markdown 渲染组件
│   │   │   └── MessagePreview.tsx      # 消息预览组件
│   │   ├── contexts/
│   │   │   └── SessionContext.tsx      # 会话状态管理（localStorage 持久化）
│   │   ├── hooks/
│   │   │   └── useLocalStorage.ts      # 自定义 Hook
│   │   ├── utils/
│   │   │   ├── exportUtils.ts          # 导出工具（Markdown/PDF/Word）
│   │   │   ├── pptxUtils.ts            # PPTX 生成工具
│   │   │   └── slideParser.ts          # 幻灯片 JSON 解析
│   │   ├── types/
│   │   │   └── index.ts                # TypeScript 类型定义
│   │   ├── App.tsx                     # 根组件（路由注册）
│   │   ├── App.css                     # 全局样式
│   │   ├── index.css                   # Tailwind 入口 + 动画工具类
│   │   └── main.tsx                    # 应用入口
│   ├── package.json
│   └── vite.config.ts
│
├── backend/                       # Node.js 后端
│   ├── src/
│   │   ├── index.ts                   # 主服务（1710 行）：LLM 代理 + 文件解析 + RAG + 工作流 + PPT
│   │   ├── gateway/
│   │   │   ├── index.ts               # 网关配置加载/保存
│   │   │   ├── handler.ts             # 企业微信回调处理
│   │   │   ├── platforms/
│   │   │   │   └── wecom.ts           # 企业微信 Bot
│   │   │   └── utils/
│   │   │       ├── markdown.ts        # Markdown 处理
│   │   │       └── splitter.ts        # 文本分割
│   │   └── routes/
│   │       ├── chat.ts                # 聊天会话管理
│   │       ├── gateway.ts             # 网关管理 API（代理 Python 网关）
│   │       └── pptMaster.ts           # PPT 大纲生成
│   ├── package.json
│   └── tsconfig.json
│
├── gateway-python/                # Python 网关
│   ├── gateway_server.py               # HTTP 网关服务（1253 行）
│   ├── casebuddy_cli.py                # 一键启动/停止 CLI 工具
│   ├── bots/
│   │   ├── wechat_bot.py               # 微信 Bot（iLinkai 平台）
│   │   ├── feishu_bot_enhanced.py      # 飞书 Bot（lark_oapi）
│   │   ├── qq_bot.py                   # QQ Bot
│   │   └── wecom_bot.py                # 企业微信 Bot
│   ├── temp/                           # 运行时数据（配置、日志、PID、文件缓存）
│   ├── requirements.txt                # Python 依赖
│   ├── start.bat                       # Windows 启动脚本
│   └── start.sh                        # Unix 启动脚本
│
├── outputs/                       # PPT 输出文件目录
├── shared/                        # 共享资源（当前为空）
├── .gitignore                    # Git 忽略规则
└── README.md                     # 本文档
```

### 1.4 数据流详解

**案例分析核心流程**：

```
用户上传 PDF ──► 前端 WorkBench ──► POST /api/parse/file ──► 后端 pdf-parse/mammoth
                                                  │
                                                  ▼
                                          提取文本 + 分页
                                                  │
                                                  ▼
                              POST /api/proxy/chat/completions/stream
                                                  │
                                                  ▼
                                       后端代理到 LLM API (ECNU/DeepSeek)
                                                  │
                                                  ▼
                                       SSE 流式返回 ◄── 前端逐字渲染
```

**RAG 知识库流程**：

```
PDF 文本 ──► POST /api/rag/index ──► 后端 chunkTextNode() 分块
                                         │
                                         ▼
                                  BM25 关键词索引存储（~/.casebuddy/rag/）
                                         │
用户提问 ──► POST /api/rag/query ──► keywordSearch() 匹配 topK 块
                                         │
                                         ▼
                                  注入 LLM Prompt 上下文
```

**工作流引擎流程**：

```
用户选择模板 ──► POST /api/workflow/create ──► 创建 Workflow 实例
                                                      │
                      POST /api/workflow/:id/run       │
                                                      ▼
                                               依次执行步骤：
                                               parse_file → rag_index → llm_analyze → ppt_outline → ppt_generate
                                                      │
                                                      ▼
                                               GET /api/workflow/:id（轮询进度）
```

**微信远程操控流程**：

```
微信发消息 ──► iLinkai 平台 ──► Python wechat_bot.py ──► 识别命令
                                                     │
                          ┌──────────────────────────┼──────────────┐
                          ▼                          ▼              ▼
                    「案例速读」              「发送PDF文件」    「发送结果」
                          │                          │              │
                          ▼                          ▼              ▼
               创建工作流执行              下载文件(CDN+AES)   推送最近分析
               调用后端 API               解析→分析→推送     到微信
                          │                          │
                          └──────────┬───────────────┘
                                     ▼
                          分段推送结果（每条 ≤ 1800 字）
```

### 1.5 组件间通信方式

| 通信 | 协议 | 说明 |
|:---|:---|:---|
| 前端 ↔ 后端 | HTTP REST + SSE | 标准请求 + 流式输出 |
| 前端 ↔ Python 网关 | HTTP REST（经后端代理） | `/api/gateway/*` 路由转发到 :3002 |
| Python 网关 ↔ 后端 | HTTP REST | 网关直接调用 `http://localhost:3001` |
| Python 网关 ↔ iLinkai | HTTPS (WebSocket) | 微信消息收发 |
| Python 网关 ↔ 飞书 | HTTPS (WebSocket) | 飞书消息收发 |
| 后端 ↔ LLM API | HTTPS | OpenAI 兼容格式 |
| 前端本地存储 | localStorage | 会话历史、模型配置、Skill 选择 |

---

## 2. 快速启动指南

### 2.1 环境要求

| 依赖 | 最低版本 | 推荐版本 |
|:---|:---|:---|
| Node.js | >= 18.0 | 20+ |
| npm | >= 9.0 | 10+ |
| Python | >= 3.10 | 3.12 |
| Git | 最新 | 最新 |

### 2.2 克隆项目

```bash
git clone https://github.com/user10086user/CaseBuddy.git
cd CaseBuddy
```

### 2.3 安装依赖

```bash
# 前端
cd frontend
npm install
cd ..

# 后端
cd backend
npm install
cd ..

# Python 网关（可选，仅微信/飞书/QQ 功能需要）
cd gateway-python
pip install -r requirements.txt
cd ..
```

### 2.4 配置大模型 API

#### 方式一：后端 .env 文件（工作流引擎使用）

在 `backend/` 目录下创建 `.env` 文件：

```env
# 后端服务端口
PORT=3001

# LLM API 配置（工作流使用）
LLM_BASE_URL=https://chat.ecnu.edu.cn/open/api/v1
LLM_API_KEY=your-api-key-here
LLM_MODEL=ecnu-plus
```

#### 方式二：前端 Web 界面（分析工作台使用）

1. 启动项目后访问 `http://localhost:5173`
2. 左侧导航栏 → **模型配置**
3. 填写 Base URL、API Key、模型名称
4. 支持多模型配置和快速切换

支持的 LLM API：
- **ECNU Chat API**：`https://chat.ecnu.edu.cn/open/api/v1`，模型 `ecnu-plus` / `ecnu-max`
- **DeepSeek**：`https://api.deepseek.com`，模型 `deepseek-chat`
- **任何 OpenAI 兼容 API**：只需提供 Base URL 和 API Key

### 2.5 启动服务

#### 方式一：一键启动（推荐）

```bash
cd gateway-python
python casebuddy_cli.py start          # 启动所有服务
python casebuddy_cli.py start gateway  # 只启动网关
python casebuddy_cli.py status         # 查看状态
python casebuddy_cli.py stop           # 停止所有服务
python casebuddy_cli.py logs backend   # 查看后端日志
```

#### 方式二：开发模式（需要 3 个终端）

```bash
# 终端 1 - 启动后端
cd backend
npm run dev
# → http://localhost:3001

# 终端 2 - 启动前端
cd frontend
npm run dev
# → http://localhost:5173

# 终端 3 - 启动 Python 网关（可选）
cd gateway-python
python gateway_server.py
# → http://localhost:3002
```

#### 方式三：生产模式

**Linux / macOS**：
```bash
# 编译后端
cd backend && npm run build && cd ..

# 启动后端
nohup node backend/dist/index.js > backend.log 2>&1 &

# 启动前端
cd frontend && nohup npx vite --host > frontend.log 2>&1 &

# 启动网关（可选）
cd ../gateway-python && nohup python -u gateway_server.py > gateway.log 2>&1 &
```

**Windows**：
```powershell
# 编译后端
cd backend; npx tsc; cd ..

# 启动后端
Start-Process -NoNewWindow node -ArgumentList "backend\dist\index.js"

# 启动前端
cd frontend; Start-Process -NoNewWindow npx -ArgumentList "vite --host"

# 启动网关（可选）
cd ..\gateway-python; Start-Process -NoNewWindow python -ArgumentList "-u gateway_server.py"
```

### 2.6 验证服务

```bash
# 后端健康检查
curl http://localhost:3001/api/health

# 网关状态检查
curl http://localhost:3002/status
```

### 2.7 配置消息网关（可选）

启动后访问 `http://localhost:5173/gateway`：

- **微信**：点击"启动微信 Bot"，手机扫码登录
- **飞书**：填写 App ID、App Secret，点击启动
- **QQ**：填写 App ID、Token，点击启动

---

## 3. 模块详解

### 3.1 智能分析工作台 (WorkBench)

**核心文件**：`frontend/src/pages/WorkBench.tsx`（1642 行）

主要功能：
- **AI 对话分析**：多轮对话 + SSE 流式输出
- **文件上传解析**：支持 PDF/DOCX，提取文本 + 分页信息
- **7 个内置 Prompt**：案例速读、SWOT、PESTEL、波特五力、深度洞察、PPT大纲、Agent分析
- **9 个内置 Skill**：案例解构引擎、SWOT+TOWS、波特五力、BMC、财务三表、MECE+金字塔、战略综合、竞争态势、行业趋势
- **Skill 关键词自动匹配**：用户输入自动识别并激活相关 Skill
- **RAG 知识库**：上传文件自动构建索引，分析时按需检索注入
- **知识卡片**：LLM 提取案例关键信息（公司/行业/核心问题/关键数据），支持交互跳转
- **历史会话**：localStorage 持久化，支持切换/删除
- **多格式导出**：Markdown / PDF / Word

Skill 注入机制（三重防工具调用幻觉）：
1. `AVAILABLE_SKILLS` 数组定义每个 Skill 的 `systemPromptAddition`，尾部均包含 `禁止调用任何工具`
2. `buildSystemPrompt(skillIds)` 将 Skill 注入 system message，尾部追加工具调用禁止声明
3. `buildSkillInstructions(skillIds)` 在 user message 末尾追加 Skill 指令

### 3.2 AI PPT 助手

**核心文件**：`frontend/src/pages/PPTAssistant.tsx`、`backend/src/routes/pptMaster.ts`

主要功能：
- **数据源**：从工作台会话导入 / 上传 MD/TXT / 自定义主题
- **AI 大纲生成**：LLM 生成 slides JSON 结构
- **风格指南**：5 色配色方案 + 字体规范
- **多平台提示词**：豆包 / Gamma / Canva
- **幻灯片预览**：缩略图列表 + 主预览 + 全屏
- **PPTX 导出**：后端 pptxgenjs 生成真实 .pptx 文件

### 3.3 智能工作流

**核心文件**：`backend/src/index.ts`（L1113-L1400+）

5 个预设模板：

| ID | 名称 | 步骤 |
|:---|:---|:---|
| quick-read | 案例速读 | parse_file → llm_analyze |
| swot | SWOT 分析 | parse_file → rag_index → llm_analyze |
| deep-insight | 深度洞察 | parse_file → rag_index → llm_analyze |
| ppt-outline | PPT 大纲 | parse_file → ppt_outline |
| full-pipeline | 全流程 | parse_file → rag_index → 速读 → SWOT → 洞察 → ppt_outline → ppt_generate |

步骤类型：
- `parse_file`：调用 pdf-parse 提取文本
- `rag_index`：构建 BM25 索引
- `llm_analyze`：调用 LLM 分析
- `ppt_outline`：生成 PPT 大纲
- `ppt_generate`：生成 PPTX 文件

### 3.4 RAG 知识库

**核心文件**：`backend/src/index.ts`（L857-L1112）

- **分块算法**：基于章节边界（Markdown 标题、中文章节编号）+ 句子结束处断句 + 重叠窗口
- **检索引擎**：BM25 关键词匹配（Node.js 原生实现）
- **5 场景策略**：不同分析类型调整 topK 参数
- **索引存储**：`~/.casebuddy/rag/` 目录，JSON 格式

### 3.5 Python 消息网关

**核心文件**：`gateway-python/gateway_server.py`（1253 行）

- **HTTP API 服务**：端口 3002，提供 Bot 管理、消息收发、状态查询
- **微信 Bot**：iLinkai 平台，支持 PDF 上传（CDN + AES-ECB 解密）、自然语言命令、结果推送
- **飞书 Bot**：lark_oapi SDK，WebSocket 长连接，支持文件消息处理
- **QQ Bot**：qq-botpy SDK
- **企业微信 Bot**：由 Node.js 后端直接管理（`backend/src/gateway/`）
- **CLI 工具**：`casebuddy_cli.py` 一键启停所有服务

### 3.6 模型配置中心

**核心文件**：`frontend/src/pages/ModelConfig.tsx`

- OpenAI 兼容格式，任意 LLM API
- 多模型配置和快速切换
- 参数调整：温度、最大 Token
- localStorage 持久化

### 3.7 技能市场

**核心文件**：`frontend/src/pages/SkillMarket.tsx`

- 展示所有可用 Skill
- Skill 启用/禁用切换
- 分析工作台中选择 Skill

---

## 4. API 端点参考

### 后端 API（端口 3001）

**LLM 代理**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/proxy/chat/completions` | LLM 非流式对话 |
| POST | `/api/proxy/chat/completions/stream` | LLM 流式对话（SSE） |

**文件处理**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/parse/file` | 解析 PDF/DOCX 文件 |
| POST | `/api/export/docx` | 导出 Word 文档 |

**RAG 知识库**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/rag/index` | 构建 RAG 索引 |
| POST | `/api/rag/query` | 关键词检索 |
| GET | `/api/rag/list` | 列出已索引案例 |
| DELETE | `/api/rag/index/:caseId` | 删除索引 |

**工作流**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/workflow/templates` | 获取模板列表 |
| POST | `/api/workflow/create` | 创建工作流实例 |
| POST | `/api/workflow/:id/run` | 执行工作流 |
| GET | `/api/workflow/:id` | 查询工作流状态 |
| GET | `/api/workflow` | 列出所有工作流 |
| POST | `/api/workflow/:id/push` | 推送结果到微信 |

**网关代理**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/gateway/status` | 网关状态（合并 Python + Node.js） |
| POST | `/api/gateway/config` | 更新网关配置 |
| POST | `/api/gateway/start/:platform` | 启动指定 Bot |
| POST | `/api/gateway/stop/:platform` | 停止指定 Bot |
| GET | `/api/gateway/qr` | 获取微信二维码 |
| POST | `/api/gateway/chat` | 发送消息 |
| DELETE | `/api/gateway/case-card/:id` | 删除知识卡片 |
| POST | `/api/gateway/sync-session` | 同步会话摘要 |

**PPT**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| POST | `/api/ppt/generate-outline` | AI 生成 PPT 大纲 |

**系统**：

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/health` | 健康检查 |

### Python 网关 API（端口 3002）

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/status` | 网关状态 |
| POST | `/start` | 启动所有 Bot |
| POST | `/start/:platform` | 启动指定 Bot |
| POST | `/stop/:platform` | 停止指定 Bot |
| GET | `/qr` | 获取微信二维码 |
| POST | `/chat` | 发送消息 |
| POST | `/config` | 更新配置 |
| GET | `/config` | 获取配置 |

---

## 5. 项目讲解指引（代码导航）

### 5.1 讲解路线建议

建议按照 **数据流向** 讲解，从用户输入到最终输出，逐层深入。

---

### 5.2 第一部分：项目概览与技术选型（5 分钟）

**讲解要点**：为什么要做这个项目、解决什么问题、技术选型理由

**演示文件**：
- `README.md` — 项目概述
- `package.json`（前端 + 后端）— 依赖和脚本
- `gateway-python/requirements.txt` — Python 依赖

**关键决策**：
- 为什么选 React + Express + Python 三层架构？
  - 前端：React 生态成熟，Tailwind 快速开发
  - 后端：Express 轻量，TypeScript 类型安全
  - 网关：Python 有成熟的 IM Bot SDK（lark-oapi、qq-botpy）

---

### 5.3 第二部分：前端架构与路由（10 分钟）

**讲解要点**：页面结构、路由设计、状态管理

**代码文件**：

| 文件 | 行数 | 讲解内容 |
|:---|:---|:---|
| `frontend/src/App.tsx` | 35 | 路由注册，8 个页面路由 |
| `frontend/src/pages/Layout.tsx` | 273 | 侧边栏导航、会话历史列表、响应式布局 |
| `frontend/src/contexts/SessionContext.tsx` | 147 | 会话状态管理、localStorage 持久化、自动同步到后端 |

**重点讲解**：

1. **路由结构**（`App.tsx` L18-L28）：
```tsx
<Route path="/" element={<Layout />}>
  <Route index element={<Home />} />
  <Route path="workbench" element={<WorkBench />} />
  <Route path="ppt-assistant" element={<PPTAssistant />} />
  <Route path="workflow" element={<WorkflowPage />} />
  {/* ... */}
</Route>
```

2. **状态管理**（`SessionContext.tsx` L41-L50）：为什么用 Context + localStorage 而不是 Redux？
   - 轻量，无需额外库
   - 数据持久化到浏览器
   - 适合单页应用的会话管理

---

### 5.4 第三部分：智能分析工作台（核心，15 分钟）

**讲解要点**：AI 对话、文件解析、Skill 注入、RAG、知识卡片

**代码文件**：

| 文件 | 行数 | 讲解内容 |
|:---|:---|:---|
| `frontend/src/pages/WorkBench.tsx` | 1642 | 整个分析工作台的核心逻辑 |

**重点讲解**：

1. **内置 Skill 系统**（L28-L155）：
```tsx
const AVAILABLE_SKILLS = [
  { id: 'mba-swot', name: 'SWOT + TOWS战略推导', systemPromptAddition: `...` },
  { id: 'mba-bmc', name: '商业模式画布', systemPromptAddition: `...` },
  // ... 共 9 个 Skill
];
```
- 每个 Skill 包含 `systemPromptAddition`，注入 LLM Prompt
- 尾部均包含「禁止调用任何工具」声明，防止 LLM 幻觉输出工具调用 JSON

2. **Skill 自动匹配**（L613-L640）：
```tsx
const autoMatchSkills = (userInput: string): string[] => {
  const keywordMap: Record<string, string[]> = {
    'mba-swot': ['swot', '优劣', '优势', '劣势', 'tow', 'tows'],
    'mba-bmc': ['商业模式', '画布', 'bmc', '价值主张'],
    // ...
  };
  // 匹配逻辑
};
```

3. **LLM 调用**（L417-L460）：
   - `callLLM()` — 非流式调用
   - `callLLMStream()` — SSE 流式调用
   - 两个函数都接受 `skillIds` 参数，动态构建 system prompt 和 user message

4. **知识卡片**（约 L800-L1000）：
   - LLM 提取案例结构化信息
   - 交互按钮：跳转到 SWOT 分析、跳转到 PPT 生成
   - 支持删除、标识当前案例

---

### 5.5 第五部分：后端核心逻辑（15 分钟）

**讲解要点**：LLM 代理、文件解析、RAG 引擎、工作流引擎

**代码文件**：

| 文件 | 行数 | 讲解内容 |
|:---|:---|:---|
| `backend/src/index.ts` | 1710 | 后端主服务 |

**重点讲解**：

1. **LLM 代理**（L30-L140）：
   - 非流式：`POST /api/proxy/chat/completions`
   - 流式：`POST /api/proxy/chat/completions/stream`（SSE）
   - 为什么要代理？— 避免前端 CORS 限制、隐藏 API Key

2. **文件解析**（L142-L200）：
   - `pdf-parse v2` 解析 PDF
   - `mammoth` 解析 DOCX
   - Multer 中间件处理上传

3. **RAG 引擎**（L857-L932）：
   - `chunkTextNode()` — 基于章节边界的文本分块
   - `keywordSearch()` — BM25 关键词检索
   - 索引存储在 `~/.casebuddy/rag/`

4. **工作流引擎**（L1113-L1400+）：
   - 5 个预设模板定义（`WORKFLOW_TEMPLATES`）
   - `POST /api/workflow/create` — 创建实例
   - `POST /api/workflow/:id/run` — 顺序执行步骤
   - 步骤类型：`parse_file`、`rag_index`、`llm_analyze`、`ppt_outline`、`ppt_generate`

---

### 5.6 第六部分：Python 消息网关（10 分钟）

**讲解要点**：Bot 管理、微信文件下载、命令识别、结果推送

**代码文件**：

| 文件 | 行数 | 讲解内容 |
|:---|:---|:---|
| `gateway-python/gateway_server.py` | 1253 | 网关主服务 |
| `gateway-python/bots/wechat_bot.py` | - | 微信 Bot 实现 |
| `gateway-python/bots/feishu_bot_enhanced.py` | - | 飞书 Bot 实现 |
| `gateway-python/casebuddy_cli.py` | - | CLI 启动工具 |

**重点讲解**：

1. **网关架构**（`gateway_server.py` L48-L80）：
   - `GatewayState` 全局状态管理
   - Bot 生命周期：启动 → 运行 → 停止
   - HTTP API 暴露管理接口

2. **微信文件下载**（`wechat_bot.py`）：
   - iLinkai 平台 CDN + AES-ECB 加密
   - 下载 → 解密 → 保存到 temp/ → 调用后端解析

3. **命令识别**（`gateway_server.py`）：
   - 关键词匹配：「案例速读」「SWOT」「深度洞察」等
   - 自动创建工作流并执行

4. **结果推送**：
   - 分段推送（每条 ≤ 1800 字）
   - 支持推送到微信、飞书

---

### 5.7 第七部分：导出与 PPT 生成（5 分钟）

**代码文件**：

| 文件 | 讲解内容 |
|:---|:---|
| `frontend/src/utils/exportUtils.ts` | Markdown / PDF / Word 前端导出 |
| `frontend/src/utils/pptxUtils.ts` | PPTX 生成工具 |
| `backend/src/routes/pptMaster.ts` | PPT 大纲生成 API |

**讲解要点**：
- PDF：html2pdf.js（html2canvas + jsPDF）
- Word：后端 docx 库生成，失败时 fallback HTML .doc
- PPTX：后端 pptxgenjs 生成真实 PowerPoint 文件

---

### 5.8 第八部分：总结与 Q&A（5 分钟）

**可讨论的话题**：
- 架构的可扩展性（新增 Skill、新增 Bot 平台）
- 已知限制和改进方向
- 工作流历史存储（当前为内存，重启丢失）
- RAG 从 BM25 升级到向量检索的可能

---

## 6. 环境变量参考

### 后端 .env

| 变量 | 必填 | 默认值 | 说明 |
|:---|:---|:---|:---|
| `PORT` | 否 | `3001` | 后端服务端口 |
| `LLM_BASE_URL` | 否 | `https://chat.ecnu.edu.cn/open/api/v1` | LLM API 地址 |
| `LLM_API_KEY` | 是 | - | LLM API 密钥 |
| `LLM_MODEL` | 否 | `ecnu-plus` | 默认 LLM 模型 |

### 前端

模型配置通过 Web 界面「模型配置中心」设置，存储在浏览器 localStorage（key: `casebuddy-model-config`）。

### Python 网关

- 配置持久化在 `gateway-python/temp/gateway_config.json`
- 微信 Token 由 iLinkai 平台管理，自动获取
- 飞书需要手动配置 App ID 和 App Secret

---

## 7. 注意事项与已知限制

### 代理问题

如果系统使用 Clash 等代理，Python `requests` 会自动读取系统代理拦截 localhost 请求。解决方案：
- 网关代码中所有 `requests` 调用添加 `proxies={'http': '', 'https': ''}`
- 或启动前清除代理环境变量：`unset http_proxy https_proxy`

### ECNU API 限制

- 不支持 `system` role，需合并到 `user` message
- 长 prompt（>3000 字）可能返回 500 错误
- max_tokens 建议 ≤ 3000

### Node.js 兼容性

- Node.js v22 内置 fetch 返回的 body 不是标准 Web ReadableStream
- SSE 流式需使用 `for await (const chunk of response.body)` 读取

### Windows 特有问题

- Python stdout 重定向时默认 GBK 编码，已在 `gateway_server.py` 顶部处理
- `os.kill(pid, 0)` 不可用，改用 `tasklist` 检查进程

### 已知限制

| 限制 | 影响 | 计划改进 |
|:---|:---|:---|
| 工作流历史存内存 | 后端重启丢失 | 迁移到数据库/文件持久化 |
| RAG 仅 BM25 | 语义检索能力弱 | 接入向量数据库 |
| 无用户认证 | 任何人可访问 | 添加登录系统 |
| 单机部署 | 不支持多用户并发 | Docker 化 + 负载均衡 |

---

## 技术栈总览

| 层级 | 技术 | 版本 |
|:---|:---|:---|
| 前端框架 | React | 18 |
| 构建工具 | Vite | latest |
| 前端语言 | TypeScript | 5 |
| 样式方案 | Tailwind CSS | 3.4 |
| 路由 | React Router | v7 |
| Markdown 渲染 | react-markdown + remark-gfm | latest |
| PDF 导出 | html2pdf.js | latest |
| PPT 生成 | pptxgenjs | latest |
| 后端框架 | Express | 4 |
| 后端语言 | TypeScript | 5 |
| PDF 解析 | pdf-parse v2 | 2.x |
| Word 解析 | mammoth | latest |
| Word 生成 | docx | latest |
| 微信 Bot | Python requests + pycryptodome | 3.12 |
| 飞书 Bot | lark-oapi | 1.x |
| QQ Bot | qq-botpy | 1.x |

---

## License

ISC

---

> Built with React, Node.js, Python, and a lot of caffeine for MBA Case Competition.
