# T12750: Move Focus and Overlay onto GuideScope

**Status:** STAGING
**Impact:** 5
**Complexity:** 6
**Created:** 2026-10-14
**Updated:** 2026-10-14
**Epic:** [F. One pulse path for the guide](EPIC.md) · **Design:** [T12730-design.md](../../T12730-design.md) (APPROVED), commits C3c and C3d

## Problem

Focus maps step numbers to controls (`guide.step === 2` means Play, etc.) and threads
`pulsePlay`, `pulsePreview`, `pulseGenerate`, `guidePulse` through several components. Overlay has
its own `pickPulse` path and a `CtaBar` action `pulse` field with no callers (design E5).

## Solution (behavior-preserving moves; no visible change)

- **C3c Focus** (split into two commits if over ~200 lines): `FocusModeView` scope around the whole
  view, including the mobile fullscreen branch. `Controls`, `PrimaryCta`, `ExportButtonView`,
  `FramingActionRow`, and `CropOverlay` consume a target or the hook (`CropOverlay`'s `guidePulse`
  becomes a boolean `guided`; busy states pass `suppress`). Delete the step-number mapping
  (`FocusModeView.jsx` ~786, 836, 936, 1085, 1110).
- **C3d Overlay:** `OverlayModeView` scope with BOTH guide channels (export job and pick walk);
  `PlayerDetectionOverlay` halos via the hook; delete `pickPulse`; the `CtaBar` action `pulse` field
  becomes `guideTarget`.
- Landscape cockpit stays as is here; T12770 changes it.

## Context

### Relevant Files
- `src/frontend/src/modes/FocusModeView.jsx`, `components/Controls.jsx`, `components/PrimaryCta.jsx`, `components/ExportButtonView.jsx`, `modes/focus/FramingActionRow.jsx`, `modes/focus/overlays/CropOverlay.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`, `modes/overlay/overlays/PlayerDetectionOverlay.jsx`, `modes/overlay/components/SpotlightPickGuide.jsx`, `components/shared/CtaBar.jsx`

### Curated tests
`components/Controls.test.jsx`, `components/ExportButtonView.test.jsx`,
`modes/focus/FramingActionRow.test.jsx`, `modes/focus/overlays/CropOverlay.test.jsx`,
`modes/FocusModeView.guidedSteps.test.jsx`, `modes/FocusModeView.handoffGuide.test.jsx`,
`modes/overlay/overlays/PlayerDetectionOverlay.pulse.test.jsx`,
`modes/overlay/components/SpotlightPickGuide.t12350.test.jsx`, `resolveGuide.pickPulse.test.js`,
`components/shared/CtaBar.test.jsx`, e2e `T12730-guide-pulse.spec.js` (Focus, Overlay).

Landmine: `FocusModeView.guidedSteps.test.jsx` mocks controls with the old prop API. Render real
`Controls` / `FramingActionRow` where feasible; where a mock stays, the component's own test proves
which target it consumes and the e2e proves the join (design section 9).

### Related Tasks
- Depends on: T12730 (can run after or alongside T12740; file-disjoint)
- Blocks: T12760, T12770

## Acceptance Criteria

- [ ] Focus and Overlay pulse exactly as before (characterization spec and existing tests green)
- [ ] No step-number-to-control mapping left in `FocusModeView`; no `pulse*` / `pickPulse` props left in the touched components
- [ ] Moves committed separately from any behavior change
