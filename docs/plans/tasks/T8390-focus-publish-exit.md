# T8390: Focus gets a publish exit (guided-path R3)

**Status:** TODO (spawned briefly 2026-09-02, zero real progress before a quota gap; container reaped. Held per user order: Tutorial Redesign group waits for Next Up's UI-visible tasks to clear first — see PLAN.md's Tutorial Redesign section note)
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-02

App design change **R3 from the approved T7620 guided-Help design** (user accepted
2026-09-02; rationale + rule wiring in [T7620-design.md](T7620-design.md) sections 17
and 17.1). Filed as a standalone task per the design's argument: it is a product win on
its own, keeps T7630's reviewable units sane, and rebases safely around T8360/T8350.

## Problem

Focus is a genuine dead end at the framed-to-published transition: after a user finishes
framing and exporting a clip there is no on-screen path toward publishing the reel - they
must know to navigate elsewhere. The T7620 per-screen intent analysis rates this the
highest-value screen fix of the set: guided-path rule 30 (the L3-to-L4 advance) currently
has nothing real to anchor to, and without R3 the guide can only narrate navigation.

## Solution

Give Focus an explicit publish exit per the design: a clear post-export affordance that
takes the user toward publishing the reel this clip belongs to. Exact placement/copy get
a quick ui-designer pass consistent with T7580's Focus naming and the T8360 surface
outcome. Must carry `data-tutorial-target="focus-publish"` (literal - guided rule 30
anchors here).

## Context

### Relevant Files (anticipated)
- `src/frontend/src/screens/FocusScreen.jsx` (and its container/view split) - the
  post-export state
- `src/frontend/src/config/displayNames.js` - button copy
- e2e spec for the Focus flow

### Related Tasks
- From: [T7620-design.md](T7620-design.md) R3 (sections 17/17.1)
- Blocks: **T7630** (guided-path implementation anchors rule 30 to this)
- Sequencing (recorded in T7620-design.md 18.3): R3, R4 -> T8360 -> T8370 -> T8380 ->
  T7630 -> T7640
- Related: [T8400](T8400-publish-lands-on-reel.md) (R4, sibling)

## Acceptance Criteria

- [ ] A user finishing in Focus has a visible, one-tap path toward publishing
- [ ] `data-tutorial-target="focus-publish"` present (literal, greppable)
- [ ] ui-designer-consistent placement/copy; responsive at 375px
- [ ] Tests pass (unit + the Focus e2e updated)
