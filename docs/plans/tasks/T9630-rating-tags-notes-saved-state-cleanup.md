# T9630: Rating, tags, notes and saved-state presentation cleanup

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-07, N35, B2 (handoff E4-05)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

On the play form, **four stars**, **Good**, **Big play** and an exclamation mark all compete to
describe one rating, with no documented mapping between them. Relevant tags are not exposed. A
custom title can be replaced when notes change. Saved state is asserted rather than derived.

## Solution

- **One** star-to-descriptor mapping, used consistently in the list, the editor and playback.
- Expose the relevant sport tags rather than hiding them.
- **Never auto-replace a user-entered title** when notes change.
- Show Unsaved / Saving / Saved from real persistence state; a failure retains the edits.
- Tags and note remain visible after saving.

## Context

### Relevant Files
- `src/frontend/src/components/shared/clipConstants.js` - rating captions (T9320 revised these;
  build on that, do not revert it)
- `src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` and the T8600 inline editor strip
- `src/modes/annotate/components/ClipListItem.jsx`

### Related Tasks
- T9320 (STAGING) rewrote the rating captions to express intent. **Re-read those strings first** -
  part of this complaint may already be answered.
- T9450 - the unsaved-form save claim
- T8960 - play editor strip layout, same surface

### Technical Notes
The star mapping should be defined once and imported, not restated per surface.

## Acceptance Criteria

- [ ] One documented star-to-descriptor mapping is used everywhere
- [ ] Changing a note preserves a custom title
- [ ] An unsaved form never claims successful persistence, and a failure retains edits
- [ ] Tags and note remain visible after saving
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
