# hazzard-reader

A phone-first reading site for verified Hazzard's Geriatric Medicine, 8e chapter extracts, built on the design of the existing `stage-a-reader` specimen (same shell, CSS and controls — reading tools, text size, dark mode, highlighting, "In this chapter" jump list, study desk).

Private. Verified copies; do not edit here. Source of truth is the SZMC geriatrics project; changes arrive only as a new bundle.

## Chapters

Verified against the publisher text, rendered from `chapters/*.md`:

- 46 / Pressure Injuries
- 47 / Incontinence
- 58 / Delirium
- 60 / Behavioral Symptoms of Dementia and Psychoactive Drug Therapy
- 61 / Parkinson Disease and Related Disorders
- 99 / Diabetes Mellitus

Carried over from the original specimen, unmodified, and marked "old build, unverified" in the chapter list: 43 (Falls), 44 (Sleep disorders), 55 (Rehabilitation), 59 (Dementia including Alzheimer disease), 63 (Other neurodegenerative disorders).

## How it works

- `index.html` is the whole app: the page shell/CSS/JS is reused as-is from the `stage-a-reader` specimen. Chapters 46/47/58/60/61/99 are embedded directly as `<template>` blocks (same mechanism the specimen already used for its other chapters), rendered at build time from the `.md` files with [marked](https://github.com/markedjs/marked) (vendored at `js/marked.min.js`, no CDN).
- `manifest.json` + `chapters/*.md` is a second, generic loading path: any chapter number requested via `?chapter=NN` that has no matching `<template>` is looked up in `manifest.json`, fetched, and rendered client-side with the same vendored library — so a future `.md` (including a `*_study.md` summary-and-drill page) just needs its file dropped into `chapters/` and one entry added to `manifest.json`. No HTML/JS edit required. It also appears in the chapter list automatically.
- `sw.js` is a small service worker (cache-first, background-refreshed) that caches the shell and whatever chapters/images have been visited, so previously-opened chapters keep working offline.
- No build step, no framework.
