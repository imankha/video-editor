# T11140: Mode bar - Frame Highlight / Add Spotlight, gated on the selected play's highlight

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

The mode bar reads Annotate / Framing / Spotlight. From Annotate, "Framing" is enabled by the
GLOBAL selected project (`AnnotateScreen.jsx:716` `hasProject={!!selectedProject}`), and clicking
it opens the MOST RECENT region with an `autoProjectId` (`AnnotateScreen.jsx:201-207`, not awaited),
not the play the user is looking at.

## Solution

1. **Labels** (H2): Framing -> "Frame Highlight", Spotlight -> "Add Spotlight". Use switcher-only
   label keys rather than renaming `MODE_NAMES` (`displayNames.js:151`): `MODE_NAMES.FRAMING` feeds
   ~30 other strings ("Generate Framing", "Framing ready", "Reapply Framing", `emptyStates`,
   `draftStage`, `SegmentedProgressStrip`, `DraftTile`, backend `quest_config.py`) and the
   Focus/Overlay switcher (`App.jsx:1011`). Whether those follow is H2.
2. **Gating from Annotate** (H9): Frame Highlight enabled iff the SELECTED play has a clip
   (`selectedRegion.autoProjectId`); Add Spotlight iff that project `has_working_video` (clipStage
   SPOTLIGHT, `useProjectsList` lookup at `AnnotateModeView.jsx:205-209`). No play selected = both
   locked. Clicking opens THAT play's project (await `selectProject`, as `openClipInFocus` :222-234
   does). `ModeSwitcher.jsx` gets explicit props for this.
3. **Locked-tab explanation** per T11100 section D, with no user-visible "clip" (owner ruling
   2026-09-24; today's toast "Open a clip to start framing" at `ModeSwitcher.jsx:90-113` goes) (today: toast at `ModeSwitcher.jsx:90-113`).
   Mobile (<640 px) is icon-only (:135); D decides whether labels appear.

## Context

### Relevant Files
- `src/frontend/src/components/shared/ModeSwitcher.jsx`
- `src/frontend/src/stores/editorStore.js:98-102` (`SCREENS`)
- `src/frontend/src/screens/AnnotateScreen.jsx`
- `src/frontend/src/config/displayNames.js`

### Tests to update
`ModeSwitcher.test.jsx`, `SegmentedProgressStrip.test.jsx` (if labels shared), e2e
`T8480-reel-focus-unlock` (`mode-framing` aria-disabled), `regression-tests.spec.js:2260`
(`name:'Spotlight'`).

### Related Tasks
- Depends on: T11100 (D pick), H2, H9
- File overlap with T11130 only in `AnnotateScreen.jsx`; sequence after T11130 or coordinate.

## Acceptance Criteria

- [ ] Red-then-green: with play A (clip) and play B (no clip), selecting B locks Frame Highlight;
      selecting A and clicking it opens A's project, not the most recent one
- [ ] Add Spotlight locked until the selected play's Framing export exists
- [ ] Labels read Frame Highlight / Add Spotlight on desktop; mobile per D
- [ ] Live-driven desktop + 393 px phone
