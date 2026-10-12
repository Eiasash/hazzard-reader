# hazzard-reader — working notes for Claude

Eias's phone study site for Hazzard 8e (Stage A board exam). The book is canonical; the site is for access and digestion. Build and fix workflow: the `hazzard-chapter-build` skill. Full history of how it got here: `HISTORY.md`.

## Current state
- All 108 Hazzard 8e chapters have Read + Study pages; Study opens on the chapter summary. Ch 2–6, 34 and 62 carry the P005-exclusion note. Israeli law block (`law` / `laws`) and required-article cards sit beside the chapters.
- MCQ bank: `data/mcq/all.json` holds 2,897 questions — 800 official past-paper (Subspecialty track only) and 2,097 practice, of which 58 practice are retired and never served. The app loads a small catalogue plus 256 chunks generated from all.json by `python tools/generate_question_data.py` (also run by `tools/generate_asset_list.py`). Exam simulation is official-only.
- Explanations render per-option lines in on-screen order, each in a framed block with a green tick (key or accepted option) or red cross; prose without per-option lines gets no marks.
- Per-question audit history: `C:\Users\eiasa\tmp\audit\question_registry.json` (+ .csv), rebuilt by `build_registry.py` in that folder after each release. Any job on questions starts from it.
- Release log: `data/changelog.json`. Release reports: `C:\Users\eiasa\Documents\Codex\<date>\<job>\report.md`. Release notes for v32 to v137 and the build history: `HISTORY.md`.
- Workflow: the `hazzard-chapter-build` skill. Codex builds from prompts signed by the project's release lane (lane protocol: project doc `claude/LANE_PROTOCOL.md` in the claude.ai project).
- Next-fix list (small content fixes waiting for a release): `C:\Users\eiasa\tmp\next_fix_list.txt`.

## Storage (never rename, never drop)
- localStorage keys in use: `stage-a-highlights-v1:<ch>`, `stage-a-display-v4`, `hazzard-place-v1`, `hazzard-bookmarks-v1`, `hazzard-reading-progress-v1`, `hazzard-chapters-sort-v1`, `hazzard-missed-v1`, `hazzard-drills-v1`, `hazzard-mock-v1`, `hazzard-timer-v1`, `hazzard-timer-v2`, `hazzard-mcq-v1`, `hazzard-mcq-log-v1`, `hazzard-mcq-review-v1`, `hazzard-mcq-saved-v1`, `hazzard-mcq-bad-v1`, `hazzard-mcq-flags-v1`, `hazzard-mcq-papers-v1`, `hazzard-mcq-view-v1`, `hazzard-mcq-israeli-system-v1`, `hazzard-mcq-id-aliases-v53`, `hazzard-exam-simulation-v1`, `hazzard-practice-place-v1`, `hazzard-practice-settings-v1`, `hazzard-generated-flags-v1`, `hazzard-removals-v1`, `hazzard-whats-new-seen-v1`, `hazzard-last-backup-v1`, `hazzard-cloud-session-v1`, `hazzard-cloud-state-v1`, `hazzard-debug-log-v1`.
- IndexedDB `hazzard-reader-snapshots-v1` keeps five checksummed reader snapshots (`js/reader-storage.js`); startup restores missing or corrupt values from the newest valid one. Retired question IDs resolve through history-backed aliases at read time. Cloud sync uses the existing Supabase RPCs with the notebook export format.

## Rules
- Fast mode: build, check once, deploy. No new guards, sweeps or review rounds unless Eias asks; state time cost before proposing extras.
- Chapters **47, 58, 60, 61, 99** render from `<template>` blocks in `index.html`, not their `.md` — edit both.
- Chapter text: never add, remove or split a sentence in a served chapter or study page. Mark-unit ids are kept only for registry-matched text and are otherwise a running count, so one sentence more or less shifts every later saved highlight (ch99 has no registry coverage). A period inside a sentence (e.g. “pp.”) also splits a unit. Reword in place, sentence for sentence, and compare the full unit maps before merging (tx1/tx2 reproduce.py).
- Book text stays even when wrong (the exam is drawn from it):
  - misprint the book itself contradicts → `*[sic — the book's own Table/Figure X, pNNN, gives …]*`
  - faithful but outdated → one `> Current practice (not the book): … — source, year.` line, only from a fetched source (indent 2 spaces under a `- ` bullet).
