#!/usr/bin/env python3
"""
文本智能分块脚本（MBA案例专用）
按章节边界和字符数限制分块，保留元数据
"""
import argparse
import json
import re
import sys
from pathlib import Path


def detect_section_boundary(line: str) -> bool:
    """检测章节边界"""
    patterns = [
        r'^#{1,4}\s+',           # Markdown 标题
        r'^第[一二三四五六七八九十\d]+[章节部分]',  # 中文章节
        r'^\d+\.\s+[A-Z\u4e00-\u9fff]',  # 数字编号章节
        r'^[一二三四五六七八九十]+、',      # 中文列举
        r'^--- 第\d+页 ---',      # 页码分隔符
        r'^={3,}',               # 分隔线
        r'^-{3,}',               # 分隔线
    ]
    for p in patterns:
        if re.match(p, line.strip()):
            return True
    return False


def is_sentence_end(line: str) -> bool:
    """判断是否是句子结束处（适合截断）"""
    return line.strip().endswith(('。', '！', '？', '.', '!', '?', '；', ';'))


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 100) -> list:
    """
    智能分块：
    1. 优先在章节标题处分块
    2. 其次在句子结束处分块
    3. 保证 chunk_size 软上限
    4. 保留 overlap 字符的上下文重叠
    """
    lines = text.split('\n')
    chunks = []
    current_chunk = []
    current_size = 0
    current_section = "正文"
    chunk_id = 0
    
    # 尝试识别当前页码
    current_page = 1
    
    for i, line in enumerate(lines):
        # 提取页码
        page_match = re.match(r'^--- 第(\d+)页 ---', line)
        if page_match:
            current_page = int(page_match.group(1))
            continue
        
        # 检测章节标题
        if detect_section_boundary(line) and line.strip():
            # 如果当前块有内容，先保存
            if current_size > 100:
                chunk_text_content = '\n'.join(current_chunk).strip()
                if chunk_text_content:
                    chunks.append({
                        "id": chunk_id,
                        "text": chunk_text_content,
                        "section": current_section,
                        "page": current_page,
                        "char_count": len(chunk_text_content)
                    })
                    chunk_id += 1
                
                # 保留 overlap
                overlap_text = chunk_text_content[-overlap:] if len(chunk_text_content) > overlap else chunk_text_content
                current_chunk = [overlap_text] if overlap_text else []
                current_size = len(overlap_text)
            
            # 更新章节标题
            current_section = line.strip()
            current_chunk.append(line)
            current_size += len(line)
        else:
            current_chunk.append(line)
            current_size += len(line) + 1  # +1 for newline
            
            # 超过 chunk_size 且在句子结束处，强制分块
            if current_size >= chunk_size and is_sentence_end(line):
                chunk_text_content = '\n'.join(current_chunk).strip()
                if chunk_text_content:
                    chunks.append({
                        "id": chunk_id,
                        "text": chunk_text_content,
                        "section": current_section,
                        "page": current_page,
                        "char_count": len(chunk_text_content)
                    })
                    chunk_id += 1
                
                overlap_text = chunk_text_content[-overlap:] if len(chunk_text_content) > overlap else chunk_text_content
                current_chunk = [overlap_text] if overlap_text else []
                current_size = len(overlap_text)
            
            # 强制上限：超过 chunk_size * 1.5 直接分块
            elif current_size >= chunk_size * 1.5:
                chunk_text_content = '\n'.join(current_chunk).strip()
                if chunk_text_content:
                    chunks.append({
                        "id": chunk_id,
                        "text": chunk_text_content,
                        "section": current_section,
                        "page": current_page,
                        "char_count": len(chunk_text_content)
                    })
                    chunk_id += 1
                
                overlap_text = chunk_text_content[-overlap:] if len(chunk_text_content) > overlap else chunk_text_content
                current_chunk = [overlap_text] if overlap_text else []
                current_size = len(overlap_text)
    
    # 保存最后一块
    if current_chunk:
        chunk_text_content = '\n'.join(current_chunk).strip()
        if chunk_text_content:
            chunks.append({
                "id": chunk_id,
                "text": chunk_text_content,
                "section": current_section,
                "page": current_page,
                "char_count": len(chunk_text_content)
            })
    
    return chunks


def main():
    parser = argparse.ArgumentParser(description="文本智能分块（MBA案例专用）")
    parser.add_argument("--input", required=True, help="输入文本文件路径（来自extract_pdf.py）")
    parser.add_argument("--output", help="输出JSON文件路径（默认: 同目录下 _chunks.json）")
    parser.add_argument("--chunk-size", type=int, default=1000, help="每块最大字符数（默认1000）")
    parser.add_argument("--overlap", type=int, default=100, help="相邻块重叠字符数（默认100）")
    args = parser.parse_args()
    
    input_path = Path(args.input)
    if not input_path.exists():
        print(f"文件不存在: {input_path}", file=sys.stderr)
        sys.exit(1)
    
    with open(input_path, "r", encoding="utf-8") as f:
        text = f.read()
    
    chunks = chunk_text(text, args.chunk_size, args.overlap)
    
    output_path = args.output or str(input_path.parent / (input_path.stem.replace("_full", "") + "_chunks.json"))
    
    output_data = {
        "source_file": str(input_path),
        "total_chunks": len(chunks),
        "total_chars": sum(c["char_count"] for c in chunks),
        "chunk_size_target": args.chunk_size,
        "overlap": args.overlap,
        "chunks": chunks
    }
    
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    print(json.dumps({
        "status": "ok",
        "chunks_file": output_path,
        "total_chunks": len(chunks),
        "avg_chunk_size": int(sum(c["char_count"] for c in chunks) / len(chunks)) if chunks else 0
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
