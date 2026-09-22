# hazzard-reader

**Live: [eiasash.github.io/hazzard-reader](https://eiasash.github.io/hazzard-reader/)**

A phone-first reading site for verified Hazzard's Geriatric Medicine, 8e chapter extracts, built on the design of the existing `stage-a-reader` specimen (same shell, CSS and controls — reading tools, text size, dark mode, highlighting, "In this chapter" jump list, study desk).

Personal study tool; not a general resource. Source of truth for the lane-reviewed chapters is the SZMC geriatrics project; changes to those arrive only as a new bundle. The fast-build chapters and all study pages are built and maintained directly in this repo.

## Status (22 Sep 2026, cache v6)

13 chapters live, each with a summary + 15-question drill study page (`?chapter=NNs`, e.g. `?chapter=58s`) listed directly under it in the library.

### Lane-reviewed, verified against the publisher text page-by-page

Rendered from `chapters/*.md`, embedded as `<template>` blocks:

- 46 / Pressure Injuries
- 47 / Incontinence
- 58 / Delirium
- 60 / Behavioral Symptoms of Dementia and Psychoactive Drug Therapy
- 61 / Parkinson Disease and Related Disorders
- 99 / Diabetes Mellitus

### Fast build, not lane-reviewed

Extracted from the book's text layer (tables/figures machine-cropped, not verified page-by-page). Marked "Fast build, not lane-reviewed" in the chapter list:

- 42 / Frailty
- 43 / Falls
- 44 / Sleep Disorders
- 55 / Rehabilitation
- 59 / Dementia Including Alzheimer Disease
- 63 / Other Neurodegenerative Disorders
- 87 / Constipation

(43/44/55/59/63 replace the earlier "old build, unverified" carry-over versions.)

### Study pages

All 13 chapters above have a companion `hazzard8e_chNN_study.md`: a concept-grouped summary (every key number bolded and page-cited) plus a 15-question drill with hidden `<details>` answers, and — for the 6 lane-reviewed chapters that have one — the chapter's own 2026 exam questions reproduced verbatim at the end. Every bolded number was checked against its cited page in the source chapter before publishing.

## How it works

- `index.html` is the whole app: the page shell/CSS/JS is reused as-is from the `stage-a-reader` specimen. The 6 lane-reviewed chapters are embedded directly as `<template>` blocks (same mechanism the specimen already used for its other chapters), rendered at build time from the `.md` files with [marked](https://github.com/markedjs/marked) (vendored at `js/marked.min.js`, no CDN).
- `manifest.json` + `chapters/*.md` is a second, generic loading path: any chapter number requested via `?chapter=NN` that has no matching `<template>` is looked up in `manifest.json`, fetched, and rendered client-side with the same vendored library — so a chapter or study page just needs its file dropped into `chapters/` and one entry added to `manifest.json`. No HTML/JS edit required. It also appears in the chapter list automatically. All 7 fast-build chapters and all 13 study pages use this path.
- `sw.js` is a small service worker that precaches the shell plus every `manifest.json`-listed chapter's `.md` and images on install (so a chapter works offline even if never opened), and caches network-first, offline-fallback for everything else.
- No build step, no framework.