- Study pages: keep the book's qualifiers (up to / may / in one study / estimated / in the US) and conditions; answers inside one-line `<details>` need `<strong>`, not `**`.
- Crops: tight, upright, table/figure + caption + footnotes only; verify full-size against the page (thumbnails miss truncation).  No "highlighting is the owner's annotation" note (Eias's request — he knows).
- After release edits, run `python tools/generate_asset_list.py` to refresh `asset-list.json` (all files, SHA-256 fingerprints and byte sizes); commit the list with the release. The static site still has no framework or build step.
- Every deploy bumps `CACHE_VERSION` in `sw.js`; the SW must only delete `hazzard-*` caches (origin shared with Stage A, Geriatrics, InternalMedicine, FamilyMedicine, ward-helper, Toranot — all do the same).
- Verify on the live URL at 360×644 in light and dark before calling anything done; report in ≤3 lines, including what wasn't tested.

## Source
- `C:\Users\eiasa\Downloads\hazzard marked .pdf` (1,824 pp; PDF page = printed + 34). Phone scan: highlighting baked into the image; OCR layer can be misaligned on rotated pages — crop from pixels. Per-chapter extracts: `Downloads\hazzard_review\chNN_p<first>-<last>.pdf`. Law sources: `Downloads\hazzard_review\law\`.
- Repo clone: C:\Users\eiasa\repos\hazzard-reader; releases are Codex PRs from that clone.

## Tools
- `tools/lane_diff.py NN` — two-way text diff vs the book (MISSING / EXTRA / SUBSTITUTIONS).
- `tools/verify_study_pages.py` — bolded numbers vs cited page. 52 current misses, all known false positives (image-only or spelled-out numbers; a note sitting between a number and its page cite).

## Cosmetic list (doesn't block anything)
- ch75 Table 75-6 ghost title bar baked into the scan; ch59 Table 59-7 p912 keeps its bottom band (it holds rows p913 lacks).
- Odd heading casing here and there.
- In openings written "התשובה היא **X**", the bold answer renders in a visibly different, narrower font from the bold text around it in the Windows Chromium screenshots of the v240 records (P005-excluded). A served v239 rewrite with the same opening (mcq-bcbf4a8f530b0030835c92fc) rendered in Linux Chromium shows no difference (both in system-ui, weight 900); not yet checked on the Android phone.
- In an explanation's Hebrew "מקור:" line that lists two English sources joined by " · ", the English pieces can reorder (in the P005-excluded mcq-fb203b324e8a2bd294d852d4 at 360 px, "DISEASE" renders after the Harrison part). Served lines with the same shape: mcq-7b70f07311595f68ed7aa9ea, mcq-06a15a9053f355094b929a71.

## Reader behavior
- Page markers render as a small inline `pNNN` tag; a paragraph the page break cut mid-sentence is joined at display time (source .md untouched).
- Highlighting: header on → tap sentences → same header off (or Done above the tabs). No selection popup. Existing `ranges` in `stage-a-highlights-v1:<ch>` still restore and can be removed. Old unit highlights re-attach by text; highlights resync on pageshow/visibility/storage.
- Notebook: this chapter + all saved places grouped by chapter, newest first + other chapters' highlights (deep links `#hl-<id>`, `#bm-<time>`).
- Place: auto-saved per chapter (`hazzard-place-v1`), restored on open; root URL resumes the last reader/study page. Bookmark/Remove bookmark lives in the Highlight bar (`hazzard-bookmarks-v1`); Notebook lists saved places.
- Images/SVG figures: tap → full-screen zoom (pinch, double-tap, drag). Top/end pills at the physical right edge, outside line endings; images load lazily with intrinsic dimensions.
- Practice: Question bank (every served question, shuffled by default; filters fold behind one summary row), Statistics, mock builder 25/50/100 (`hazzard-mcq-papers-v1`), exam simulation (official questions only, `hazzard-exam-simulation-v1`), Study timer (`hazzard-timer-v2`). The old self-graded chapter drills stay under Study notes (`hazzard-drills-v1`); `hazzard-mock-v1` is legacy, kept readable.

- Text and Home report **Offline ready** only after the controlling worker confirms every precache asset for the displayed release. Install rejects any exhausted download/discovery retry; activate cleanup remains limited to `hazzard-*` caches.
- Small/Medium/Large keep their stored names; one `--fs` scale (1 / 1.125 / 1.25) drives reader and UI text. Home, Find, previous arrow, ellipsized chapter title, next arrow, Chapter/Study and Highlight share the header; previous/next also remain at chapter ends. Arrows are hidden at the first/last chapter. Contents has no duplicate chapter arrows. Contents also offers 2026 exam pages when flagged markers exist. Phone Back unwinds sheets, nested practice tools and Home/library views one layer at a time.

## Site behavior (not a bug)
- A completed update waits for the blue Text-tab chip tap (Update), which saves answers and progress, flushes the snapshots, then reloads; the reader's place is kept.
