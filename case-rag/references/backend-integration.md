# CaseBuddy RAG 后端集成指南

## 概述

将 `case-rag` skill 集成到 CaseBuddy 后端，提供 `/api/rag/*` 接口族。

---

## 新增后端接口

在 `backend/src/index.ts` 中新增以下三个接口：

### 1. POST `/api/rag/index` — 构建案例索引

```typescript
app.post('/api/rag/index', upload.none(), async (req, res) => {
  const { caseId, chunksJson } = req.body;
  // 将 chunksJson 写入临时文件
  // 调用 build_index.py
  // 返回 { status, caseId, totalChunks, methods }
});
```

### 2. POST `/api/rag/query` — 查询相关片段

```typescript
app.post('/api/rag/query', async (req, res) => {
  const { caseId, query, topK = 5, method = 'hybrid' } = req.body;
  // 调用 query_index.py
  // 返回 { results, contextForPrompt }
});
```

### 3. DELETE `/api/rag/index/:caseId` — 删除索引

```typescript
app.delete('/api/rag/index/:caseId', async (req, res) => {
  const { caseId } = req.params;
  // 删除 ~/.casebuddy/rag/<caseId>/ 目录
});
```

---

## 前端集成（WorkBench.tsx）

### 新增 session 字段

```typescript
interface Session {
  // ... 现有字段 ...
  caseId?: string;          // 案例唯一ID（上传PDF时生成）
  ragEnabled?: boolean;     // 是否启用RAG
  ragIndexed?: boolean;     // 是否已建立索引
}
```

### 修改 handleFileUpload

```typescript
const handleFileUpload = async (e) => {
  // ... 现有代码 ...
  
  // 上传成功后，自动触发RAG索引构建
  const caseId = `case_${Date.now()}`;
  setSession(prev => ({ ...prev, caseId, ragIndexed: false }));
  
  // 后台异步构建索引（不阻塞用户）
  buildRAGIndex(caseId, data.text).then(() => {
    setSession(prev => ({ ...prev, ragIndexed: true }));
  });
};
```

### 修改 sendMessage 中的 {{case}} 替换

```typescript
// 构建案例上下文
const getCaseContext = async (query: string): Promise<string> => {
  if (session.ragEnabled && session.ragIndexed && session.caseId) {
    try {
      const resp = await fetch('http://localhost:3001/api/rag/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caseId: session.caseId,
          query,
          topK: 8,
          method: 'hybrid'
        })
      });
      const data = await resp.json();
      return data.contextForPrompt || session.caseText.slice(0, 3000);
    } catch {
      return session.caseText.slice(0, 3000);  // 降级
    }
  }
  return session.caseText;  // 未启用RAG时仍返回全文
};

// 在 sendMessage 中：
const caseContext = await getCaseContext(content);
fullContent = content.replace(/\{\{case\}\}/g, caseContext);
```

---

## 渐进式迁移策略

**阶段1（当前）**：保留全文注入，新增 RAG 开关（默认关闭）
**阶段2**：RAG 稳定后，对超过 8000 字的案例自动启用 RAG
**阶段3**：所有案例默认 RAG，全文模式作为高级选项保留

---

## 查询意图映射

不同快捷分析按钮对应不同查询意图：

```typescript
const ragQueryMap: Record<string, string> = {
  summary: '公司背景 主营业务 核心财务数据 关键事件',
  swot: '优势劣势 机会威胁 竞争 市场地位',
  pestel: '政治 经济 社会 技术 环境 法律 宏观因素',
  porter: '竞争对手 供应商 买家 替代品 进入壁垒',
  insight: '战略问题 关键矛盾 决策 商业模式',
  ppt: '核心数据 财务指标 市场规模 增长率',
  agent: '商业问题 战略建议 风险 机遇',
};
```

---

## 预期效果

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 注入上下文长度 | 30,000 字 | 3,000 字 |
| LLM 响应质量 | 泛化（被大量无关内容稀释） | 精准（相关片段集中） |
| Token 消耗 | 高 | 降低约 70% |
| 支持案例长度 | <30,000 字 | 理论无限 |
