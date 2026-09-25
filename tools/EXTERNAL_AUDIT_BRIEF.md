# External audit brief — hazzard-reader whole-site sweep (READ-ONLY)

You are an independent auditor. DO NOT edit, create, move or delete any file in this repo, and do not run git commands that change anything. Your only output is one report file you write OUTSIDE the repo (path given in your prompt).

## What this is
A phone study site for a geriatrician preparing for the Israeli geriatrics board exam: 32 chapters of Hazzard's Geriatric Medicine 8e (`chapters/hazzard8e_chNN_*.md`), a study page per chapter (`chapters/hazzard8e_chNN_study.md`: summary bullets with (pNNN) page cites + 15-question drill with answers in `<details>`), and an Israeli law block (`chapters/israel_law.md`, `chapters/israel_law_study.md`, Hebrew). Chapters 47, 58, 60, 61, 99 are shown on the site from `<template>` blocks in `index.html`. Live: https://eiasash.github.io/hazzard-reader/

## Sources (ground truth)
- Book pages per chapter: `C:\Users\eiasa\Downloads\hazzard_review\chNN_p<first>-<last>.pdf` (page index 0 = first printed page in the filename). Python + pymupdf is installed (`import pymupdf`).
- Law sources: `C:\Users\eiasa\Downloads\hazzard_review\law\` (statutes, MoH circulars MR 20/2009 + MK 8/2018, procedures ng-0-2-1 / ng-3-4-2, Brookdale shnaton-2025.pdf).

## What to look for (priority order)
1. **Study-page claims that are wrong vs the book**: wrong number, reversed direction, dropped qualifier (may/some/in one study/up to), overstatement ("first-line", "never", "always", "preferred") the book doesn't make, wrong drill answer key, wrong page cite.
2. **Chapter text that differs from the book**: dropped/truncated sentences, garbled or stitched text, wrong numbers, text in the wrong place.
3. **Law block**: quoted statute text that isn't verbatim, wrong section numbers, wrong direction of an obligation/permission, wrong Brookdale figures.
4. Site/code problems: broken links or images (`manifest.json`, `sw.js`, `index.html`), anything that would break offline use.

Known and intentional (do NOT report): book typos kept as printed; image-only table numbers; the cosmetic list in `CLAUDE.md`.

## Report format (markdown)
For each finding: `chNN | file:line | CLAIM (quote) | BOOK SAYS (quote + printed page) | severity: exam-relevant / minor`. Only report findings you verified against the source PDF — say "unverified" otherwise. End with: chapters actually checked, what you skipped. Be honest; zero findings is an acceptable result. Prioritise breadth: cover every study page before going deep on any chapter text.
