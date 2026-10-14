# T12770: Trim, reduced motion, cockpit, and the guard test

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-14
**Updated:** 2026-10-14
**Epic:** [F. One pulse path for the guide](EPIC.md) · **Design:** [T12730-design.md](../../T12730-design.md) (APPROVED), commits C5, C6, C7

## Problem

- Trim runs a second pulse mechanism (`data-trim-guide` in `FocusModeView.jsx` ~915 plus
  `trim-guide-pulse` in `index.css` ~382-398) (design E3).
- Reduced motion sets `animation: none` (`index.css` ~415), so most targets show no cue; only
  Controls, PlaybackControls and CropOverlay add a static ring (design E11).
- The landscape Focus cockpit pulses the crop box with Guidance OFF: `FocusCockpit.jsx:204`
  renders `CropOverlay` without `guidePulse`, so `CropOverlay.jsx:591-592` falls back to
  `focusPointCount === 0` (design E6, verified 2026-10-14).
- Nothing stops a future screen from hand-wiring a pulse again.

## Solution

- **C5 (visual):** trim pulse moves to `useGuidePulse` on `SegmentLayer`'s track and buttons;
  delete `data-trim-guide` and the `trim-guide-pulse` CSS. Reduced motion: one CSS rule gives every
  `coach-target-pulse` a static 2px amber ring (decision 6); delete the per-site `ring-2
  ring-amber-400` pulse rings.
- **C6 (decision 5):** `FocusCockpit` resolves a new `focus.cockpit.drag` rule and provides a
  `GuideScope`, so the cockpit ring follows Guidance.
- **C7 (guard, AC3):** `instructions/guidePulse.guard.test.js` (new) reads raw source: the string
  `coach-target-pulse` appears only in `guideTargets.js` and `index.css`; the removed prop names
  (`pulsePlay`, `pulsePreview`, `pulseGenerate`, `pulseUpload`, `pulsePortrait`, `guidePulse`,
  `homePulse`, `pickPulse`) are absent from non-test source. Record a Rule 7 grep over `src/`,
  `src/frontend/e2e/`, `scripts/` in the PR (decision 7: tests may still assert the class name).
- Write `.claude/knowledge/guidance.md` (entry points, the GuideScope invariant, landmines such
  as the trim `phase` and Overlay's two channels) and add its row to CLAUDE.md's knowledge table.

## Context

### Relevant Files
- `src/frontend/src/index.css`, `modes/FocusModeView.jsx`, `modes/focus/layers/SegmentLayer.jsx`
- `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx`, `modes/focus/overlays/CropOverlay.jsx`, `components/instructions/resolveGuide.js`
- `src/frontend/src/components/Controls.jsx`, `modes/annotate/components/PlaybackControls.jsx` (ring cleanup)

### Curated tests
`modes/FocusModeView.guidedSteps.test.jsx` (trim cases rewritten to class assertions),
`modes/focus/layers/SegmentLayer.test.jsx`, `modes/focus/overlays/CropOverlay.test.jsx`,
`modes/focus/cockpit/__tests__/FocusCockpit.test.jsx`, `instructions/guidePulse.guard.test.js`
(new; red before the moves, green after), e2e `T10840-focus-landscape-cockpit.qa.spec.js` (once),
e2e `T12730-guide-pulse.spec.js`.

### Related Tasks
- Depends on: T12760
- Human check (Stage 6): the trim track animation and the reduced-motion ring are visual

## Acceptance Criteria

- [ ] Cockpit: with Guidance off, the crop box does not pulse; with it on, it pulses at zero focus points (red before, green after)
- [ ] Reduced motion: every pulse target shows a static ring; no animation
- [ ] Trim pulses through the hook; `data-trim-guide` and `trim-guide-pulse` are gone
- [ ] AC3 guard test green; Rule 7 grep recorded
- [ ] `.claude/knowledge/guidance.md` written and linked from CLAUDE.md
