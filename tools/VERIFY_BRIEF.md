# Second-reviewer brief (25 Sep 2026) — verify the review's own edits, one chapter per agent

Earlier today one agent per chapter reviewed chapter NN against the book and edited the chapter `.md` and its study page.
Nobody has checked THEIR edits. You are the independent second reviewer. Assume nothing they wrote is right.

## Sources
- Repo: /home/claude/hazzard-reader. Baseline before today's review: git commit `cab7aa9`.
  `git diff cab7aa9 HEAD -- chapters/hazzard8e_chNN_study.md` = every study-page edit.
  `git diff cab7aa9 HEAD -- chapters/hazzard8e_chNN_<name>.md` = every chapter-text edit.
- Book pages: `/mnt/user-data/uploads/hazzard_review/chNN_p<first>-<last>.pdf` (index 0 = first printed page). pymupdf installed.
  Render: `page.get_pixmap(dpi=150).save(...)` into `/tmp/claude-0/v/chNN/`, then Read the PNG. For small print, render a clip at 250 dpi.
  The text layer is phone-scan OCR — settle any doubt on the page image. Highlighting is the owner's, ignore it.
- NOTE: chapters 47, 58, 60, 61, 99 render on the live site from `<template id="chapterNNTemplate">` blocks in `index.html`,
  not their .md. If you fix chapter text for those, fix it in BOTH places.

## Check
1. **Every study-page diff hunk** (both the removed and the added line): is the NEW wording supported by the book — direction, numbers,
   qualifiers (may/some/in one study), population, cited page? Was the OLD wording actually wrong, or did the reviewer over-correct
   a correct bullet? Also check drill answers changed in the diff.
2. **Every table transcribed as text in the chapter .md** (markdown tables and table-as-list blocks, incl. ones rebuilt today): compare
   cell by cell to the page image — missing rows, shifted cells, wrong numbers, dropped footnotes.
3. **Every cropped image** (`![...](...png)` in the chapter .md): open the crop at full size AND the page region it came from. Anything
   cut at any edge (last row, last column, footnotes, caption, a panel)? Wrong figure/table? Report; fix only if clearly broken
   (re-crop from the page render with pymupdf `clip=`, 200+ dpi, upright, tight; keep the same filename).
4. Chapter-text diff hunks: spot-check 10 of them against the page (restorations should be verbatim book text).

## Fix
Minimal, in place. Keep formats. Do not restyle or re-review things outside the four checks. No git commits.
Run `python3 tools/verify_study_pages.py` at the end and confirm no new misses for your chapter.

## Report (≤15 lines)
Counts per check (checked / problems / fixed). Every real problem as before → after. Anything left unfixed and why.
Be blunt: if the first reviewer's edit was right, say "confirmed"; don't invent problems.
