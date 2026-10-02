# hazzard-reader — working notes for Claude

Eias's phone study site for Hazzard 8e (Stage A board exam). The book is canonical; the site is for access and digestion. Build and fix workflow: the `hazzard-chapter-build` skill. Full history of how it got here: `HISTORY.md`.

## State (02 Oct 2026)
- Live at cache **v36** (02 Oct reading progress, missed deck, offline full-text search and incremental updates, see below). 32 chapters + study pages + Israeli law block (`law` / `laws`). All reviewed against the book; flag line on each: "Lane-reviewed against the book, 25 Sep 2026."
- **v32:** isolated Hazzard caches and made save-failure messages explicit.
- **v33:** tapping the current chapter in the library returns to reading without reloading.
- **v34:** permanent Chapters / Notebook / Practice / Text tabs, paired library rows, a simpler desk, labelled chapter controls and equal Previous / Next buttons; the header hides on downward reading scroll and returns on any upward scroll or at the top.
- **v36:** right-edge fading Top/End pills; 13 PDF-confirmed lost-hyphen joins repaired; SHA-256 asset list reuses unchanged files even from v35, activates only after all files are verified, and serves a complete cached release. Chapters show furthest reading point and drill score; Practice collects missed drill/mock questions; Chapters searches chapter/study/template/Hebrew text offline. New stores `hazzard-reading-progress-v1` and `hazzard-missed-v1` are included in backup/merge restore; existing stores keep their formats. Text reports storage protection.
- **v35:** single 48px overlay header with chapter arrows and a 200ms slide (hide after 60px down, return after 30px up or at the top; stay visible while highlighting); Text holds Contents/Find/Top/End; best-effort persistent storage and Notebook JSON backup/merge restore preserve existing highlights and progress.
- Outside audits done 25 Sep: Codex sweep 1 (10 fixed), Codex wide 6-shard sweep (79 findings, 77 fixed, 2 rejected), Gemini (0, unreliable). Every finding is in the Reviewer Scorecard artifact (claude.ai/artifact/UHxA3ikkukJEZ5ZCgPgnRy). Briefs: `tools/*_BRIEF.md`.
- Pending: Eias's own airplane-mode offline test on the phone.

## Rules
- Fast mode: build, check once, deploy. No new guards, sweeps or review rounds unless Eias asks; state time cost before proposing extras.
- Chapters **47, 58, 60, 61, 99** render from `<template>` blocks in `index.html`, not their `.md` — edit both.
- Book text stays even when wrong (the exam is drawn from it):
  - misprint the book itself contradicts → `*[sic — the book's own Table/Figure X, pNNN, gives …]*`
  - faithful but outdated → one `> Current practice (not the book): … — source, year.` line, only from a fetched source (indent 2 spaces under a `- ` bullet).
- Study pages: keep the book's qualifiers (up to / may / in one study / estimated / in the US) and conditions; answers inside one-line `<details>` need `<strong>`, not `**`.
- Crops: tight, upright, table/figure + caption + footnotes only; verify full-size against the page (thumbnails miss truncation).  No "highlighting is the owner's annotation" note (removed 29 Sep at Eias's request — he knows).
- After release edits, run `python tools/generate_asset_list.py` to refresh `asset-list.json` (all files, SHA-256 fingerprints and byte sizes); commit the list with the release. The static site still has no framework or build step.
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

## Reader features (02 Oct 2026, cache v31)
- Page markers render as a small inline `pNNN` tag; a paragraph the page break cut mid-sentence is joined at display time (source .md untouched).
- Highlighting: tap = sentence; long-press + drag = exact words → "Highlight selection" button (stored as `ranges` with text + prefix/suffix in `stage-a-highlights-v1:<ch>`). Old unit highlights whose numbering shifted re-attach by text on load. Highlights resync on pageshow/visibility/storage (fixes the stale back-navigation notebook).
- Notebook: this chapter + saved places + other chapters' highlights (deep links `#hl-<id>`, `#bm-<time>`).
- Place: auto-saved per chapter (`hazzard-place-v1`), restored on open; root URL opens the desk with Resume → last chapter. Save place in Reading tools (`hazzard-bookmarks-v1`).
- Images/SVG figures: tap → full-screen zoom (pinch, double-tap, drag). Top/end buttons in the bottom reader bar, outside the text area; images load lazily with intrinsic dimensions.
- Practice: Question bank = the 33 study drills; Mock paper = random 20/50/100 from all drills (498 questions), self-graded, kept in `hazzard-mock-v1` (`?chapter=mock`). Drills/mock keep self-grades and revealed answers and offer retry-missed views. Study timer 25/5/5 persists its phase, paused/running state and deadline in `hazzard-timer-v1`; chapter-drill progress is new data in `hazzard-drills-v1`.

- Reading tools reports **Offline ready** only after the controlling v31 worker completed every precache asset. Install rejects any exhausted download/discovery retry; activate cleanup remains limited to `hazzard-*` caches.
- Small/Medium/Large labels and existing display storage remain; Large is 19px at a 16px root. Controls scale separately so they fit a phone. Chapter/study and previous/next links are in the opening, tools and end; the corresponding study/read link is also in the reader bar. Phone Back unwinds desk/library views.

## Site behavior (not a bug)
- First load after a deploy can show the previous version until the new service worker takes over; one reload fixes it.
