# T8560: Persistent journey stepper (design gate)

**Status:** FOLDED
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-03
**Updated:** 2026-09-03 (Architect design gate resolved: FOLD, user-approved 2026-09-03.
Full rationale, discriminator analysis, and the rejected standalone-stepper fallback spec:
[T8560-design.md](../T8560-design.md). The stepper is not a second system - it is T7620's
already-approved 5-rung goal ladder, unnamed and only half-drawn. Its substance (naming the
rungs + showing the whole map) is folded into T7620's design as "Round 3" and into T7630's
build scope. Zero product code ships from this task; nothing further to do here.)

## Problem

Every "where am I / what now?" moment in the 2026-09-02 walkthrough (locked Focus,
invisible reel, surprise Overlay, manual Move) is an orientation failure. The UX expert
proposed a persistent 4-stop journey stepper (Upload, Mark plays, Focus, Share) rendered
on every screen, showing where the user stands for the active game/reel.

## Solution

Design-gated (Architect/ui-designer): produce the design doc BEFORE implementation,
because this overlaps two in-flight systems:

1. The Tutorial Redesign guided-tour engine (T7620 approved design: shade + arrow
   anchored steps advancing on real actions). A stepper and a guided tour are different
   tools (persistent orientation vs first-run instruction) but must not compete; the
   design must define how they coexist (e.g. stepper is the always-on map, tour anchors
   TO stepper nodes) or explicitly fold the stepper into the tour's scope and close this
   task.
2. T8130's locked vocabulary (Plays / Clips / Highlight Reels): stop labels must use it.

Design questions: which stops (Upload, Mark Plays, Focus, Share), what entity the
stepper tracks on multi-reel accounts, mobile presentation at 320px, and whether it
hides for accounts past first-reel (probably yes: orientation scaffold, not chrome).

## Context

### Relevant Files (REQUIRED)
- Design doc target: `docs/plans/tasks/T8560-design.md`
- `.claude/knowledge/annotate.md`, tutorial-redesign EPIC.md + T7620-design.md (read first)
- Mode header components (`src/frontend/src/components/shared/ModeSwitcher.jsx`) as the
  likely mount point - note its availability model (Focus needs a selected project via
  useAppState; Overlay additionally needs a working/overlay video): the stepper's
  step-state can derive from the SAME inputs plus draftStage.js stages, no new state

### Related Tasks
- Blocked by nothing technically; sequenced LAST in the epic, immediately before the
  Tutorial Redesign group starts, so the tour design consumes its outcome
- If the design verdict is "fold into guided tour", record it and close as OBSOLETE

## Implementation

### Steps
1. [x] Read T7620-design.md + this epic's landed state
2. [x] Design doc with the coexistence decision + mockups (user approval gate) - verdict: FOLD
3. [x] Implement per approved design (or close as folded) - closed as FOLDED, no implementation

## Acceptance Criteria

- [x] Explicit approved decision on stepper vs guided-tour coexistence - **FOLD** (user-approved
      2026-09-03; see T8560-design.md)
- [ ] ~~If built: visible on every journey screen, correct at 320px+, uses T8130 vocabulary~~ N/A
      under FOLD - this criterion's substance ships instead as T7620/T7630's Round 3 amendment
