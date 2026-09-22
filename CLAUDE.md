# hazzard-reader

## Purpose
Eias's phone study site for Hazzard's Geriatric Medicine, 8e. The book is canonical; this site is for access and digestion, not a certified transcription.

## State (23 Sep 2026)
- 32 chapters live. Lane-reviewed: 46, 47, 58, 60, 61, 99. Fast builds: 42, 43, 44, 55, 59, 63, 87, 45, 51, 52, 57, 68, 81, 97, 98, 101, 102, 104, 105, 108, 65, 75, 76, 77, 83, 88.
- A study page (summary + 15-question drill) for each of the 32 chapters, plus a Hebrew Israel-law block (`?chapter=law` / `?chapter=laws`) — primary-source Israeli law and Brookdale 65+ data (2025 edition), not from Hazzard. Law block eyebrow reads "PRIMARY LAW", not HAZZARD.
- Cache v14, commit `2f5bd15`.
- **Known lag:** a build-agent's "done" signal (study.md appearing) can fire before it's actually finished. In the 23 Sep overnight batch this wasn't cosmetic — ch77 shipped live (v10 through v13) with 9 tables flattened into garbled text before the actual fix landed, ~40 min after the agent's own Workflow completion notification would have said so. **The Workflow tool's own completion notification is the real done-signal, not file existence** — if a script's return value hasn't arrived yet, the chapter isn't done, no matter what's on disk. After any parallel-subagent chapter build, also wait for `git status` to hold stable for ~40s before the final commit.

## Known defects in the shared build tooling (found 23 Sep, by 5 of 6 overnight subagents independently)
- **`build_chapter.py`: `format_tables()` runs before `handle_garbled_tables()`.** `reformat_table_body()`'s whitespace-collapse squashes a multi-row pipe table into one broken line *before* the garbled-table detector ever sees row breaks to trigger on, and a ~500-char cap then truncates mid-table, eating up to ~900 chars of adjacent prose and sometimes a `<a id="pNNN">` anchor. Hit in ch75, ch76, ch77, ch83, ch88 (not ch65) — all hand-fixed with pixel crops. **Any fast-built chapter should be grepped for non-consecutive `<a id="pNNN">` sequences** as a cheap detector for prose loss; the tool itself is not yet patched (shared file, was mid-flight across 6 concurrent agents when found).
- **`find_table_region()`/`find_figure_region()`** sometimes anchor on the wrong text match (an inline body reference to "(Table N-N)" instead of the real caption) or truncate a column-bound table/figure against an unrelated block in the other column, producing severe under-crops with no error. Also: `FIGURE_CAP_RE` requires `\d+-\d+.` and misses lettered sub-panels (77-1A, 77-4B, ...) — those need fully manual cropping. **Visually open every figure/table crop; a clean orphan-crop check only proves references resolve, not that the crop shows the right content.**
- **`tools/verify_study_pages.py` only checks the LAST bolded number before a line's own `(pNNN)` citation.** An earlier bolded number sharing that same trailing citation (e.g. `**11.5%**... but **47%** in adults (p1278)`) is silently skipped — not checked, not reported as a miss. Proven with an injected-defect fixture (swapping a real number for a wrong one didn't change the checked/miss counts). **A "0 misses" run from this tool is not full coverage.** Not yet fixed. This may also affect the trustworthiness of "clean" number-checks reported for earlier chapters (42–108) if they were verified with this same tool — not re-audited.

## Source
`C:\Users\eiasa\Downloads\hazzard marked .pdf`, 1,824 pages. PDF page = printed page + 34.

It's a phone scan (ClearScan): most of Eias's highlighting is baked into the page image (`annots=False` does not remove it), and the OCR text layer can be misaligned from the rendered pixels on rotated pages — crop from the pixels there, not the OCR boxes.

Verified printed page ranges: 42 = 615–632, 43 = 633–642, 44 = 643–664, 55 = 817–834, 59 = 893–918, 63 = 981–996, 87 = 1353–1380. Others: find by heading geometry.

## Conventions
- Tight, upright crops: artwork/table/caption/footnotes only, no neighbouring columns or figures. A note under every cropped image: *"Highlighting is the owner's annotation, not the book's."*
- `<a id="pNNN">` printed-page markers inline in the prose.
- `manifest.json` drives the chapter list and library — no HTML/JS edit needed to add a chapter or study page.
- Bump `hazzard-shell-vN` / `hazzard-runtime-vN` in `sw.js` on every deploy that changes cached content.
- Check the live URL at 390×844 before calling anything done.

## Working rules
- Fast mode: build, check once, deploy. No guards, red tests, mutation suites, cross-chapter sweeps or review rounds unless Eias asks.
- Parallel subagents (one per chapter) for multi-chapter work; the main agent checks, wires the manifest, and deploys once.
- Check every cited number against the chapter's own source text before publishing.
- Verify on the live site — never claim something is done untested; say explicitly what wasn't checked.
- Reports: 3 lines or fewer.

## Cosmetic list (not urgent — don't fix unprompted)
- ch44: Figure 44-10 renders above Figure 44-9; the book has them the other order.
- ch44: two empty bullet points sit just below Figure 44-9.
- Odd heading casing or hyphen joins here and there in the fast-build chapters.
- Law page header reads "CHAPTER law / HAZZARD" — wrong, it's primary law, not Hazzard.
- Law page: the English note's full stop wraps to the start of its line — a bidi rendering artifact from English text inside an RTL block.

## Site behavior (not a bug, don't chase it)
- On first load after a deploy, the previous service worker can still be controlling the page and serves the old cached manifest (no new chapter entry), so the reader falls back to its default chapter. One reload picks up the new chapter. Confirmed 22 Sep on `?chapter=law` right after the v9 deploy — resolved on second navigation with no code change. This is the SW updating on its own normal cadence, not a fetch bug; don't "fix" it by reworking the SW's fetch handler unless Eias asks.

## Data currency — not tonight
- Brookdale figures in `israel_law.md` are from the **2023** edition (שנתון-2023.pdf). Exam questions cite the edition current at each sitting. If a 2024 or 2025 edition turns up in Downloads before the next sitting (targeting before June 2027), swap it in — ~20 min: re-extract pp. 131–135 and Table 5.10, update the edition year note, redeploy.

## How it works
- `index.html` is the whole app (shell/CSS/JS from the `stage-a-reader` design). The 6 lane-reviewed chapters are embedded as `<template>` blocks.
- `manifest.json` + `chapters/*.md` is the generic path: any `?chapter=NN` with no matching template is looked up in the manifest, fetched, and rendered client-side with `marked.js` (vendored, no CDN). All 7 fast-build chapters and all 13 study pages use this path.
- `sw.js` precaches the shell plus every manifest-listed chapter's `.md` and images on install, then caches network-first / offline-fallback for everything else.
- No build step, no framework.

Live: https://eiasash.github.io/hazzard-reader/
