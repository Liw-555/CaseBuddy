# CaseBuddy - AI赋能MBA案例分析大赛专家产品

> 让 AI Agent 成为你的 "超级外脑"

CaseBuddy 是专为 **MBA案例分析大赛** 设计的 AI 协同专家产品。在 5 小时极限挑战中，帮你完成从案例解构、深度分析、数据整理到 PPT 生成、答辩准备的全流程。

---

## 核心功能

### 1. 智能分析工作台 (WorkBench)
- **案例速读**：自动提取核心摘要、关键事件时间线、核心决策点
- **战略框架分析**：SWOT、PESTEL、波特五力、价值链等经典框架一键调用
- **深度洞察生成**：跨行业类比、红队质疑、颠覆性假设
- **数据驱动分析**：自动提取案例中的财务/市场/运营数据，Markdown表格呈现
- **Agent智能体**：支持工具调用、联网搜索、多步骤推理
- **文件上传**：支持 PDF、DOCX 案例文件上传解析
- **多格式导出**：单条/整轮对话可导出 Markdown、PDF、Word

### 2. AI PPT助手 (PPT Assistant)
- **大纲生成**：基于案例分析自动生成结构化PPT大纲
- **风格指南**：配色方案、字体规范、图片/图表风格建议
- **多平台适配**：一键生成豆包、Gamma、Canva 平台提示词
- **幻灯片预览**：内置 SlidePreview 视觉参考
- **格式导出**：Markdown、JSON、PPTX（pptxgenjs原生生成）

### 3. 模型配置中心 (Model Config)
- 支持任意 OpenAI 兼容格式的 LLM API
- 内置 ECNU Chat API 配置（ecnu-plus / ecnu-max）
- 多模型切换，温度、最大token等参数可调

### 4. Skill技能市场 (Skill Market)
- 可扩展的技能插件系统
- 内置 Prompt 模板库，支持自定义扩展

---

## 技术架构

```
CaseBuddy/
├── frontend/          # React 18 + Vite + TypeScript + Tailwind CSS
│   ├── src/pages/     # 页面组件（Home/WorkBench/PPTAssistant/ModelConfig/SkillMarket）
│   ├── src/components/# 通用组件（AgentTools/MarkdownContent/MessagePreview）
│   ├── src/contexts/  # React Context（Session状态管理）
│   ├── src/utils/     # 工具函数（导出、格式处理）
│   └── src/hooks/     # 自定义 Hooks
├── backend/           # Node.js + Express + TypeScript
│   ├── src/routes/    # API路由（chat/ppt-master）
│   └── src/index.ts   # 服务端入口
└── ppt-master/        # PPT Master 插件（子模块）
```

### 技术栈

| 层级 | 技术 |
|:---|:---|
| 前端框架 | React 18 + Vite + TypeScript |
| 样式方案 | Tailwind CSS 3.4 + 自定义 Design Token |
| 路由 | React Router v7 |
| 状态管理 | React Context + useLocalStorage |
| Markdown渲染 | react-markdown + remark-gfm |
| PDF导出 | html2pdf.js |
| PPT生成 | pptxgenjs |
| 后端框架 | Express 4 + TypeScript |
| 文件解析 | pdf-parse + mammoth |
| Word导出 | docx (后端生成) |

---

## 快速启动

### 环境要求
- Node.js >= 18.0
- npm >= 9.0

### 1. 安装依赖

```bash
# 前端
cd frontend
npm install

# 后端
cd ../backend
npm install
```

### 2. 配置环境变量

后端创建 `.env` 文件：

```env
PORT=3001
```

### 3. 启动服务

**开发模式：**

```bash
# 终端1 - 启动后端
cd backend
npm run dev

# 终端2 - 启动前端
cd frontend
npm run dev
```

**生产部署（Linux/macOS）：**

