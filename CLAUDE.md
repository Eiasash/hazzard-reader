# hazzard-reader — working notes for Claude

Eias's phone study site for Hazzard 8e (Stage A board exam). The book is canonical; the site is for access and digestion. Build and fix workflow: the `hazzard-chapter-build` skill. Full history of how it got here: `HISTORY.md`.

## State (25 Sep 2026)
- Live at cache **v29**. 32 chapters + study pages + Israeli law block (`law` / `laws`). All reviewed against the book; flag line on each: "Lane-reviewed against the book, 25 Sep 2026."
- Outside audits done 25 Sep: Codex sweep 1 (10 fixed), Codex wide 6-shard sweep (79 findings, 77 fixed, 2 rejected), Gemini (0, unreliable). Every finding is in the Reviewer Scorecard artifact (claude.ai/artifact/UHxA3ikkukJEZ5ZCgPgnRy). Briefs: `tools/*_BRIEF.md`.
- Pending: Eias's own airplane-mode offline test on the phone.

## Rules
- Fast mode: build, check once, deploy. No new guards, sweeps or review rounds unless Eias asks; state time cost before proposing extras.
- Chapters **47, 58, 60, 61, 99** render from `<template>` blocks in `index.html`, not their `.md` — edit both.
- Book text stays even when wrong (the exam is drawn from it):
  - misprint the book itself contradicts → `*[sic — the book's own Table/Figure X, pNNN, gives …]*`
  - faithful but outdated → one `> Current practice (not the book): … — source, year.` line, only from a fetched source (indent 2 spaces under a `- ` bullet).
- Study pages: keep the book's qualifiers (up to / may / in one study / estimated / in the US) and conditions; answers inside one-line `<details>` need `<strong>`, not `**`.
- Crops: tight, upright, table/figure + caption + footnotes only; verify full-size against the page (thumbnails miss truncation). Note under each: *"Highlighting is the owner's annotation, not the book's."*
- Every deploy bumps `CACHE_VERSION` in `sw.js`; the SW must only delete `hazzard-*` caches (origin shared with Stage A, Geriatrics, InternalMedicine, FamilyMedicine, ward-helper, Toranot — all fixed 25 Sep to do the same).
- Verify on the live URL at 390×844 before calling anything done; report in ≤3 lines, including what wasn't tested.

## Source
- `C:\Users\eiasa\Downloads\hazzard marked .pdf` (1,824 pp; PDF page = printed + 34). Phone scan: highlighting baked into the image; OCR layer can be misaligned on rotated pages — crop from pixels. Per-chapter extracts: `Downloads\hazzard_review\chNN_p<first>-<last>.pdf`. Law sources: `Downloads\hazzard_review\law\`.
- Deploy from the cloud session: git bundle → `Downloads\hazzard_review` → pull + push from `C:\Users\eiasa\repos\hazzard-reader` (split bundles >20 MB); then `git fetch origin` in the cloud clone.

## Tools
- `tools/lane_diff.py NN` — two-way text diff vs the book (MISSING / EXTRA / SUBSTITUTIONS).
- `tools/verify_study_pages.py` — bolded numbers vs cited page. 52 current misses, all known false positives (image-only or spelled-out numbers; a note sitting between a number and its page cite).

## Cosmetic list (doesn't block anything)
- ch75 Table 75-6 ghost title bar baked into the scan; ch59 Table 59-7 p912 keeps its bottom band (it holds rows p913 lacks).
- Odd heading casing here and there.

## Site behavior (not a bug)
- First load after a deploy can show the previous version until the new service worker takes over; one reload fixes it.
