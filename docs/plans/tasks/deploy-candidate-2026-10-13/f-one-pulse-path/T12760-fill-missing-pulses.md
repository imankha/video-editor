# T12760: Every named control pulses: fill the gaps, rule invariant, Try again copy

**Status:** STAGING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-10-14
**Updated:** 2026-10-14
**Epic:** [F. One pulse path for the guide](EPIC.md) · **Design:** [T12730-design.md](../../T12730-design.md) (APPROVED), commits C4a and C4b

## Problem

~15 guide sentences tell the user to press a control that does not pulse (design Q4 table, rows
marked **add**). "Tap Try again" (`GUIDE.focus.failed`, `GUIDE.overlay.failed`) names a control
that does not exist; the retry is the primary export CTA.

## Solution (behavior changes, red before green)

- **C4a:** `instructions/guideRules.pulse.test.js` (new) lands RED: every `GUIDE_RULES` entry has
  exactly one of `pulse` (a `GUIDE_PULSE` value) or `noPulse` (non-empty reason); every target a
  rule names is consumed as `GUIDE_PULSE.<KEY>` in at least one non-test source file. Fill the
  Annotate and Home **add** rows: `CHOICE_NOW`, `PLAY_EDITOR_DONE` (decision 2), `SHARE_PLAYS`,
  `HIGHLIGHT_SLOT` (both slots), `FIRST_PLAY` (decision 3), `UPLOAD_SUBMIT`, `UPLOAD_RETRY`,
  `FIRST_CLIP` (decision 3), `FIRST_FINISHED` (decision 3).
- **C4b:** fill Focus, Overlay, Finished, Share: `focus.failed` and `overlay.failed` -> `EXPORT`
  and copy becomes "Tap {action} to try again." with the action label from `EXPORT_JOBS` (decision
  4); `focus.ready` -> Add spotlight (`focus-choice-primary`, decision 1); `overlay.ready` -> Finish
  (`overlay-choice-primary`); `overlay.pick.done` -> `EXPORT`; `finished.viewer` -> Get link;
  `share.modal` -> Share. Add `noPulse` reasons for every **no** row exactly as the design table
  words them. The invariant goes green.
- New testids where the design marks them missing: first play row, first draft card, first
  Finished card, Get link control, ShareModal's Share button, `focus-crop-box`. Verify each
  exists or add it.
- Verify at implementation that Annotate has no in-screen re-upload control for `annotate.expired`
  (design marks it unverified); if one exists, pulse it instead of `noPulse`.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js`, `guideTargets.js`, `src/frontend/src/config/displayNames.js` (`GUIDE.focus.failed`, `GUIDE.overlay.failed`)
- Annotate: `modes/annotate/components/HighlightChoiceCard.jsx`, `PlayEditorFooter.jsx`, `ClipListItem.jsx`, `HighlightOrientationSlots.jsx`
- Home: `components/GameDetailsModal.jsx`, `components/UploadingGameTile.jsx`, the failed `GameTile`, draft and Finished cards in `ProjectManager.jsx`
- Focus/Overlay: `screens/FocusScreen.jsx`, `components/FocusPublishActionBar.jsx`, `screens/OverlayScreen.jsx`, `components/OverlayPublishActionBar.jsx`
- Finished/Share: `components/DraftReelPreview.jsx` (+ `PublishLinkFlow`), `components/ShareModal.jsx`

### Curated tests
`instructions/guideRules.pulse.test.js` (new), `instructions/resolveGuide.states.test.js`,
`instructions/resolveGuide.job.test.js`, `instructions/resolveGuide.finished.test.jsx`,
`instructions/finishedDone.test.jsx`, `instructions/resolveGuide.playsList.test.js`,
`components/shared/CtaBar.test.jsx`, `modes/AnnotateModeView.cta.test.jsx`,
`components/ProjectManager.guidePulse.test.jsx`, e2e `T12730-guide-pulse.spec.js` (+ Finished case).

### Related Tasks
- Depends on: T12740, T12750
- Blocks: T12770

## Acceptance Criteria

- [ ] AC1: every rule with an **add** row pulses its control with Guidance on; nothing pulses with Guidance off
- [ ] AC2: the invariant test was observed red at C4a and is green at C4b
- [ ] Failed Focus and Overlay copy reads "Tap {action} to try again." with the real action label, and that CTA pulses
- [ ] e2e Finished case: Get link pulses on a not-yet-shared highlight
