#!/usr/bin/env python3
"""
RAG 索引构建脚本（MBA案例专用）
使用 BM25 + TF-IDF 双路检索，无需向量数据库
"""
import argparse
import json
import os
import pickle
import sys
from pathlib import Path


def build_bm25_index(chunks: list):
    """构建 BM25 关键词索引"""
    try:
        from rank_bm25 import BM25Okapi
        import jieba
        
        tokenized_corpus = []
        for chunk in chunks:
            # 中文分词
            tokens = list(jieba.cut(chunk["text"]))
            # 过滤短词和标点
            tokens = [t for t in tokens if len(t) > 1 and t.strip()]
            tokenized_corpus.append(tokens)
        
        bm25 = BM25Okapi(tokenized_corpus)
        return bm25, tokenized_corpus
    except ImportError as e:
        print(f"BM25 不可用: {e}", file=sys.stderr)
        return None, None


def build_tfidf_index(chunks: list):
    """构建 TF-IDF 向量索引"""
    try:
        from sklearn.feature_extraction.text import TfidfVectorizer
        import numpy as np
        import scipy.sparse
        
        texts = [chunk["text"] for chunk in chunks]
        
        # 使用字符级 n-gram（适合中文）
        vectorizer = TfidfVectorizer(
            analyzer='char_wb',
            ngram_range=(2, 3),
            max_features=5000,
            min_df=1
        )
        
        tfidf_matrix = vectorizer.fit_transform(texts)
        return vectorizer, tfidf_matrix
    except ImportError as e:
        print(f"TF-IDF 不可用: {e}", file=sys.stderr)
        return None, None


def build_index(chunks_file: str, case_id: str, index_dir: str):
    """构建完整RAG索引"""
    # 读取分块数据
    with open(chunks_file, "r", encoding="utf-8") as f:
        chunks_data = json.load(f)
    
    chunks = chunks_data.get("chunks", [])
    if not chunks:
        print("错误：分块数据为空", file=sys.stderr)
        sys.exit(1)
    
    # 创建索引目录
    case_dir = Path(index_dir).expanduser() / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    
    methods_built = []
    
    # 保存原始分块
    chunks_copy = case_dir / "chunks.json"
    with open(chunks_copy, "w", encoding="utf-8") as f:
        json.dump(chunks_data, f, ensure_ascii=False, indent=2)
    
    # 构建 BM25
    bm25, tokenized = build_bm25_index(chunks)
    if bm25 is not None:
        with open(case_dir / "bm25_index.pkl", "wb") as f:
            pickle.dump({"bm25": bm25, "tokenized": tokenized}, f)
        methods_built.append("bm25")
    
    # 构建 TF-IDF
    vectorizer, matrix = build_tfidf_index(chunks)
    if vectorizer is not None:
        import scipy.sparse
        import numpy as np
        
        scipy.sparse.save_npz(str(case_dir / "tfidf_matrix.npz"), matrix)
        with open(case_dir / "tfidf_vocab.pkl", "wb") as f:
            pickle.dump(vectorizer, f)
        methods_built.append("tfidf")
    
    # 保存元数据
    meta = {
        "case_id": case_id,
        "source_file": str(chunks_file),
        "total_chunks": len(chunks),
        "methods": methods_built,
        "created_at": __import__("datetime").datetime.now().isoformat()
    }
    with open(case_dir / "meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    
    print(json.dumps({
        "status": "ok",
        "case_id": case_id,
        "index_dir": str(case_dir),
        "total_chunks": len(chunks),
        "methods": methods_built
    }, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="构建MBA案例RAG索引")
    parser.add_argument("--chunks-file", required=True, help="分块JSON文件路径（来自chunk_text.py）")
    parser.add_argument("--case-id", required=True, help="案例唯一ID（如 alibaba_2023）")
    parser.add_argument("--index-dir", default="~/.casebuddy/rag/", help="索引存储根目录")
    args = parser.parse_args()
    
    build_index(args.chunks_file, args.case_id, args.index_dir)
