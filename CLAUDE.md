# hazzard-reader — working notes for Claude

Eias's phone study site for Hazzard 8e (Stage A board exam). The book is canonical; the site is for access and digestion. Build and fix workflow: the `hazzard-chapter-build` skill. Full history of how it got here: `HISTORY.md`.

## State (02 Oct 2026)
- Live at cache **v37** (02 Oct paired controls and five-tab navigation; see below). 32 chapters + study pages + Israeli law block (`law` / `laws`). All reviewed against the book; flag line on each: "Lane-reviewed against the book, 25 Sep 2026."
- **v37:** Reading / Chapters / Notebook / Practice / Text tabs; active tabs return to the reading place. Header Find toggles a match-stepping bar; chapter title toggles Contents. Highlight remains sentence-tap on/off, with Bookmark/Remove bookmark, Colour and Done above the tabs and visible saved feedback. Text contains only appearance and storage status; Practice contains timer and study desk. Nested sheets unwind with Back; bookmark removal, missed-deck grading, timer reset and replacing a mock paper have adjacent undo. Root launch resumes the last reader/study page; display settings join notebook backups without new localStorage keys. Smaller, translucent edge pills leave line ends clear. Medical content and the v36 incremental service-worker safety logic are unchanged.
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

## Reader behavior (02 Oct 2026, cache v37)
- Page markers render as a small inline `pNNN` tag; a paragraph the page break cut mid-sentence is joined at display time (source .md untouched).
- Highlighting: header on → tap sentences → same header off (or Done above the tabs). No selection popup. Existing `ranges` in `stage-a-highlights-v1:<ch>` still restore and can be removed. Old unit highlights re-attach by text; highlights resync on pageshow/visibility/storage.
- Notebook: this chapter + saved places + other chapters' highlights (deep links `#hl-<id>`, `#bm-<time>`).
- Place: auto-saved per chapter (`hazzard-place-v1`), restored on open; root URL resumes the last reader/study page. Bookmark/Remove bookmark lives in the Highlight bar (`hazzard-bookmarks-v1`); Notebook lists saved places.
- Images/SVG figures: tap → full-screen zoom (pinch, double-tap, drag). Top/end pills at the physical right edge, outside line endings; images load lazily with intrinsic dimensions.
- Practice: Question bank = the 33 study drills; Mock paper = random 20/50/100 from all drills (498 questions), self-graded, kept in `hazzard-mock-v1` (`?chapter=mock`). Drills/mock keep self-grades and revealed answers and offer retry-missed views. Practice → Study timer 25/5/5 persists its phase, paused/running state and deadline in `hazzard-timer-v2` (legacy v1 remains readable); chapter-drill progress stays in `hazzard-drills-v1`.

- Text reports **Offline ready** only after the controlling v37 worker completed every precache asset. Install rejects any exhausted download/discovery retry; activate cleanup remains limited to `hazzard-*` caches.
- Small/Medium/Large labels and existing display storage remain; Large is 19px at a 16px root. Controls scale separately so they fit a phone. Chapter/Study and previous/next controls share the header; previous/next also appear at chapter ends. Contents has headings only plus All chapters. Phone Back unwinds sheets, nested practice tools and desk/library views one layer at a time.

## Site behavior (not a bug)
- First load after a deploy can show the previous version until the new service worker takes over; one reload fixes it.
