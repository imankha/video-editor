# T12740: Move Home and Annotate onto GuideScope

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Created:** 2026-10-14
**Updated:** 2026-10-14
**Epic:** [F. One pulse path for the guide](EPIC.md) · **Design:** [T12730-design.md](../../T12730-design.md) (APPROVED), commits C3a and C3b

## Problem

Home and Annotate apply the guide pulse through screen-specific props and inline class strings.
See EPIC.md.

## Solution (behavior-preserving moves; no visible change)

- **C3a Home:** `ProjectManager` and `GameDetailsModal` wrap their trees in `GuideScope`. `Button`
  gains `guideTarget` (suppressed automatically when disabled). The Finished tab
  (`SegmentedTabButton`), the first game card, and both Upload game buttons use it. Delete
  `homePulse`, `pulseUpload`, and the `SegmentedTabButton pulse` prop.
- **C3b Annotate:** `AnnotateModeView` scope; `ActionCard` gains `guideTarget`; `HighlightOrientationSlots`
  uses the hook; delete `pulsePortrait`, the inline mark-play class (`AnnotateModeView.jsx` ~1302),
  and the dead `PlaybackControls pulsePlay` (design E4: always false, ungated). Keep only the
  `annotateFullscreen` suppress; drop the gates design E7 shows are redundant with rule order.

## Context

### Relevant Files
- `src/frontend/src/components/ProjectManager.jsx`, `GameDetailsModal.jsx`, `components/shared/Button.jsx`, `components/shared/EmptyTabGuide.jsx`
- `src/frontend/src/modes/AnnotateModeView.jsx`, `components/shared/ActionCard.jsx`, `modes/annotate/components/HighlightOrientationSlots.jsx`, `modes/annotate/components/PlaybackControls.jsx`

### Curated tests
`ProjectManager.guidePulse.test.jsx`, `resolveGuide.homePulse.test.js`,
`components/shared/Button.guideTarget.test.jsx` (new), `AnnotateModeView.cta.test.jsx`,
`modes/AnnotateModeView.frameClip.test.jsx`, `components/shared/ActionCard.test.jsx`,
`modes/annotate/components/HighlightOrientationSlots.pulse.test.jsx` (new),
`instructions/resolveGuide.annotate.test.js`, e2e `T12730-guide-pulse.spec.js` (Home, Annotate).

### Related Tasks
- Depends on: T12730
- Blocks: T12760

## Acceptance Criteria

- [ ] Home and Annotate pulse exactly as before (characterization spec and existing tests green, unchanged assertions)
- [ ] No `pulse*` props or `coach-target-pulse` literals left in the touched Home/Annotate components
- [ ] Moves committed separately from any behavior change
