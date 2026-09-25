#!/usr/bin/env python3
"""Lane-review coverage diff: book text layer vs chapter .md, both directions.

usage: lane_diff.py CH   (e.g. 42)
Reports, per printed page:
  MISSING  = book sentences (>=6 words) with <60% of their 4-word shingles found anywhere in the .md
  EXTRA    = .md sentences (>=6 words) with <60% of their shingles found anywhere in the book chapter
Table/figure text in the PDF will show as MISSING noise when the table is a crop image — judge each hit.
"""
import sys, re, glob, unicodedata
import pymupdf

ch = sys.argv[1]
pdf = glob.glob(f"/mnt/user-data/uploads/hazzard_review/ch{ch}_p*.pdf")[0]
first = int(re.search(r"_p(\d+)-", pdf).group(1))
md_path = glob.glob(f"/home/claude/hazzard-reader/chapters/hazzard8e_ch{ch}_*.md")
md_path = [p for p in md_path if not p.endswith("_study.md")][0]

def norm(s):
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", s)          # de-hyphenate line breaks
    s = s.lower()
    s = re.sub(r"[^a-z0-9%.<>=≥≤]+", " ", s)
    return s

def words(s):
    return [w.strip(".") for w in norm(s).split() if w.strip(".")]

def shingles(ws, k=4):
    return {" ".join(ws[i:i+k]) for i in range(max(0, len(ws)-k+1))}

def sentences(txt):
    txt = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", txt)
    txt = re.sub(r"\s+", " ", txt)
    return [s.strip() for s in re.split(r"(?<=[.;:?!])\s+(?=[A-Z(])", txt) if s.strip()]

doc = pymupdf.open(pdf)
pages = [(first + i, doc[i].get_text()) for i in range(len(doc))]
book_all = shingles(words(" ".join(t for _, t in pages)))

md = open(md_path, encoding="utf-8").read()
md_clean = re.sub(r"</?[A-Za-z][^>\n]*>", " ", md)
md_clean = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", md_clean)
md_clean = re.sub(r"[*_#>|`]", " ", md_clean)
md_sh = shingles(words(md_clean))

def cov(s, pool):
    sh = shingles(words(s))
    return (len(sh & pool) / len(sh)) if sh else 1.0

print(f"=== ch{ch}  {pdf.split('/')[-1]}  vs  {md_path.split('/')[-1]}")
print("\n##### MISSING FROM .md (book sentence not found) #####")
for p, t in pages:
    hits = [s for s in sentences(t) if len(words(s)) >= 6 and cov(s, md_sh) < 0.6]
    if hits:
        print(f"\n--- p{p}")
        for s in hits:
            print(f"  [{cov(s, md_sh):.2f}] {s[:400]}")

print("\n##### EXTRA IN .md (not in book text layer — check for stitched/garbled/hallucinated) #####")
cur = "?"
for line in md.splitlines():
    m = re.search(r'id="p(\d+)"', line)
    if m:
        cur = m.group(1)
    if line.startswith("![") or line.startswith("*Highlighting") or line.startswith("> **"):
        continue
    body = re.sub(r"</?[A-Za-z][^>\n]*>|[*_#|`>]", " ", line)
    for s in sentences(body):
        if len(words(s)) >= 6 and cov(s, book_all) < 0.6:
            print(f"  p{cur} [{cov(s, book_all):.2f}] {s[:400]}")

# ---- FINE mode: small in-sentence substitutions (wrong word/number) per page segment ----
import difflib
print("\n##### SUBSTITUTIONS (.md vs book, per page; short replace ops only) #####")
segs = re.split(r'<a id="p(\d+)"></a>', md)
md_pages = {}
for i in range(1, len(segs), 2):
    md_pages.setdefault(int(segs[i]), "")
    md_pages[int(segs[i])] += segs[i+1]
book_pages = {p: t for p, t in pages}
for p, mtxt in sorted(md_pages.items()):
    mtxt = re.sub(r"!\[[^\]]*\]\([^)]*\)|</?[A-Za-z][^>\n]*>|\[p\. \d+\]", " ", mtxt)
    mtxt = re.sub(r"[*_#>|`]", " ", mtxt)
    mw = words(mtxt)
    bw = words(" ".join(book_pages.get(q, "") for q in (p-1, p, p+1)))
    sm = difflib.SequenceMatcher(None, bw, mw, autojunk=False)
    out = []
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "replace" and (i2-i1) <= 3 and (j2-j1) <= 3:
            b, m_ = " ".join(bw[i1:i2]), " ".join(mw[j1:j2])
            if b.replace(" ", "") == m_.replace(" ", ""):
                continue
            ctx = " ".join(mw[max(0, j1-6):j2+6])
            out.append(f"  book='{b}' md='{m_}'  …{ctx}…")
    if out:
        print(f"\n--- p{p}")
        print("\n".join(out))
