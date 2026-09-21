# T10830: Extract FocusTimelineBlock from FocusModeView's two call sites

**Status:** STAGING
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-09-21
**Epic:** [focus-landscape](EPIC.md) — 1 of 3
**Design:** [T10840-design.md](T10840-design.md) section 1.4

## Problem

`modes/FocusModeView.jsx` renders `FocusMode` (the whole framing-timeline block) **twice** —
once at ~line 670 for the ordinary layout and once at ~line 780 inside the `mobileFs` overlay —
with roughly 30 duplicated props threaded through both.

T10840 adds a **third** call site (the cockpit's timeline strip). Per the house refactoring rule
("abstract on the 3rd duplication") that is exactly the point at which the duplication should
collapse — and per "moves are mechanical commits, code motion never mixes with behavior change",
it has to happen in its own commit, before the cockpit exists.

## Solution

Extract the duplicated JSX + prop bundle into `modes/focus/FocusTimelineBlock.jsx` and call it from
both existing sites. **Pure code motion. Zero behavior change. Zero test edits.**

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/modes/FocusModeView.jsx` — the two call sites (~line 670 and ~line 780); 1026 lines today
- `src/frontend/src/modes/focus/FocusTimelineBlock.jsx` — **new**, the extracted block
- `src/frontend/src/modes/focus/FocusMode.jsx` — read only; the component being wrapped
- `src/frontend/src/modes/focus/FocusTimeline.jsx` — read only; `FocusMode`'s child, unchanged
- `src/frontend/src/modes/focus/FocusTimeline.test.jsx` — must pass unedited
- `src/frontend/src/modes/FocusModeView.framingActionRow.test.jsx` — must pass unedited
- `src/frontend/src/modes/FocusModeView.advancedEditing.test.jsx` — must pass unedited

### Related Tasks

- Blocks: T10840 (shared file `FocusModeView.jsx`)

### Technical Notes

- The two call sites are **not** prop-identical — diff them first. Where they differ (the `mobileFs`
  site suppresses some chrome), the difference becomes a prop on `FocusTimelineBlock`, not a
  branch baked inside it.
- Keep the prop names exactly as they are today. Renaming is behavior-adjacent churn that makes the
  diff unreviewable and breaks the "mechanical" property.
- `showSegments` (T9950 slice 1) defaults to `true` so every existing caller stays byte-identical.
  Preserve that default through the extraction.
- The reviewable unit should be well under ~200 lines of meaningful diff. If it is not, the
  extraction is doing too much — pull it back.

## Implementation

### Steps

1. [ ] Branch `feature/T10830-extract-focus-timeline-block`
2. [ ] Diff the two `FocusMode` call sites; list every prop and every difference
3. [ ] Create `modes/focus/FocusTimelineBlock.jsx` taking that union as props
4. [ ] Replace both call sites
5. [ ] Run the relevant set (below) — expect green with **no test file edited**
6. [ ] Commit with the `T10830:` subject prefix and the co-author line

### Test Scope (relevant set, ~6 files — never the whole suite)

```
cd src/frontend && npx vitest run \
  src/modes/focus/FocusTimeline.test.jsx \
  src/modes/focus/FramingActionRow.test.jsx \
  src/modes/FocusModeView.framingActionRow.test.jsx \
  src/modes/FocusModeView.advancedEditing.test.jsx \
  src/components/CropOverlay.test.jsx \
  src/screens/__tests__/focusScreenStaleClipGuard.test.jsx \
  2>&1 > /tmp/T10830-tests.log; echo "exit: $?"
```

### Progress Log

**2026-09-21**: Filed from the Focus landscape design session. Not started.

## Acceptance Criteria

- [ ] `FocusMode` has exactly one call site in `FocusModeView.jsx`, via `FocusTimelineBlock`
- [ ] **No test file was edited** — the relevant set is green as-is
- [ ] `git diff --stat` shows no change outside `FocusModeView.jsx` and the new file
- [ ] Meaningful diff < ~200 lines
- [ ] Lint hooks clean
