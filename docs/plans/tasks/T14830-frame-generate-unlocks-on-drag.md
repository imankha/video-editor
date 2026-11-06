# T14830: Frame: Generate unlocks on the first box drag; pressing Play becomes advice, not a lock (decision)

**Status:** WIP
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Prod Journey (2026-11-03): **Moved framing window 77 reached, 42 lost (1 stuck, 41 gone),
11 in window.** On the chart that is a 55% loss between dragging the box and exporting, the
worst ratio in the funnel. Part of that number is instrumentation (T14710: the Frame export
records no `export_completed`, so parents who exported but skipped Spotlight look lost here),
and T14710 must land first so the true loss is known. But the walk-through found a real
friction at exactly this spot that stays true whatever the corrected number is:

**Generate highlight is locked until the parent has dragged the box AND pressed Play.** The
lock label reads "Drag the box onto your player, then press Play, to unlock". In code
(`src/frontend/src/modes/FocusModeView.jsx` ~354-359): `stepsComplete = dragDone && hasPlayed`,
where `hasPlayed` is set when `isPlaying` first becomes true. The Play half was added on
2026-10-06 (commit eb77f3aa4, "locked Generate") together with the 5-step coach. The parent
usability audit ruling **F1 (2026-10-04) kept only the drag gate** (option D: "Set focus
point" button + coach chip, keep the T8510 gate); the Play requirement was never ruled on.

Why it costs exports: a parent who dragged the box and is happy taps the big teal Generate
card and nothing happens (it is disabled, with a caption). On a phone the caption is one line
under a card at the bottom of a scrolling screen. The 5-step coach does lead through Play and
Preview, but only while Guidance is on and only if the parent reads it; T14760 shows the
coach itself can stall on this screen.

## Solution (decision for the owner, then implement the ruled option)

Options, recommendation first:

- **A (recommended):** Generate unlocks on the first box drag (keeps ruling F1). Play and
  Preview stay in the coach as steps 2-4 and the Preview card keeps its "check the framing"
  caption, but neither locks Generate. The lock caption becomes "Drag the box onto your
  athlete to unlock".
- **B:** Keep both gates but make the locked card explain itself in place: tapping the
  disabled card pulses the Play button and shows the coach step ("Tap Play to check the
  framing, then Generate"). No analytics change.
- **C:** Keep as is; revisit after T14710 shows the true loss.

Copy follows the glossary (box, athlete, Sharpen my highlight once T14620 lands).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FocusModeView.jsx` - `hasPlayed`, `dragDone`, `stepsComplete`, lock caption
- `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx` - landscape-phone cockpit mirrors the gate
- `src/frontend/src/components/instructions/resolveGuide.js` + GUIDE copy table - `focus.progress.*` steps (step 2 "Tap Play" stays as advice)
- `src/frontend/src/modes/FocusModeView.*.test.jsx` - gate tests
- `docs/plans/tasks/parent-usability-audit/README.md` - ruling F1 (drag gate stays)

### Related Tasks
- Depends on: T14710 (so the before/after can be measured on real Exported counts). Can be implemented before it lands; the measurement comes after.
- Related: T14760 (Frame guidance starts at step 2 and stalls), T12630 (lock label), T8510 (original drag gate), T11700/T11710 (F1 implementation).

### Technical Notes
- `hasPlayed` is derived in render (no effect), keep that pattern if option B is chosen.
- Never persist any of these flags (view state).

## Implementation

### Steps
1. [ ] Decision page for the owner with the three options and a phone mock of A and B (ui-designer), citing ruling F1 and the 2026-10-06 commit.
2. [ ] Implement the ruled option; update the lock caption and the coach steps.
3. [ ] Vitest: with option A, Generate is enabled after a drag with no Play; coach step 2 still resolves. E2e: phone 390x844 drag then Generate.
4. [ ] After T14710 is on prod: record Moved framing window -> Exported before/after in this file.

### Progress Log

**2026-11-03**: Filed from the funnel walk (desktop and phone) + prod journey screenshot. Not started. Decision pending.

## Acceptance Criteria

- [ ] Owner has ruled A, B or C on a decision page; the ruling is recorded here.
- [ ] Under A: a parent who dragged the box can generate without pressing Play; Guidance still suggests Play and Preview.
- [ ] Lock caption and coach copy follow the glossary.
- [ ] Tests pass.
