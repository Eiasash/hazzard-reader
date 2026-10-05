# hazzard-reader

**Live: [eiasash.github.io/hazzard-reader](https://eiasash.github.io/hazzard-reader/)**

Personal, phone-first study site for *Hazzard's Geriatric Medicine and Gerontology*, 8th edition, built for the Israeli geriatrics board exam (Shlav A). The book is canonical; this site is for access and digestion, not a certified transcription. Not a general resource.

## What's on it (05 Oct 2026, cache v89)

- **72 chapters**: 8, 9, 11, 15, 16, 22, 27, 30, 31, 34, 38, 39, 42, 43, 44, 45, 46, 47, 49, 50, 51, 52, 53, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 67, 68, 69, 70, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 87, 88, 89, 90, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108 - full text from the book with inline printed-page markers (`pNNN`), tables as text or tight upright crops.
- **Study pages for 55 Read chapters and additional study-only chapters** (`?chapter=NNs`, e.g. `?chapter=58s`): summaries and drills or exam-cited source images, retained in their existing format (chapters 11, 30, 34, 38, 62, 64, 69, 70, 72, 78, 79, 80, 84, 90, 93, 94, 100 have Read and Exam questions only); chapters with 2026 exam questions include them with the official keys.
- **Israeli law block** (`?chapter=law`, study drill `?chapter=laws`, Hebrew): Dying Patient Law, Patient's Rights Law, Legal Capacity and Guardianship Law (enduring power of attorney), MoH circulars MR 20/2009 and MK 8/2018, geriatric-hospital procedures 0.2.1 and 3.4.2, Brookdale 65+ yearbook (2025, compared with 2023). Primary sources, not Hazzard.
- Reader controls stay below the text, with Small/Medium/Large sizes (Large is 19px at the standard root size), direct chapter/study and previous/next links, and phone Back navigation.
- Study drills and 20/50/100-question mock papers keep revealed answers and Got it/Missed self-grades, with retry-missed views.
- Highlights, saved places and the 25/5/5 timer survive navigation and reload.
- Works offline after Reading tools shows **Offline ready**. A failed update leaves the old service worker and its complete caches active; the next visit retries installation.

## How it was checked

The original 32 chapters were reviewed against the book (two-way text diff plus page images), every study page was read against the book twice, and every crop was compared full-size with its page. Outside audits on 25 Sep: Codex (two rounds, 89 findings, 87 confirmed and fixed), Gemini (no usable findings).

The 40 v86/v87/v88/v89 additions are fast builds from the marked book, with rendered table/figure checks; they are not lane-reviewed.

Conventions on the pages:
- *[sic — the book's own …]* marks a book misprint that the book itself contradicts elsewhere (e.g. units).
- **Current practice (not the book):** one line under a statement that is faithful to the book but outdated; added only from a fetched, cited source. The book's answer stays, because the exam is drawn from the book.

## How it works

- `index.html` is the whole app (shell, CSS, JS; no build step, no framework). Chapters 47, 58, 60, 61 and 99 are embedded as `<template>` blocks; everything else is loaded from `manifest.json` + `chapters/*.md` and rendered in the browser with the vendored [marked](https://github.com/markedjs/marked) (`js/marked.min.js`).
- Adding a chapter or study page = drop the `.md` (and images) into `chapters/` and add one entry to `manifest.json`.
- `sw.js` precaches the shell and every manifest chapter with its images; network-first, cache fallback offline. It only ever deletes its own `hazzard-*` caches (the eiasash.github.io origin is shared with other apps). The cache version is bumped on every deploy.
- `tools/`: `lane_diff.py` (chapter vs book text diff), `verify_study_pages.py` (every bolded study-page number vs its cited page), and the briefs used for the review and audit passes.

Working notes for Claude: `CLAUDE.md`. Full build/review log: `HISTORY.md`.
