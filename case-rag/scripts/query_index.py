#!/usr/bin/env python3
"""
RAG 检索查询脚本（MBA案例专用）
支持 BM25 / TF-IDF / 混合检索，返回相关片段 + prompt注入格式
"""
import argparse
import json
import os
import pickle
import sys
from pathlib import Path


def bm25_search(query: str, bm25_data: dict, chunks: list, top_k: int) -> list:
    """BM25 关键词检索"""
    try:
        import jieba
        
        bm25 = bm25_data["bm25"]
        query_tokens = [t for t in jieba.cut(query) if len(t) > 1]
        
        scores = bm25.get_scores(query_tokens)
        
        results = []
        for i, score in enumerate(scores):
            if i < len(chunks):
                results.append({
                    "chunk_id": chunks[i]["id"],
                    "score": float(score),
                    "method": "bm25",
                    "section": chunks[i].get("section", ""),
                    "page": chunks[i].get("page", 0),
                    "text": chunks[i]["text"]
                })
        
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
    except Exception as e:
        print(f"BM25检索失败: {e}", file=sys.stderr)
        return []


def tfidf_search(query: str, vectorizer, tfidf_matrix, chunks: list, top_k: int) -> list:
    """TF-IDF 向量检索"""
    try:
        import numpy as np
        from sklearn.metrics.pairwise import cosine_similarity
        
        query_vec = vectorizer.transform([query])
        similarities = cosine_similarity(query_vec, tfidf_matrix).flatten()
        
        results = []
        for i, score in enumerate(similarities):
            if i < len(chunks):
                results.append({
                    "chunk_id": chunks[i]["id"],
                    "score": float(score),
                    "method": "tfidf",
                    "section": chunks[i].get("section", ""),
                    "page": chunks[i].get("page", 0),
                    "text": chunks[i]["text"]
                })
        
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]
    except Exception as e:
        print(f"TF-IDF检索失败: {e}", file=sys.stderr)
        return []


def hybrid_search(bm25_results: list, tfidf_results: list, top_k: int) -> list:
    """混合检索：RRF (Reciprocal Rank Fusion) 融合排序"""
    k = 60  # RRF 常数
    rrf_scores = {}
    
    for rank, result in enumerate(bm25_results):
        cid = result["chunk_id"]
        rrf_scores[cid] = rrf_scores.get(cid, 0) + 1.0 / (k + rank + 1)
    
    for rank, result in enumerate(tfidf_results):
        cid = result["chunk_id"]
        rrf_scores[cid] = rrf_scores.get(cid, 0) + 1.0 / (k + rank + 1)
    
    # 合并结果
    all_results = {r["chunk_id"]: r for r in bm25_results + tfidf_results}
    
    merged = []
    for chunk_id, rrf_score in sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True):
        if chunk_id in all_results:
            result = all_results[chunk_id].copy()
            result["score"] = rrf_score
            result["method"] = "hybrid"
            merged.append(result)
    
    return merged[:top_k]


def format_context_for_prompt(results: list, max_chars: int = 4000) -> str:
    """格式化为 prompt 可注入的上下文"""
    if not results:
        return ""
    
    lines = ["【相关案例内容（按相关度排序）】\n"]
    total_chars = len(lines[0])
    
    for r in results:
        source = f"[第{r['page']}页·{r['section']}]" if r.get('page') and r.get('section') else f"[片段{r['chunk_id']}]"
        text = r["text"].strip()
        
        # 超长截断
        if len(text) > 600:
            text = text[:600] + "..."
        
        block = f"{source}\n{text}\n"
        
        if total_chars + len(block) > max_chars:
            lines.append(f"\n[...还有 {len(results) - results.index(r)} 个相关片段未显示]")
            break
        
        lines.append(block)
        total_chars += len(block)
    
    return "\n".join(lines)


def query_index(case_id: str, query: str, top_k: int, method: str, index_dir: str):
    """主查询函数"""
    case_dir = Path(index_dir).expanduser() / case_id
    
    if not case_dir.exists():
        print(json.dumps({"error": f"案例索引不存在: {case_id}，请先运行 build_index.py"}))
        sys.exit(1)
    
    # 读取元数据
    with open(case_dir / "meta.json", "r", encoding="utf-8") as f:
        meta = json.load(f)
    
    # 读取分块
    with open(case_dir / "chunks.json", "r", encoding="utf-8") as f:
        chunks_data = json.load(f)
    chunks = chunks_data["chunks"]
    
    bm25_results = []
    tfidf_results = []
    
    # BM25 检索
    if method in ("bm25", "hybrid") and "bm25" in meta["methods"]:
        bm25_pkl = case_dir / "bm25_index.pkl"
        if bm25_pkl.exists():
            with open(bm25_pkl, "rb") as f:
                bm25_data = pickle.load(f)
            bm25_results = bm25_search(query, bm25_data, chunks, top_k * 2)
    
    # TF-IDF 检索
    if method in ("tfidf", "hybrid") and "tfidf" in meta["methods"]:
        vocab_pkl = case_dir / "tfidf_vocab.pkl"
        matrix_npz = case_dir / "tfidf_matrix.npz"
        if vocab_pkl.exists() and matrix_npz.exists():
            import scipy.sparse
            with open(vocab_pkl, "rb") as f:
                vectorizer = pickle.load(f)
            tfidf_matrix = scipy.sparse.load_npz(str(matrix_npz))
            tfidf_results = tfidf_search(query, vectorizer, tfidf_matrix, chunks, top_k * 2)
    
    # 融合排序
    if method == "hybrid" and bm25_results and tfidf_results:
        final_results = hybrid_search(bm25_results, tfidf_results, top_k)
    elif bm25_results:
        final_results = bm25_results[:top_k]
    elif tfidf_results:
        final_results = tfidf_results[:top_k]
    else:
        # 兜底：直接返回前几块
        final_results = [
            {"chunk_id": c["id"], "score": 0.5, "method": "fallback",
             "section": c.get("section", ""), "page": c.get("page", 0), "text": c["text"]}
            for c in chunks[:top_k]
        ]
    
    context_for_prompt = format_context_for_prompt(final_results)
    
    output = {
        "status": "ok",
        "case_id": case_id,
        "query": query,
        "method_used": method,
        "total_chunks_in_index": len(chunks),
        "results_count": len(final_results),
        "results": final_results,
        "context_for_prompt": context_for_prompt
    }
    
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MBA案例RAG检索")
    parser.add_argument("--case-id", required=True, help="案例唯一ID")
    parser.add_argument("--query", required=True, help="查询意图（自然语言）")
    parser.add_argument("--top-k", type=int, default=5, help="返回片段数（默认5）")
    parser.add_argument("--method", default="hybrid", choices=["bm25", "tfidf", "hybrid"],
                        help="检索方法（默认hybrid混合）")
    parser.add_argument("--index-dir", default="~/.casebuddy/rag/", help="索引根目录")
    args = parser.parse_args()
    
    query_index(args.case_id, args.query, args.top_k, args.method, args.index_dir)
