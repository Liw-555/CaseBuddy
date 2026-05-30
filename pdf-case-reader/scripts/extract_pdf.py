#!/usr/bin/env python3
"""
PDF 文本提取脚本（MBA案例专用）
支持 pdfplumber（主）+ pymupdf（回退）+ markitdown（最终回退）
"""
import argparse
import json
import os
import sys
from pathlib import Path


def extract_with_pdfplumber(pdf_path: str) -> dict:
    """使用 pdfplumber 提取（结构保持最好）"""
    import pdfplumber
    
    pages = []
    full_text = ""
    
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages):
            text = page.extract_text() or ""
            tables = page.extract_tables() or []
            pages.append({
                "page": i + 1,
                "text": text,
                "tables": tables,
                "char_count": len(text)
            })
            full_text += f"\n\n--- 第{i+1}页 ---\n{text}"
    
    return {"full_text": full_text.strip(), "pages": pages, "method": "pdfplumber"}


def extract_with_pymupdf(pdf_path: str) -> dict:
    """使用 pymupdf 提取（速度快）"""
    import fitz
    
    doc = fitz.open(pdf_path)
    pages = []
    full_text = ""
    
    for i, page in enumerate(doc):
        text = page.get_text()
        pages.append({
            "page": i + 1,
            "text": text,
            "tables": [],
            "char_count": len(text)
        })
        full_text += f"\n\n--- 第{i+1}页 ---\n{text}"
    
    doc.close()
    return {"full_text": full_text.strip(), "pages": pages, "method": "pymupdf"}


def extract_with_markitdown(pdf_path: str) -> dict:
    """使用 markitdown 提取（最终回退）"""
    from markitdown import MarkItDown
    
    md = MarkItDown()
    result = md.convert(pdf_path)
    text = result.text_content
    
    # 简单按分页线分割
    pages = [{"page": 1, "text": text, "tables": [], "char_count": len(text)}]
    return {"full_text": text, "pages": pages, "method": "markitdown"}


def extract_tables_only(pdf_path: str) -> list:
    """仅提取表格数据"""
    try:
        import pdfplumber
        all_tables = []
        with pdfplumber.open(pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                if tables:
                    for t in tables:
                        all_tables.append({
                            "page": i + 1,
                            "data": t,
                            "rows": len(t),
                            "cols": len(t[0]) if t else 0
                        })
        return all_tables
    except Exception as e:
        print(f"表格提取失败: {e}", file=sys.stderr)
        return []


def extract_pdf(pdf_path: str, output_dir: str, mode: str = "full"):
    """主提取函数"""
    pdf_path = str(Path(pdf_path).resolve())
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    
    stem = Path(pdf_path).stem
    
    if mode == "tables":
        tables = extract_tables_only(pdf_path)
        out_file = output_dir / f"{stem}_tables.json"
        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(tables, f, ensure_ascii=False, indent=2)
        print(f"[tables] 提取到 {len(tables)} 个表格 → {out_file}")
        return
    
    # 按优先级尝试提取
    result = None
    errors = []
    
    for extractor in [extract_with_pdfplumber, extract_with_pymupdf, extract_with_markitdown]:
        try:
            result = extractor(pdf_path)
            print(f"[{result['method']}] 提取成功，共 {len(result['full_text'])} 字符", file=sys.stderr)
            break
        except ImportError as e:
            errors.append(f"{extractor.__name__}: {e}")
        except Exception as e:
            errors.append(f"{extractor.__name__}: {e}")
    
    if result is None:
        print(f"所有提取方法失败:\n" + "\n".join(errors), file=sys.stderr)
        sys.exit(1)
    
    if mode == "full":
        # 输出全文文本
        txt_file = output_dir / f"{stem}_full.txt"
        with open(txt_file, "w", encoding="utf-8") as f:
            f.write(result["full_text"])
        
        # 输出元数据JSON
        meta_file = output_dir / f"{stem}_meta.json"
        meta = {
            "filename": Path(pdf_path).name,
            "method": result["method"],
            "total_chars": len(result["full_text"]),
            "total_pages": len(result["pages"]),
            "pages_summary": [
                {"page": p["page"], "char_count": p["char_count"]}
                for p in result["pages"]
            ]
        }
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)
        
        print(json.dumps({
            "status": "ok",
            "text_file": str(txt_file),
            "meta_file": str(meta_file),
            "total_chars": len(result["full_text"]),
            "total_pages": len(result["pages"]),
            "method": result["method"]
        }, ensure_ascii=False))
    
    elif mode == "structured":
        # 输出每页的结构化JSON
        pages_file = output_dir / f"{stem}_pages.json"
        with open(pages_file, "w", encoding="utf-8") as f:
            json.dump(result["pages"], f, ensure_ascii=False, indent=2)
        print(json.dumps({
            "status": "ok",
            "pages_file": str(pages_file),
            "total_pages": len(result["pages"])
        }, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MBA案例PDF文本提取")
    parser.add_argument("--input", required=True, help="PDF文件路径")
    parser.add_argument("--output", required=True, help="输出目录")
    parser.add_argument("--mode", default="full", choices=["full", "structured", "tables"],
                        help="提取模式：full(全文)/structured(分页)/tables(仅表格)")
    args = parser.parse_args()
    
    extract_pdf(args.input, args.output, args.mode)
