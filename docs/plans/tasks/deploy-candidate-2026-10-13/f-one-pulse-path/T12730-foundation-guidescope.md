# T12730: Foundation: Upload-game fix, characterization spec, GuideScope

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-10-14
**Updated:** 2026-10-14
**Epic:** [F. One pulse path for the guide](EPIC.md) · **Design:** [T12730-design.md](../../T12730-design.md) (APPROVED)

## Problem

See EPIC.md. This task lays the ground the moves stand on: today's staging fix, a spec that pins
today's pulses, and the central mechanism added beside the old one.

## Solution (design commits C0, C1, C2)

- **C0 (behavior, AC5):** apply [T12730-upload-game-pulse.patch](T12730-upload-game-pulse.patch)
  (`git apply`). It was written 2026-10-14 in the shared tree against master @ 858af9c69 and then
  removed from the tree. The patch adds `pulse: 'upload-game'` to `home.games.empty`, a `pulseUpload`
  prop on `EmptyTabGuide` (applied to the Upload game button), passes it from `ProjectManager`, and
  adds a case to `resolveGuide.homePulse.test.js`. Show it red on the base revision, green after.
- **C1 (tests only):** `src/frontend/e2e/T12730-guide-pulse.spec.js` per design section 6: one test
  each for Home (empty Games, Upload game), Annotate (Mark play), Focus (crop box, then Play),
  Overlay (pick halos). Each asserts `toHaveClass(/coach-target-pulse/)`, then turns Guidance off
  and asserts zero `.coach-target-pulse`. Green on C0. Record what it cannot prove.
- **C2 (additive facade):** `components/instructions/guideTargets.js` (`GUIDE_PULSE`,
  `GUIDE_PULSE_CLASS`), `components/instructions/GuideScope.jsx` (`GuideScope`, `useGuidePulse`),
  rules switch to `GUIDE_PULSE` constants, Focus rules get explicit targets and the two trim rules
  get an explicit `phase` (else `data-phase` changes). Update every `guide.pulse === '...'` and test
  literal to constants in the same commit. Comparison test: each `GUIDE_STATES` entry's pulse equals
  a hand-reviewed table of today's targets.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js`, `guideTargets.js` (new), `GuideScope.jsx` (new)
- `src/frontend/src/components/ProjectManager.jsx`, `components/shared/EmptyTabGuide.jsx` (C0)
- `src/frontend/src/modes/FocusModeView.jsx`, `AnnotateModeView.jsx`, `OverlayModeView.jsx` (constant swaps only)
- `src/frontend/e2e/T12730-guide-pulse.spec.js` (new); helpers `e2e/helpers/realAuth.js`, `gameDetails.js`, `annotateClips.js`, `framingDraft.js`, `overlayDraft.js`

### Curated tests
`instructions/GuideScope.test.jsx` (new), `instructions/resolveGuide.states.test.js`,
`resolveGuide.homePulse.test.js`, `resolveGuide.pickPulse.test.js`, `resolveGuide.job.test.js`,
`components/ProjectManager.guidePulse.test.jsx`, `modes/FocusModeView.guidedSteps.test.jsx`,
`modes/AnnotateModeView.cta.test.jsx`, e2e `T12730-guide-pulse.spec.js`.

### Related Tasks
- Depends on: Epic B merged (same engine)
- Blocks: T12740, T12750, T12760, T12770

## Acceptance Criteria (epic-wide; this task owns AC5 and the C1/C2 pieces of AC4)

- AC1: With Guidance on, every control a guide sentence tells the user to press pulses (or the rule has a documented `noPulse` reason). With Guidance off, nothing pulses.
- AC2: A unit test fails if a `GUIDE_RULES` entry has neither a pulse target nor a `noPulse` reason.
- AC3: No component outside the central mechanism contains `coach-target-pulse` or a `coachEnabled &&` pulse gate; removed prop names absent from `src/`, `e2e/`, `scripts/`.
- AC4: Existing pulse behavior is preserved through the moves (characterization spec green before and after).
- AC5: Empty Games tab: Upload game pulses with Guidance on.

This task: [ ] AC5 red-to-green · [ ] C1 spec green on C0 · [ ] C2 lands with no visible change (comparison test + spec green)
