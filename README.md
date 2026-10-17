# hazzard-reader

**Live: [eiasash.github.io/hazzard-reader](https://eiasash.github.io/hazzard-reader/)**

Personal, phone-first study site for *Hazzard's Geriatric Medicine and Gerontology*, 8th edition, built for the Israeli geriatrics board exam (Shlav A). The book is canonical; this site is for access and digestion, not a certified transcription. Not a general resource.

## What's on it

- **108 chapters** with Read pages and **108 Study pages** for summaries and drills.
- **Israeli law block** (`?chapter=law`, study `?chapter=laws`, Hebrew): end-of-life and patient rights, legal capacity and guardianship, enduring power of attorney, Ministry of Health circulars, geriatric-hospital procedures and Brookdale data.
- **Question bank:** 800 official past-paper questions and 2,097 practice questions, including 60 retired practice questions that are not served.
- Highlights and saved places are collected in the **Notebook**; reading position is saved per chapter and restored when reopened.
- **Small/Medium/Large** text sizes, Chapter/Study links and previous/next chapter navigation.
- Works offline after **Text & appearance** shows **offline ready**.

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
