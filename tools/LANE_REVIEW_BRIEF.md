# Lane review brief (25 Sep 2026) — one chapter per agent

You are lane-reviewing ONE fast-built chapter of Hazzard's Geriatric Medicine 8e on Eias's phone study site.
Eias is a geriatrician; the site is his exam-study copy. Goal: after you finish, the chapter's `.md` says what
the book says (no dropped, garbled, reordered, paraphrased or invented text) and its study page makes no claim the book doesn't.

## Files (repo: /home/claude/hazzard-reader — edit in place, DO NOT git commit/push; ONLY touch your chapter's files)
- Chapter: `chapters/hazzard8e_chNN_*.md` (not `_study.md`)
- Study page: `chapters/hazzard8e_chNN_study.md`
- Book pages: `/mnt/user-data/uploads/hazzard_review/chNN_p<first>-<last>.pdf` (page index 0 = first printed page).
  Text layer via `pymupdf` (installed). Render a page to look at it: `page.get_pixmap(dpi=110).save(path)` into
  `/tmp/claude-0/lr/chNN/` then Read the PNG. The text layer is OCR of a phone scan — when text layer and .md disagree
  on a single word/number, LOOK AT THE PAGE IMAGE before deciding which is right. Highlighting is Eias's, ignore it.
- Coverage tool: `python3 tools/lane_diff.py NN` — three sections:
  MISSING (book sentence absent from .md), EXTRA (.md sentence absent from book), SUBSTITUTIONS (short word swaps).
  Expected noise: table/figure text that the .md shows as a cropped image, references list, running heads, page numbers.
  Everything else is a candidate defect. Re-run after fixing; aim for only explained noise left.

## Defect classes to fix in the chapter .md
1. Dropped prose (whole or partial paragraphs, decapitated paragraph starts after tables/figures, truncated list items —
   e.g. Key Clinical Points cut off mid-word like "Frailty occurs when mechanisms of resil-").
2. Table/figure text interleaved INTO prose (column-merge garble: prose sentences with table cell words stitched in).
   Restore clean prose; the table itself stays as its crop image (or a clean md table if that's how it's shown).
3. Substitutions/paraphrases: any word or number that differs from the book (verify on the page image). Fix to the book's words.
4. Reordering: column-order scrambles, figure placed mid-sentence, clauses out of place.
5. Spurious headings (a sentence fragment turned into a heading), running heads ("CHAPTER NN ...", "PART III ...") left in prose,
   stray page numbers, "(Continued)", figure-pixel OCR junk.
6. Obvious hyphen-join defects ("mul-tiple", "frailtyrelated") — fix when you touch the line anyway.
Keep: `<a id="pNNN"></a>**[p. NNN]**` anchors (consecutive, placed where that printed page starts), existing images and the
highlight note line under each, heading structure. Do NOT re-crop images unless one is visibly wrong content (then say so, don't fix).
Do NOT transcribe the references list if the .md omits it.

## Study page check
Read every bullet and every drill question/answer against the (now-fixed) chapter text or page image. Fix:
wrong numbers, wrong page citations, overstatements, claims not in the book, answer keys that don't match the book.
Keep the format (bold numbers with (pNNN), <details> answers). Don't rewrite style; minimal edits. Run
`python3 tools/verify_study_pages.py` if it accepts a chapter arg (check its usage) — digit-vs-spelled-number misses are known false positives.

## Finish
- Replace the top flag line `> **Fast build from the book, 22 Sep; not lane-reviewed.**` with
  `> **Lane-reviewed against the book, 25 Sep 2026.**` ONLY if you actually went through every MISSING/EXTRA/SUBSTITUTION hit
  and every study bullet. If you couldn't finish something, leave the flag and say why.
- Return a report (≤25 lines): counts per defect class fixed, the 3–5 most clinically important fixes (quote before→after briefly),
  study-page fixes, anything left unresolved and why. Be honest: a workaround is not a fix.
