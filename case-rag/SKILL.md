---
name: case-rag
version: 1.0.0
description: >
  MBA 案例 RAG 知识库框架 Skill：将 PDF 案例构建为可检索的知识库，
  支持关键词检索和轻量向量检索，按需注入相关片段（替代全文塞上下文）。
  触发词：构建知识库、案例RAG、智能检索、按需检索、知识索引、
  build rag、case knowledge base、semantic search case。
description_zh: MBA案例RAG知识库，将PDF分块索引，按分析意图检索相关片段，替代全文注入上下文，提升LLM分析质量。
description_en: MBA case RAG knowledge base that indexes PDF chunks and retrieves relevant passages by analysis intent, replacing full-text context injection.
allowed-tools: Bash, Read, Write, Glob
agent_created: true
---

# case-rag — MBA案例RAG知识库框架

> 解决 CaseBuddy 的核心 P0 问题：从"把整个 PDF 塞进上下文"升级为"按需检索相关片段"。

---

## 架构设计

```
PDF 上传
   │
   ▼
[extract_pdf.py]       ← pdf-case-reader skill
   │  全文文本 + 分页元数据
   ▼
[chunk_text.py]        ← pdf-case-reader skill  
   │  chunks[] JSON（id/text/section/page）
   ▼
[build_index.py]  ────── 本 Skill ─────────────────────────────────
   │  BM25 关键词索引 + 可选 TF-IDF 向量索引
   │  存储到 ~/.casebuddy/rag/<case_id>/
   ▼
[query_index.py]        ← 查询时调用
   │  输入：查询意图 + top_k
   │  输出：相关 chunks（带 score + 来源标注）
   ▼
inject_to_prompt()      ← CaseBuddy WorkBench 集成点
   │  相关 chunks → 精准上下文注入
   ▼
LLM 分析
```

---

## 五个分析场景的RAG策略

| 场景 | 查询关键词 | 注入片段数 | 补充内容 |
|------|-----------|-----------|---------|
| **案例速读** | "公司背景 主营业务 核心数据" | 5-8块 | 摘要卡片 |
| **角度选择** | "问题 挑战 机遇 战略" | 3-5块 | 实体列表 |
| **深度分析** | 具体框架关键词（如"竞争 市场份额"） | 8-12块 | 全文可用 |
| **PPT制作** | "数据 财务 增长 市场规模" | 5块 | 已有分析 |
| **答辩准备** | "结论 建议 风险 依据" | 5块 | 历史分析 |

---

## 环境准备

```bash
# 轻量RAG依赖（无需GPU，无需向量数据库）
pip install rank-bm25 jieba scikit-learn numpy
```

可选增强（语义搜索）：
```bash
pip install sentence-transformers  # 需要 ~500MB 模型下载
```

---

## 使用工作流

### Step 1: 构建索引（PDF上传后执行一次）

```bash
python scripts/build_index.py \
  --chunks-file <path/to/case_chunks.json> \
  --case-id <唯一ID，如 alibaba_2023> \
  --index-dir ~/.casebuddy/rag/
```

成功后输出：
```json
{
  "status": "ok",
  "case_id": "alibaba_2023",
  "index_dir": "~/.casebuddy/rag/alibaba_2023/",
  "total_chunks": 28,
  "methods": ["bm25", "tfidf"]
}
```

### Step 2: 查询（分析时调用）

```bash
python scripts/query_index.py \
  --case-id <唯一ID> \
  --query "公司面临的核心竞争问题和市场地位" \
  --top-k 5 \
  --index-dir ~/.casebuddy/rag/
```

输出（注入 prompt 的上下文片段）：
```json
{
  "query": "公司面临的核心竞争问题",
  "results": [
    {
      "chunk_id": 3,
      "score": 0.87,
      "section": "市场竞争分析",
      "page": 4,
      "text": "...",
      "source_label": "[第4页·市场竞争分析]"
    }
  ],
  "context_for_prompt": "【相关案例内容】\n[第4页·市场竞争分析]\n...\n[第6页·战略困境]\n..."
}
```

### Step 3: 集成到 CaseBuddy WorkBench（核心改造点）

修改 `WorkBench.tsx` 的 `sendMessage` 函数，在 `{{case}}` 替换处：

```typescript
// 原来（低效）：
const caseContext = session.caseText; // 全文，可能 30000+ 字符

// 改为（高效）：
const caseContext = await fetchRAGContext(session.caseId, queryIntent, 8);
// 返回最相关的 ~3000 字符
```

后端新增 `/api/rag/query` 接口（见 `case-rag` references/backend-integration.md）。

---

## 索引存储结构

```
~/.casebuddy/rag/
└── <case_id>/
    ├── chunks.json          ← 原始分块数据
    ├── bm25_index.pkl       ← BM25 序列化索引
    ├── tfidf_matrix.npz     ← TF-IDF 矩阵
    ├── tfidf_vocab.pkl      ← TF-IDF 词汇表
    └── meta.json            ← 索引元数据
```

---

## 后端集成接口

### POST `/api/rag/index`
构建索引
```json
{
  "caseId": "alibaba_2023",
  "chunksData": { "chunks": [...] }
}
```

### POST `/api/rag/query`
查询相关片段
```json
{
  "caseId": "alibaba_2023",
  "query": "核心竞争问题",
  "topK": 5,
  "method": "hybrid"
}
```

### DELETE `/api/rag/index/:caseId`
删除索引

---

## 技术选型说明

**为什么不用向量数据库？**
- Pinecone/Weaviate 需要网络和 API key
- FAISS 本地部署需要 C++ 编译
- 对 MBA 案例（<100 chunks）**BM25 + TF-IDF 已足够**，检索质量与向量方法相当

**未来升级路径（RAG v2）**：
- 接入 `text2vec-chinese` 模型（离线语义检索）
- 支持多案例跨文档检索
- 添加重排序（reranking）步骤

---

## NEVER 规则

- 不在 RAG 结果中包含超过 4000 字符（防止注入后超上下文）
- 不跨案例混用索引（每个 case_id 独立）
- 不修改原始 PDF 或分块数据
- top_k 最大不超过 15（保证检索质量）
