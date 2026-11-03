# T14760: Frame guidance starts at step 2 and stalls after Got it

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

User feedback (2026-11-03, phone, Frame on a "Great assist" play, Guidance on):

> "Guidance starts at step 2 of 5. Then after I targeted my player I couldn't get other guidance steps to load after I click Got It in the guidance pop up"

Two screenshots: (1) Frame with the box on the athlete, no guide card visible; (2) the same screen with the Guidance shade still dimming everything (tabs, header, video) but **no card on screen**. The parent is stuck: the screen is shaded and nothing tells them the next step or how to clear it, short of turning Guidance off.

Two bugs:

1. **Starts at step 2 of 5.** The first Frame step "Drag the box onto your athlete" (`focus.progress.drag`, step 1) is skipped. Likely cause: `dragDone = hasDragged || focusPointCount > 0` (`src/frontend/src/modes/FocusModeView.jsx` ~358). If the play opens with a position already set (AI-proposed box, or a position copied from an earlier highlight), `focusPointCount > 0` before the parent has touched the box, so the guide jumps to step 2 "Tap Play and watch your athlete". Confirm on the user's play, then decide: step 1 should still show until the parent has dragged or accepted the box in THIS session (or the sentence changes to "Check the box is on your athlete" when one is already placed).
2. **Got it leaves a shade with no card.** Got it on a floating card acknowledges that rule id in `guideFocusStore` (guidance.md invariant 7). If the user taps Got it on step 2 (Play) before playing, the facts don't change, the same rule still resolves, its card stays hidden, but the shade appears to remain. Expected: after Got it either (a) the shade lifts with the card (nothing dimmed while no card shows), or (b) the guide moves on to the next step that can be done. It must never shade the screen with no card. Also check whether the user's "after I targeted my player" means the drag itself should have advanced the guide and did not (the guide is already past step 1, so dragging changes nothing it watches).

## Solution

1. Reproduce on a phone viewport (390x844) with Guidance on, on a play that opens with a box already placed. Record which rule ids resolve before and after each gesture (drag, Got it, Play).
2. Root-cause both bugs (escalate to the expert agent if the Got it / shade path is not obvious on first read; FloatingCoach shade + acknowledge logic).
3. Fix:
   - Step 1 is not skipped by a pre-placed box (or shows the "check the box" variant).
   - An acknowledged rule never leaves the shade up without a card. After Got it the parent sees the next useful step, or a clean unshaded screen.
4. Copy follows the [Copy Vocabulary glossary](copy-vocabulary/EPIC.md): **box** (not crop box), **position** (not focus point/keyframe), **athlete** (not player), **Frame**, **Guidance**, **Make highlight** for the paid step, Tap not Click. If a new step-1 variant is needed, suggested: "The box is already on your athlete. Drag it if it isn't, then tap Play." Coordinate with T14620, which rewrites the `GUIDE.focus.*` sentences.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/FocusModeView.jsx` (~354-435) - `hasDragged`, `focusPointCount`, `dragDone`, `hasPlayed`, the facts handed to `resolveGuide`
- `src/frontend/src/components/instructions/resolveGuide.js` (~221-258) - `focus.progress.*` rules and their step numbers (1 drag, 2 play, 3 keep, 4 preview, 5 generate)
- `src/frontend/src/components/instructions/FloatingCoach.jsx` - shade, Got it, card hide; `guideFocusStore` acknowledge
- `src/frontend/src/config/displayNames.js` - `GUIDE.focus.*`, `STEP_LABEL`
- Tests: `components/instructions/FloatingCoach.shade.test.jsx`, `resolveGuide.pulseTargets.test.js`, `guideRules.pulse.test.js`, `src/frontend/e2e/guide-no-overlap.spec.js`

### Related Tasks
- Copy: T14620 (Frame and paid step copy, owns `GUIDE.focus.*` wording), T14640 (Guidance label). Runs right after the Copy audit milestone.
- T14750 (Annotate selected-play guidance) is in the same follow-up section.

### Technical Notes
- Knowledge docs: `.claude/knowledge/guidance.md` (invariants 2, 7, 9; Landmines), `.claude/knowledge/keyframes-framing.md` (how a play opens with positions).
- Pointer/touch behavior: verify in a real browser at phone size, not only jsdom.
- No persistence: guide state is render output plus the in-memory acknowledge store.

## Implementation

### Steps
1. [ ] Reproduce both bugs on a phone viewport; capture rule ids per gesture
2. [ ] Root cause (expert agent if non-obvious)
3. [ ] Failing tests: (a) a play opening with a placed box still resolves step 1 (or its variant); (b) after Got it on an unfinished step no shade without a card
4. [ ] Fix
5. [ ] Live-check phone 390x844 + desktop 1280x800: walk Frame steps 1 to 5 with Got it pressed at each step

### Progress Log

**2026-11-03**: Filed from user feedback with two phone screenshots (box on athlete; shade with no card after Got it).

## Acceptance Criteria

- [ ] Opening Frame with Guidance on shows step 1 of 5 first, including when a box is already placed
- [ ] Got it never leaves the screen shaded with no card
- [ ] After each gesture the guide advances to the next step that applies
- [ ] Guide copy uses glossary words (box, position, athlete, Make highlight)
- [ ] Relevant guidance tests pass
