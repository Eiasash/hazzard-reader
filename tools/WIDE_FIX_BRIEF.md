# Wide Codex audit — verify and fix (25 Sep 2026)

Codex (gpt-6-astra, high effort) audited the site. Its findings for your chapters are in
`/mnt/user-data/uploads/hazzard_review/wide/audit_<SHARD>.md`. **Do not trust Codex.** Verify each finding yourself.

Repo: /home/claude/hazzard-reader (chapters/*.md). Book extracts: /mnt/user-data/uploads/hazzard_review/chNN_p<first>-<last>.pdf
(page index 0 = the first printed page in the filename). Render the page with pymupdf at ~2x and **look at the image** when wording/units are disputed
(the text layer is OCR). Law sources: /mnt/user-data/uploads/hazzard_review/law/.

For each finding decide one verdict and act:
- **real — study-page/text error** (a qualifier, population, condition, page cite or scope that the book has and our page dropped or distorted):
  fix the study page (summary AND any drill repeating it) to match the book. Keep it short; keep the book's qualifier words.
- **real — book misprint provable from the book itself** (e.g. units contradicted by the book's own table/figure on another page):
  keep the printed text, add right after it: `*[sic — the book's own Table/Figure X, pNNN, gives <correct form>]*`. Look for the book's own evidence first.
  If the book has no internal evidence, treat it as the next class.
- **real — book faithful but outdated/unsafe vs current guidance**: keep the book statement (the exam is drawn from the book). Fetch Codex's cited
  source with WebFetch. If the fetch confirms it, add ONE line after the bullet/answer:
  `> Current practice (not the book): <what the source says, briefly> — <source, year>.`
  If you can't fetch/confirm it, add nothing and mark the verdict "unconfirmed-currency". Never write a threshold/dose from memory.
- **rejected**: Codex misread the book, or the page already says it correctly. Say why in one clause.

Rules: never edit index.html (except shard B: only inside the ch58 template, matching the .md), sw.js or manifest.json. No git commits.
Other agents edit other chapters concurrently. Don't re-format anything you weren't asked to touch.

Report: a JSON array written to `/tmp/claude-0/widefix/<SHARD>.json`, one object per finding in Codex order:
`{"id": "<SHARD><n>", "chapter": "ch44", "summary": "<≤15 words>", "verdict": "real-study|real-sic|real-currency|unconfirmed-currency|rejected", "action": "<≤20 words>"}`
Then reply with ≤6 lines: counts per verdict and anything odd.
