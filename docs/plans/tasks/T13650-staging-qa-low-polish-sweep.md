# T13650: Low-severity polish from staging QA part 2 (copy, toasts, small layout)

**Status:** TODO
**Impact:** 2
**Complexity:** 3
**Tier:** M (many small frontend fixes; one item each)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26 (report `REPORT.md` bug numbers in brackets). Each item has its own repro; verify each one before and after.

## Items (repro -> expected; "actual" is what happens now)

1. **[31] Report button over timeline, 1024/1440.** Open Annotate on a game: the floating Report a problem button overlaps the right end of the timeline lanes. -> clear of the timeline.
2. **[32] Play name vs number, 768.** With Plays 1-4, mark a play at 0:02: named "Play 5" but listed and tooltipped as "2.". -> name and number agree.
3. **[33] Added-play toast, 768.** Mark play > Done: "Added play 'Play 5'" covers Edit play and the Landscape button edge. -> toast clear of controls.
4. **[35] Viewer title, 390/768.** Finished > highlight's Watch button: title "Vs Carlsbad QA 0'00"" while elsewhere it is "QA first play". -> highlight name.
5. **[36] Finished tile tap, 390.** Tapping a tile's picture only shows ⋮; carousel arrows cover the first tile's play button and the second's Share. -> tapping the picture plays; arrows don't cover buttons.
6. **[38] Delete game prompt, 1440.** ⋮ > Delete game shows only "Tap again to confirm". -> says what is lost (plays, highlights) and that it can't be undone.
7. **[39] Game tile accessible name.** The tile's accessible name ends with "More actions", same as its ⋮ button. -> distinct names.
8. **[40] Edit game, 1440.** Edit Game Details has no name field, and Opponent is required there but optional on upload. -> consistent.
9. **[43] Clips "Upload highlight" dialog.** Says only "You can link the Clip to a game from the Clips tab." while on the Clips tab; mixes "highlight"/"Clip"; no mention of Veo zips or cost. -> explains what to pick and the cost.
10. **[45] Zip refusal copy.** A .txt renamed .zip in Clips upload: "Could not read this zip." -> says what to do; upload dialog mentions WebM too.
11. **[47] Clips sections.** Home > Clips: two sections both titled "In progress". -> distinct headings.
12. **[51] Text over badge, 1440.** Add text "#7 Maya": drawn on top of "3 players detected"; text settings panel cut off at the bottom (Shadow blur / Stroke width); timeline the coach names is below the fold. -> readable, reachable.
13. **[53] Spotlight-ready toast.** Half hidden under the coach shade, overlaps "Done for now". -> readable.
14. **[55] Double-hyphen copy.** "Offline -- your work is saved locally" (see T13510), "Connection lost -- generation continues on server. Reconnecting...", "You're warming up -- keep going!", "Thanks -- we'll look into it." -> plain punctuation, no em dashes.
15. **[56] Download file name.** Finished viewer > Download saves "video.mp4". -> named after the highlight.
16. **[58] Tile menu jargon.** ⋮ on a finished tile: "Intro", "Open as Draft", "Copy Link" next to "Share" unexplained. -> clear labels.
17. **[67] Rating copy.** A play whose Frame was only opened shows "Good play - highlight already made." -> only when a highlight exists.
18. **[69] Upload error copy.** Go offline during upload: "Upload stopped. Failed to fetch". -> plain language (behavior and Retry are good).
19. **[68] Deep links.** URLs /annotate, /focus, /overlay, /home/published have no ids; opened in a new tab they land on Home. -> decide whether to add ids (may become its own task).

## Verify the fix (required, before and after)

For every item you fix: run its repro on the current build first and record the "actual" (screenshot or text), then rerun after the fix and record the "expected". Items with logic (2, 5, 15, 17) get a unit test that fails before and passes after. Log both results per item in the progress log.

## Acceptance Criteria

- [ ] Every item fixed or explicitly declined with the user
- [ ] Before/after evidence per item

## Items added 2026-10-26 (QA part 3)

20. **Rating copy after delete.** Delete a play's only highlight: the play still says "Good play - highlight already made." (extends item 17). -> only while a highlight exists.
21. **Add footage copy, em dash.** Add footage dialog: "It's placed by when it was filmed and appends to this game — your existing plays stay put." -> no em dash.
22. **Ready-screen title clipped at 390.** After Generate, the title at the top-left reads "...lsbad ..." (start cut off). -> readable title.
23. **Frame breadcrumb at 1024x768.** Highlight name truncated to "Pla...". -> show the name.
24. **Phone text editing.** At 390 the Text sheet covers the video while you type, so you can't see where the text lands; you also must scroll the sheet to reach the field. -> keep a preview visible.
25. **Account Settings close button has no accessible name** (the X), so screen readers and tests can't find it; Escape does not close it either (T13500 item 1).

Repro and before/after rule above applies to each.
