# Full-size crop audit (25 Sep 2026)

A thumbnail pass over all crops missed truncations that a full-size check then found (Figure 44-6 missing its top row of panels,
Figure 44-7 showing only its bottom third). You are doing the full-size check for your assigned chapters.

For each chapter NN assigned to you:
- List every image in `chapters/hazzard8e_chNN_*.md` (not `_study`): `![...](file.png)`. (Repo /home/claude/hazzard-reader.)
- Book pages: `/mnt/user-data/uploads/hazzard_review/chNN_p<first>-<last>.pdf` (index 0 = first printed page; filename gives the range).
  Find the page each crop came from (filename often has `_pNNN`; for figures search the page text for "FIGURE NN-N").
- Render that page with pymupdf (`get_pixmap(dpi=100)`) into /tmp/claude-0/crops/chNN/ and Read it; Read the crop too (at full size, or
  in halves if very tall). Compare: is ANY part of the figure/table missing — panels, top/bottom rows, a column, axis labels, legend,
  caption, footnotes? Rotated wrongly? Wrong figure?
- If broken: re-crop from the page with `page.get_pixmap(dpi=200, clip=pymupdf.Rect(x0,y0,x1,y1))` (points; page is 612×783),
  upright (if the page is rotated, rotate the saved image with PIL so text reads normally), tight around artwork + caption + footnotes,
  same filename. View the result to confirm it's complete. Don't touch crops that are complete but merely loose or with a page-tab sliver.
- Note: some table crops were contrast-enhanced today (look yellow/saturated) — that's intended; only re-crop them if content is missing,
  and if you do, apply the same enhancement: numpy `b=np.clip((a/255-0.45)/0.52,0,1)**1.8` on RGB.

Edit only image files of your chapters (and the .md only if a crop reference is wrong). No git commits. Other agents work concurrently.
Report ≤10 lines per chapter: crops checked, broken ones (what was missing) and fixed, anything left.
