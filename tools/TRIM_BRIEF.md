# Cosmetic crop trim (25 Sep 2026)

All crops are content-complete (verified full-size today). Remaining defects are cosmetic: page-edge tabs (orange/red/purple vertical
"CHAPTER NN" / "PART III" strips), printed page numbers in a corner, slivers of neighbouring body text or a neighbouring highlight,
and loose empty margins. Your job: remove those, and nothing else.

For each image in your assigned chapters (`chapters/hazzard8e_chNN_*.png` that the chapter .md references; repo /home/claude/hazzard-reader):
1. Read (view) it. If it has none of the defects above, skip it.
2. Otherwise trim it with PIL by CROPPING the existing image (never re-render, never resample, never enhance): cut the tab / page number /
   neighbour text / excess margin, leaving ~12 px of white around the real content (title bar, table, figure, caption, footnotes, source line).
   If a tab overlaps the content region so that cropping would cut content, leave that image alone and report it.
3. View the result and confirm every bit of content is still there (compare with the original — keep a copy in /tmp/claude-0/trim/).
Save with the same filename. Don't touch .md files. No git commits. Other agents work concurrently on other chapters.

Report ≤8 lines: images trimmed (name + what was removed), images left and why.
