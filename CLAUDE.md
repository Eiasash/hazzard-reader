# hazzard-reader

## Purpose
Eias's phone study site for Hazzard's Geriatric Medicine, 8e. The book is canonical; this site is for access and digestion, not a certified transcription.

## State (22 Sep 2026)
- 13 chapters live. Lane-reviewed: 46, 47, 58, 60, 61, 99. Fast builds: 42, 43, 44, 55, 59, 63, 87.
- A study page (summary + 15-question drill) for each of the 13 chapters.
- Cache v7, commit `606bb17`. The old "unverified" carry-over chapters are gone.

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

## How it works
- `index.html` is the whole app (shell/CSS/JS from the `stage-a-reader` design). The 6 lane-reviewed chapters are embedded as `<template>` blocks.
- `manifest.json` + `chapters/*.md` is the generic path: any `?chapter=NN` with no matching template is looked up in the manifest, fetched, and rendered client-side with `marked.js` (vendored, no CDN). All 7 fast-build chapters and all 13 study pages use this path.
- `sw.js` precaches the shell plus every manifest-listed chapter's `.md` and images on install, then caches network-first / offline-fallback for everything else.
- No build step, no framework.

Live: https://eiasash.github.io/hazzard-reader/
