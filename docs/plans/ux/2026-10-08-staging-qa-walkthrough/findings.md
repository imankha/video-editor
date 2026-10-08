# Staging QA walkthrough, 2026-10-08

A first-time-user run on https://reel-ballers-staging.pages.dev with a blank account
(`e2e@test.local`, 88 credits) driven by Playwright. Game video: `wcfc-carlsbad-trimmed.mp4`
(46 MB, 1:29). One play was marked (rating Brilliant, tag Dribble, note), framed, spotlighted
and finished. Screenshots: [screens/](screens/) (file names `qa-NN-*.jpg`, order = journey order).

Limits of the run: one play (not three); spotlight clicks hit different players across the 4 frames
(so the final spotlight sitting beside a player is probably the tester's doing); Download, Add text and
Cover image untested. Master HEAD was `c6e6708fa` when run.

The user's goal for the guide: get the user to export a finished highlight.
Vocabulary rule (user): jargon confuses; wording anchored to what the user wants to accomplish does not.
Where a system must be explained, the guide does it.

## 1. Bugs

| # | Finding | Evidence |
|---|---------|----------|
| B1 | On Home > Games with a game present, the guide bubble ("Press on a game...") sits on top of the "Upload game" button | qa-37 |
| B2 | Floating overlays cover content: Guidance toggle covers the right end of the yellow "Make Highlight Now" button (qa-13), the "Add footage" card (qa-08), the "Effects are free" text (qa-28); the generating toast covers the feedback button; the "Highlight ready" toast is hidden behind the Guidance toggle (qa-23) | qa-08, 13, 23, 28 |
| B3a | Focus preview: bottom bar wraps, "Generate highlight" lands on a second row off-axis; bar covers the bottom of the preview video; "Back to full video" keeps the stale subtitle "Check the framing before generating." | qa-19, 20 |
| B3b | Overlay: "Add text" card is stranded in the far-left corner, apart from the centered "Generate highlight with overlay"; bar covers the bottom of the video; video controls and timeline are below the fold while the guide says "Press Play spotlight"; footer metadata "810x1440 0:03 30 fps" collides with the Add text card | qa-23, 28 |
| B4 | Debug label `410x730 @ (867, 175)` shown on the crop box while dragging | qa-16 |
| B5 | After the "Highlight ready" toast the Focus screen still shows "Generate highlight" and the stale guide for ~15 s before the "Your highlight is ready" panel appears; credit balance showed 86 and updated to 83 later | qa-21, 22 |
| B6 | Spotlight step: clicking inside the existing spotlight ellipse is ignored, while the guide keeps saying "Go to frame 3" even though the sidebar already says "Frame 3 (now)" | qa-25 |
| B7 | Closing the finished-highlight viewer (X) lands on Annotate (the game) instead of the Finished list; the guide there says "Open the highlight to watch or share it", impossible from that screen | qa-33 |
| B8 | Console error `ERR_FILE_NOT_FOUND blob:` right after the game upload | console |

## 2. Confusing moments and jargon

- First Home guide says "Press on a game" when no game exists (qa-04).
- Sport button shows an unexplained `?` icon; tags need a sport, found only inside "Add Tags and Notes" (qa-11).
- "Spotlight" is jargon and surprising: progress text says "Finding players for spotlight" though none was requested (qa-20).
- Header tabs "Mark Plays / Frame Highlight / Add Spotlight" are locked without explanation and compete with "Make Highlight Now"; one goal has several names: "Frame Highlight", "Make Highlight Now", "Generate highlight", "Add Spotlight".
- Timeline lanes "My athlete / Team" and "Play category" are never explained (qa-07, qa-11).
- Rating buttons all show one identical gold star, so the star count is invisible; "Mental Lapse" / "Technical Lapse" are coaching terms (qa-10).
- Play editor: tags/notes section opens below the Done/Delete bar (qa-11).
- Focus step 3 "Keep the box around your player" while playing; nothing says to pause and re-drag; the box does not follow the players and the guide advances by itself (qa-17, 18).
- Focus settings: "Straighten", "Background Dim / VIEW ONLY", "Advanced editing / This highlight" (qa-15).
- Progress text "Enhancing video - 15/92" is meaningless to a user.
- Spotlight guide: "Frame 1 of 4 still needs your player tracker" (internal terms); the bubble covers the video the user must click; two-column wrap when all frames are set; never says "click your athlete"; the info toast "Couldn't auto-detect your athlete, drag the spotlight" appears while no spotlight exists (qa-23, 24, 27).
- Finished tab: the user's one highlight shares the page with locked "Ranking Progress", "Top Plays", "Game Highlights" gauges (3s/30s); link and download are icon-only; a "Link ready / Get Link" row contradicts itself (qa-32, 34).
- Share modal: "Restricted to recipients" does not say the default (qa-35).
- Clips tab is empty after finishing with the marketing line "Focus the action on your athlete." while the game says "1 play"; Clips is the only tab with no count (qa-36).
- Games page left-aligns the card under a centered header (qa-37).

## 3. Styling and CTA consistency

Principle (user): every page has a consistent CTA look at the bottom, main CTA first.

| Screen | CTA order | Issue |
|---|---|---|
| Annotate cards (qa-08) | Mark play (main), Review plays, Share plays, Add footage | good model |
| After Done (qa-13) | yellow full-width Make Highlight Now, then Keep Marking Plays | different color/shape |
| Focus bottom (qa-15) | Trim and slow motion, Preview highlight, **Generate highlight** | main last |
| Focus preview (qa-19) | Trim, Back to full video, Generate on its own row | main last, wrapped |
| Overlay (qa-23) | Add text, then Generate highlight with overlay | main not first, split |
| Highlight ready, 1st (qa-22) | Add spotlight, Finish without spotlight, Edit framing, "Done for now" outlined button | main first |
| Highlight ready, 2nd (qa-30) | Finish, Redo spotlight, Edit framing, "Done for now" plain text link | same panel, different style |
| Share modal (qa-35) | Cancel, then Share (purple) | main last |
| Clips empty state (qa-36) | gray Go to Games, then green Upload highlight | main second |
| Play editor (qa-10) | Delete play (left), Done (right) | destructive first, main last |

Also: primary color varies by screen (green, yellow, cyan, purple); tab count badges differ (Finished orange, others gray);
"Cover image" tab wraps to two lines; icons sit at different heights in the ready-panel cards.

## 4. Guide (the `role=status` bubble when Guidance is On) gaps

| State | Observed | Recommended |
|---|---|---|
| Home, empty account (qa-04) | "Press on a game to mark plays..." | "Start with your game video. Tap Upload game." |
| Upload modal open (qa-05) | stale Home text over the backdrop | "Choose your game video, then tap Upload game. Name and details are optional." |
| Annotate, no plays (qa-07) | present, clear | keep; add "Tap Play to start watching" |
| Play editor after Mark play (qa-09) | MISSING | "Drag the green handles to cover the whole play, pick how good it was, then tap Done." |
| After Done, "Make this a highlight now?" (qa-13) | MISSING | "Play saved. Tap Make Highlight Now to turn it into a shareable video, or keep marking plays." |
| Focus load / step 1 (qa-15) | works | change "box" to "frame": "Drag the frame over your player." |
| Focus step 3 (qa-17) | "Keep the box around your player" | "If your player moves, pause and drag the frame back onto them. Then tap Preview highlight." |
| Focus generating (qa-20) | stale "click Generate highlight" | "Making your highlight... about a minute. You can keep this page open." |
| "Your highlight is ready", 1st and 2nd (qa-22, 30) | MISSING | 1st: "Highlight ready. Add a spotlight to show which player is yours, or Finish." 2nd: "Looks good? Tap Finish to save it." |
| Spotlight start (qa-23) | "Frame 1 of 4 still needs your player tracker" | "Tap your player so we can follow them." then "Do this on 4 moments (1 of 4)." |
| Spotlight all set (qa-27) | "Press Play spotlight" (button below the fold) | "Spotlight set. Tap Generate highlight with overlay." |
| Overlay generating (qa-29) | MISSING | "Adding your spotlight... about a minute." |
| Finished viewer (qa-32) | MISSING | "Done! Share the link or download it." |
| Finished tab (qa-34) | MISSING | "Your first highlight is ready. Share it, or go back to Games and mark another play." |
| Clips tab (qa-36) | MISSING | "Plays you haven't turned into highlights show here. Open a game to mark plays." |

Also seen: guide bubble present on Annotate after leaving the finished viewer but contradicting the screen (B7).

## Overlap with existing work

The Parent Usability Audit milestone (docs/plans/tasks/parent-usability-audit/) already shipped to staging: rating legibility
(T11840), "Mark Plays" rename (T11850), ready-screen copy (T11810), "Finished" rename (T11820), one upload progress number
(T11870). Tasks from this walkthrough must not redo those; check the epic files there before specifying.
