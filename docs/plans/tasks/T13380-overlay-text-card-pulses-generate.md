# T13380: Overlay text step names the text field but pulses Generate and shades the field

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Tier:** S (frontend guide rules)
**Created:** 2026-10-25
**Updated:** 2026-10-25
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-25 ([RESULTS.md section 11](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)). Screenshots are local only (`r3-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk).

## Problem

On Overlay, tapping Add text shows "Type a name, number or caption, then drag its ends on the timeline to set when it shows." (`overlay.text`, noPulse). At the same time the other Overlay channel keeps pulsing "Generate highlight with spotlight", so the shade cuts out Generate and dims the text field and timeline the sentence names. The user is pointed at the export button while being told to type. Seen at 1440 (r3-overlay-text-1440).

## Solution

While the text sheet is open, the text rule owns the screen: no other channel pulses, and the text field and timeline are cut out of the shade (keepClear).

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js` (`overlay.text`, the pick and job channels)
- `OverlayModeView` (two guide channels; see `.claude/knowledge/guidance.md`, "Overlay has two channels")

### Related Tasks
- Found by T12590 (2026-10-25 re-walk)

## Acceptance Criteria

- [ ] With the text sheet open, nothing else pulses and the text input and timeline are not shaded
- [ ] A rule test pins it
