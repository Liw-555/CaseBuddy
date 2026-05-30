---
name: pdf-case-reader
version: 1.0.0
description: >
  MBA 案例 PDF 智能阅读 Skill：提取 PDF 文本、分块结构化、生成案例摘要卡片、
  识别关键数据表格和决策节点。配合 CaseBuddy RAG 流程使用。
  触发词：读案例、提取案例、解析PDF、案例速读、案例文本提取、
  PDF分析、读这个案例、帮我读PDF、extract case、parse case pdf。
description_zh: MBA案例PDF智能阅读工具，支持文本提取、分块结构化、摘要卡片、数据识别，可与RAG配合减少全文塞入上下文。
description_en: Smart MBA case PDF reader with text extraction, chunking, summary card generation, and key data identification. Works with CaseBuddy RAG pipeline.
allowed-tools: Bash, Read, Write, Glob
agent_created: true
---

# pdf-case-reader — MBA案例PDF智能阅读

> 专为 MBA 案例分析大赛设计。目标：从 PDF 提取结构化内容，替代"把全文塞进上下文"的低效做法。

## 核心问题诊断

**现状（低效）**：`{{case}}` 占位符 → `session.caseText`（全文）→ 直接拼入 prompt → 塞满 LLM 上下文

**目标（高效）**：PDF → 分块提取 → 结构化索引 → 按需检索相关片段 → 精准注入 prompt

---

## 使用场景

| 场景 | 调用方式 | 输出 |
|------|---------|------|
| 案例速读 | `extract_and_summarize` | 摘要卡片（300字+时间线+数据表） |
| 角度选择 | `extract_key_entities` | 企业/行业/问题实体列表 |
| 深度分析 | `chunk_by_section` | 按章节分块（可供RAG检索） |
| PPT制作 | `extract_data_tables` | 所有数据表格（财务/市场/运营） |
| 答辩准备 | `extract_arguments` | 核心论点和支撑证据 |

---

## 环境准备

```bash
# 检查并安装依赖
pip install pdfplumber pymupdf markitdown 2>/dev/null || \
  python -m pip install pdfplumber pymupdf markitdown
```

---

## 工作流

### Step 1: PDF 文本提取

优先使用 `pdfplumber`（结构化强），回退到 `markitdown`（兼容性好）：

```python
# 使用脚本：scripts/extract_pdf.py
python scripts/extract_pdf.py --input <pdf_path> --output <output_dir> --mode full
```

### Step 2: 智能分块

将全文按以下规则分块（避免跨段截断）：

1. **硬边界**：`##`/`###` 标题、页码分隔符、明显的空白行
2. **软边界**：每块约 800-1200 字，在句号/换行处截断
3. **元数据**：每块携带 `{chunk_id, page_range, section_title, char_count}`

```python
python scripts/chunk_text.py --input <text_file> --chunk-size 1000 --overlap 100
```

### Step 3: 结构化信息提取

从全文提取关键结构化数据：

```python
python scripts/extract_structure.py --input <text_file> --output case_structure.json
```

输出格式：
```json
{
  "company": "企业名称",
  "industry": "行业",
  "time_range": "时间范围",
  "core_problem": "核心问题",
  "key_decisions": ["决策1", "决策2"],
  "financial_data": [{"metric": "营收", "value": "XX亿", "year": "2023"}],
  "timeline": [{"year": "2020", "event": "..."}],
  "chunks": [{"id": 0, "text": "...", "page": 1, "section": "背景介绍"}]
}
```

### Step 4: 摘要卡片生成

生成标准 MBA 案例摘要卡片（300字以内）：

```
【案例摘要卡片】
企业：xxx | 行业：xxx | 时间：xxxx-xxxx年
核心问题：一句话概括
关键决策点：① ② ③
核心数据：[数据表格]
时间线：[事件序列]
```

---

## 脚本说明

### `scripts/extract_pdf.py`
功能：PDF → 纯文本 + 元数据
参数：
- `--input <path>`: PDF 文件路径
- `--output <dir>`: 输出目录
- `--mode`: `full`（全文）/ `structured`（结构化）/ `tables`（仅表格）

### `scripts/chunk_text.py`
功能：长文本 → 分块列表（JSON）
参数：
- `--chunk-size <n>`: 每块最大字符数（默认1000）
- `--overlap <n>`: 相邻块重叠字符数（默认100）

### `scripts/extract_structure.py`
功能：提取关键实体和结构（调用LLM辅助理解）

---

## 与 CaseBuddy 集成

在 WorkBench 的快捷分析中，`{{case}}` 替换规则改为：

```
原来：content.replace(/{{case}}/g, session.caseText)
改为：content.replace(/{{case}}/g, session.caseChunks?.summary || session.caseText.slice(0, 3000))
```

具体实现见 `case-rag` skill 的集成指南。

---

## NEVER 规则

- 不做 OCR（扫描版PDF需先用 tesseract 处理）
- 不做跨会话持久化（状态存 session，刷新即清）
- 分块大小不超过 2000 字（防止单块超过LLM上下文）
- 不写入用户 PDF 原文件