```bash
# 编译后端
cd backend
npm run build

# nohup 启动（必须独立启动，不能用 bash 后台 &）
nohup node dist/index.js > backend.log 2>&1 &

# 前端
cd ../frontend
nohup npx vite --host > frontend.log 2>&1 &
```

### 4. 访问应用

- 前端：`http://localhost:5173`
- 后端 API：`http://localhost:3001`
- 健康检查：`curl http://localhost:3001/api/health`

---

## 项目结构详解

```
casebuddy/
├── frontend/
│   ├── src/pages/
│   │   ├── Home.tsx           # 首页 - 产品功能介绍
│   │   ├── WorkBench.tsx      # 分析工作台 - 核心交互页面
│   │   ├── PPTAssistant.tsx   # AI PPT助手 - 大纲/风格/预览/导出
│   │   ├── ModelConfig.tsx    # 模型配置 - API密钥/模型参数
│   │   ├── SkillMarket.tsx    # 技能市场 - Prompt模板库
│   │   └── Layout.tsx         # 布局框架 - 侧边栏+主内容区
│   ├── src/components/
│   │   ├── AgentTools.tsx     # Agent工具调用组件
│   │   ├── MarkdownContent.tsx # Markdown渲染组件
│   │   └── MessagePreview.tsx  # 消息预览弹窗
│   ├── src/utils/
│   │   └── exportUtils.ts     # 导出功能（Markdown/PDF/DOCX）
│   └── public/
│       └── icons.svg          # Lucide 图标 Sprite
├── backend/
│   ├── src/routes/
│   │   ├── chat.ts            # 聊天/代理API路由
│   │   └── pptMaster.ts       # PPT生成API路由
│   └── src/index.ts           # Express 应用入口
└── outputs/                   # PPT文件输出目录
```

---

## 核心设计原则

### 数据呈现规范
- AI分析结果中 **主动提取关键数据**
- 所有数据必须 **Markdown表格** 形式呈现
- 数据表格不少于 2 个
- PPT大纲中至少 2 页使用 `data` 布局，含 `tableData` 二维数组

### Action Title 原则
- PPT每页标题必须是 **完整观点句**（而非名词短语）
- 遵循金字塔原理和 MECE 原则

### 动画与交互
- 消息出现：`animate-message-in`（fade + slide-up + scale）
- 卡片悬停：`card-hover`（上浮+阴影）
- 骨架屏：`skeleton-shimmer`（闪光动画）

---

## 已知问题与注意事项

1. **ECNU API 限制**
   - 不支持 `system` role，需合并到 user message
   - 长 prompt (>500字符) 或复杂 JSON 可能返回 500 错误
   - 建议使用简洁 prompt，max_tokens ≤ 3000

2. **Node.js fetch 兼容性**
   - Node.js v22 内置 fetch 返回的 body 不是标准 Web ReadableStream
   - SSE 流式输出使用 `for await (const chunk of response.body)` 读取

3. **npm install 方法**
   - 如遇到 "Could not determine Node.js install directory" 错误
   - 使用完整 node 路径调用 npm-cli.js

---

## 默认模型配置

| 参数 | 默认值 |
|:---|:---|
| Base URL | `https://chat.ecnu.edu.cn/open/api/v1` |
| 默认模型 | `ecnu-plus` |
| 备选模型 | `ecnu-max` |
| 温度 | 0.7 |
| 最大Token | 4000 |

---

## 路线图

- [x] 智能分析工作台（案例速读/框架分析/深度洞察）
- [x] AI PPT助手（大纲/风格/预览/导出）
- [x] 模型配置中心（多API/多模型支持）
- [x] 文件上传解析（PDF/DOCX）
- [x] 多格式导出（Markdown/PDF/Word/PPTX）
- [x] Agent工具调用
- [ ] 联网搜索增强
- [ ] 多人协作模式
- [ ] 答辩模拟训练

---

## License

ISC

---

> Built with React, Node.js, and a lot of caffeine for MBA Case Competition.
