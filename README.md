# hazzard-reader

**Live: [eiasash.github.io/hazzard-reader](https://eiasash.github.io/hazzard-reader/)**

Personal, phone-first study site for *Hazzard's Geriatric Medicine and Gerontology*, 8th edition, built for the Israeli geriatrics board exam (Shlav A). The book is canonical; this site is for access and digestion, not a certified transcription. Not a general resource.

## What's on it (25 Sep 2026, cache v29)

- **32 chapters**: 42, 43, 44, 45, 46, 47, 51, 52, 55, 57, 58, 59, 60, 61, 63, 65, 68, 75, 76, 77, 81, 83, 87, 88, 97, 98, 99, 101, 102, 104, 105, 108 — full text from the book with printed-page markers (`[p. NNN]`), tables as text or tight upright crops.
- **A study page for every chapter** (`?chapter=NNs`, e.g. `?chapter=58s`): concept-grouped summary with key numbers bolded and page-cited, plus a 15-question drill with hidden answers; chapters with 2026 exam questions include them with the official keys.
- **Israeli law block** (`?chapter=law`, study drill `?chapter=laws`, Hebrew): Dying Patient Law, Patient's Rights Law, Legal Capacity and Guardianship Law (enduring power of attorney), MoH circulars MR 20/2009 and MK 8/2018, geriatric-hospital procedures 0.2.1 and 3.4.2, Brookdale 65+ yearbook (2025, compared with 2023). Primary sources, not Hazzard.
- Works offline once opened online (service worker precaches everything in the manifest).

## How it was checked

Every chapter was reviewed against the book (two-way text diff plus page images), every study page was read against the book twice, and every crop was compared full-size with its page. Outside audits on 25 Sep: Codex (two rounds, 89 findings, 87 confirmed and fixed), Gemini (no usable findings).

Conventions on the pages:
- *[sic — the book's own …]* marks a book misprint that the book itself contradicts elsewhere (e.g. units).
- **Current practice (not the book):** one line under a statement that is faithful to the book but outdated; added only from a fetched, cited source. The book's answer stays, because the exam is drawn from the book.
- *Highlighting is the owner's annotation, not the book's.* — under every cropped image (the source is a marked phone scan).

## How it works

- `index.html` is the whole app (shell, CSS, JS; no build step, no framework). Chapters 47, 58, 60, 61 and 99 are embedded as `<template>` blocks; everything else is loaded from `manifest.json` + `chapters/*.md` and rendered in the browser with the vendored [marked](https://github.com/markedjs/marked) (`js/marked.min.js`).
- Adding a chapter or study page = drop the `.md` (and images) into `chapters/` and add one entry to `manifest.json`.
- `sw.js` precaches the shell and every manifest chapter with its images; network-first, cache fallback offline. It only ever deletes its own `hazzard-*` caches (the eiasash.github.io origin is shared with other apps). The cache version is bumped on every deploy.
- `tools/`: `lane_diff.py` (chapter vs book text diff), `verify_study_pages.py` (every bolded study-page number vs its cited page), and the briefs used for the review and audit passes.

Working notes for Claude: `CLAUDE.md`. Full build/review log: `HISTORY.md`.
