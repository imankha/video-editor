# Epic F: One pulse path for the guide

**Status:** TODO
**Started:** 2026-10-14
**Milestone:** Deploy Candidate (P1), see PLAN.md
**Design (APPROVED 2026-10-14):** [T12730-design.md](../../T12730-design.md) · decision artifact: https://claude.ai/artifact/6TC43NGvgRsPZ8NBHG8TFG

## Goal

Every control a guide sentence tells the user to press pulses, only while Guidance is on, through
ONE mechanism. User request 2026-10-14: "centralize as much code around the handling of the CTA
or guidance system as possible."

Today a rule in `resolveGuide.js` returns a `pulse` label, and each of ~12 components applies
`coach-target-pulse` by hand with its own prop (`pulsePlay`, `pulseUpload`, `pulsePreview`,
`guidePulse`, `pulsePortrait`, `homePulse`, `pickPulse`, ...), its own Guidance gate and its own
class string. Focus maps step numbers to controls. Nothing checks that a named control pulses, so
screens drift. Found on staging 2026-10-14: the empty Games tab says "Tap Upload game" and the
button does not pulse. The 2026-10-14 audit found ~15 more sentences naming a control with
`pulse: null`, plus: the landscape Focus cockpit pulses the crop box with Guidance OFF
(`FocusCockpit.jsx:204` renders `CropOverlay` without `guidePulse`, so `CropOverlay.jsx:591-592`
falls back to `focusPointCount === 0`); "Tap Try again" names a control that does not exist;
reduced-motion users get no cue on most targets.

Target shape (design section 3): rules name `pulse: GUIDE_PULSE.X` or `noPulse: '<reason>'`;
each screen wraps its tree in `<GuideScope guides={[guide]}>`, which applies the Guidance gate
once; controls opt in with `guideTarget={GUIDE_PULSE.X}` (`Button`, `ActionCard`, automatic
disabled/locked suppression) or `useGuidePulse(GUIDE_PULSE.X, { suppress })`. The class string
lives only in `guideTargets.js` and `index.css`.

## Approved decisions (2026-10-14, all recommendations)

1. Focus ready: pulse Add spotlight.
2. Play editor: pulse Done.
3. "Tap one of several" (plays list, unfinished clips, Finished): pulse the first item.
4. "Tap Try again": pulse the export CTA and change the copy to "Tap {action} to try again."
5. The landscape cockpit ring follows Guidance.
6. Reduced motion: a static amber ring on every target.
7. The removed-prop grep covers `src/`, `e2e/`, `scripts/`; tests may assert the class name.

## Tasks (implement in this order, one `/dotask` group)

| ID | Task | Design commits | Status |
|----|------|------|--------|
| T12730 | [Foundation: Upload-game fix, characterization spec, GuideScope](T12730-foundation-guidescope.md) | C0, C1, C2 | TODO |
| T12740 | [Move Home and Annotate onto GuideScope](T12740-move-home-annotate.md) | C3a, C3b | TODO |
| T12750 | [Move Focus and Overlay onto GuideScope](T12750-move-focus-overlay.md) | C3c, C3d | TODO |
| T12760 | [Every named control pulses: fill the gaps, rule invariant, Try again copy](T12760-fill-missing-pulses.md) | C4a, C4b | TODO |
| T12770 | [Trim, reduced motion, cockpit, and the guard test](T12770-trim-motion-cockpit-guard.md) | C5, C6, C7 | TODO |

Moves (T12740, T12750) are behavior-preserving and separate from behavior changes (T12730 C0,
T12760, T12770), per CLAUDE.md Refactoring Rules 2-4. Each commit stays under ~200 lines of
meaningful diff.

## Sequencing with the rest of the milestone

Epic B (T12620, T12650, T12640, T12690) edits the same engine (`FloatingCoach`, `placement.js`,
`Guide.jsx`, `resolveGuide.js`). Start this epic after Epic B merges, and rebase onto master
before each move so the characterization spec runs against B's final behavior. Epic E's re-walk
covers this epic's screens.

## Completion Criteria

- [ ] All tasks merged to master
- [ ] Epic AC1-AC5 hold (listed in T12730's file)
- [ ] `src/frontend/e2e/T12730-guide-pulse.spec.js` green on the final revision
- [ ] New knowledge doc `.claude/knowledge/guidance.md` (entry points, GuideScope invariant, landmines) and a row in CLAUDE.md's knowledge table
