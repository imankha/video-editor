# Clip Ready Screen

**Status:** IN_PROGRESS
**Started:** 2026-09-19

## Goal

The post-export completion screen (Focus "Framing ready" and Overlay "Clip ready") reads as a
reward, not a form, and every video player in the app that plays a finished reel shows the
controls a parent expects: visible play/pause and fullscreen.

User request 2026-09-19 (product owner, from a real post-export screenshot): "I dont have a
play/pause button or full screen. I am use to seeing controls when i see a video. Also not sure
why, as a user I need to know it's saved to drafts and only i can see it, or I have a Save draft
button with text under. Confusing. As far as the 3 buttons I actually need, they don't look fun.
I think this piece of UI could use more pop." Follow-up ruling: "approved [V2]. please also make
sure the video player for published videos has the same controls."

## Design (APPROVED 2026-09-19)

- Decision artifact (live mockups, the thing the user approved): https://claude.ai/artifact/9w4SKRvSbdNzMLpwFxNWKF
  (offline copy: [decision-artifact.html](decision-artifact.html))
- Full proposal with exact Tailwind class strings per tile per state, copy blocks, fullscreen
  mechanics and the risk ledger: [design-proposal.md](design-proposal.md). **This is the design
  document for both tasks; the Architect gate is already satisfied by the user's approval.**
- Variant chosen: **V2 Celebration tiles**. Video controls: **option 3** (center glyph + header
  transport). Copy: **section B** of the proposal, verbatim.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T10670 | [Completion bars: V2 celebration tiles, headline + Saved chip, "Done for now"](T10670-completion-bars-v2-tiles.md) | TODO |
| T10680 | [CollectionPlayer transport: play/pause glyph, header Play/Pause + Fullscreen, on every finished-reel player](T10680-collection-player-transport-controls.md) | TODO |

The two tasks are **file-disjoint and may run in parallel**: T10670 owns the two action bars,
`displayNames.js`, `resultRetentionNote.js` and their tests; T10680 owns `CollectionPlayer.jsx`,
`useStoryPlayback.js`, the `IntroStoryPlayer` opt-out and their tests. Neither touches
`FocusScreen.jsx` / `OverlayScreen.jsx` (T10680 makes the controls default-on so no mount site
changes), which keeps both clear of the Focus Result Loop tasks T10650/T10660.

## Completion Criteria

- [ ] Focus and Overlay completion footers match the V2 mockup at 1024px+ (three tiles in one
      row) and at 390px (three horizontal rows), with the headline, the Saved chip, no "Save"
      verb anywhere on the screen, and "Done for now" as the exit.
- [ ] The completion preview, the library Draft/Published player and the public share-link viewer
      all show a play glyph while paused, and Play/Pause + Fullscreen in the header.
- [ ] iPhone Safari: fullscreen opens the native video player and returns cleanly.
- [ ] Escape leaves fullscreen first, closes the player only on the second press.
- [ ] Unit + e2e specs listed in each task updated; Branch CI green on both branches.
- [ ] `.claude/knowledge/export-pipeline.md` "post-export preview" lines updated (Stage 7).
