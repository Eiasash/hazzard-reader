# Wide external audit — hazzard-reader (READ-ONLY, one shard)

You are an independent auditor. DO NOT edit, create, move or delete any file in this repo; do not run git commands that change anything. Your final message is your report.

## Context
Phone study site for a geriatrician preparing for the Israeli geriatrics board: Hazzard's Geriatric Medicine 8e chapters (`chapters/hazzard8e_chNN_*.md`), a study page per chapter (`chapters/hazzard8e_chNN_study.md`: summary bullets with (pNNN) cites + drill with `<details>` answers), an Israeli law block (`chapters/israel_law*.md`, Hebrew). Chapters 47, 58, 60, 61, 99 are displayed from `<template>` blocks in `index.html` (check THAT text for those). A previous audit already fixed: ch55 CIMT, ch58 Q4, ch60 71%, law §16/17 suffering, §32ו customary gifts, §32יז(ב), 0.2.1 §7(6)-(7), 3.4.2 scope. Don't re-report those.

## Sources (ground truth)
- Book pages: `C:\Users\eiasa\Downloads\hazzard_review\chNN_p<first>-<last>.pdf` (index 0 = first printed page). `import pymupdf` works. The text layer is phone-scan OCR — for any disputed word/number RENDER the page (`page.get_pixmap(dpi=150).save(...)` to a temp folder OUTSIDE the repo, e.g. %TEMP%) and look at the image.
- Law sources: `C:\Users\eiasa\Downloads\hazzard_review\law\`.

## Scope — go deep, this is the WIDE pass. For every chapter in your shard:
1. **Study page, every line**: every bullet, exam-trap line, drill question AND answer key vs the book: numbers, direction, qualifiers (may/some/up to/in one study), population, overstatement, wrong page cite, answer key that doesn't follow from the book, question with two defensible answers.
2. **Chapter text, word level**: diff the chapter prose against the PDF text layer page by page; confirm on the page image. Look for dropped/duplicated sentences, stitched or paraphrased text, wrong numbers/units/drug names, sentences cut off, text on the wrong page, Key Clinical Points incomplete.
3. **Text tables**: every markdown table / list-table cell vs the page image (rows, columns, footnotes, dose↔drug pairing).
4. **Images**: for every `![..](file.png)` open the PNG in `chapters/` AND the rendered source page; report anything missing (row, column, panel, footnote, caption), wrong figure, unreadable.
5. **Clinical sanity**: anything on the study page that is dangerous if believed (dose, contraindication, threshold) even if the book is ambiguous — flag as "clinical-risk".

## Report
One line per finding: `chNN | file:line | CLAIM (quote) | SOURCE SAYS (quote + printed page) | type: study/text/table/image/clinical-risk | severity: exam-relevant/minor`. Only verified findings (say "unverified" otherwise). End with, per chapter: what you checked and what you skipped. Zero findings is acceptable — honesty over volume.
