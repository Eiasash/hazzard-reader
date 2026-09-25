# Study-page review brief (25 Sep 2026) — one chapter per agent

Chapters 46, 47, 58, 60, 61, 99 have lane-cleared chapter text (checked word-level earlier — DO NOT edit the chapter .md),
but their study pages (`chapters/hazzard8e_chNN_study.md`) were fast-built on 22 Sep and only number-checked by
`tools/verify_study_pages.py`. The same kind of review on 26 other chapters found reversed answers (e.g. "MELD fails above 35"
when the book says "predicts only above 35"), "or" vs "and" in diagnostic criteria, wrong answer keys, overstatements
("never", "always", "preferred", "first-line" the book doesn't say), claims not in the book, merged separate findings, and
wrong page citations. Eias uses these pages to study for a board exam whose questions are clinical vignettes with page-exact
sources — a wrong study bullet is worse than none.

## Sources
- Chapter text (trusted): `chapters/hazzard8e_chNN_*.md` (not `_study`).
- Book pages: `/mnt/user-data/uploads/hazzard_review/chNN_p<first>-<last>.pdf` (index 0 = first printed page). pymupdf installed.
  Render to look: `page.get_pixmap(dpi=110).save(...)` into `/tmp/claude-0/sr/chNN/`, then Read the PNG. Use the page image for
  anything that lives only in a table/figure crop, and to settle doubts. Highlighting is the owner's, ignore it.

## Do
1. Read EVERY summary bullet, exam-trap line and all 15 drill questions + answers. For each claim find the supporting sentence
   (chapter .md or page image) and confirm: direction, numbers, qualifiers (may/most/some/in one study), population, the cited page.
2. If the study page includes "2026 exam questions" copied from the chapter .md, check they match the .md exactly (don't change the key
   unless the .md's own key differs).
3. Fix minimally in place: keep format (bold numbers with (pNNN), `<details>` answers), don't restyle, don't add new topics.
   If a drill question is unanswerable from the book, rewrite it to something the book does answer on the same point.
4. Run `python3 tools/verify_study_pages.py` and explain every miss for your chapter (image-only or spelled-out numbers are known false positives — confirm them on the image).
5. Touch ONLY `chapters/hazzard8e_chNN_study.md`. No git commits.

## Report (≤20 lines)
Counts: bullets checked / fixed, drill items checked / fixed. List every clinically meaningful fix as before → after (short).
List citation-only fixes as a count. Anything you couldn't verify, and why. A workaround is not a fix — say so plainly.
