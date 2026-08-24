# T7540: Annotate save: unsubmitted teammate tag makes Save silently refuse, in a loop

**Status:** WIP
**Priority:** P1 (strongest candidate for the 75% clip-creation cliff)
**Impact:** 7
**Complexity:** 2
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

In `AnnotateFullscreenOverlay.jsx` (~258-262), `handleSave` checks whether the teammate
tag input contains typed-but-not-committed text (user typed a name, never pressed Enter).
If so it shows a "Tag not submitted" dialog and RETURNS WITHOUT SAVING. Dismissing the
dialog with OK changes nothing; clicking Save again reproduces it indefinitely: a genuine
"Save does nothing" loop for any user who does not realize the tag field wants Enter.

Why this matters: the 2026-08-24 drop-off investigation found the clip-creation step is
the quietest, most damaging cliff: 3 of the 4 users who successfully uploaded gigabytes
opened the Add Clip form and produced ZERO clips (cschwartz78 returned four times over two
days and never saved one; jordark opened the form 28 seconds after his upload landed and
never saved). Hard save-gates and non-faststart video were ruled out with evidence. This
trap is the strongest remaining in-code candidate. There is no telemetry to confirm those
users hit it (see T7510), but the trap is real and reproducible regardless.

## Solution

Never dead-end a Save on an uncommitted tag. Preferred: `handleSave` COMMITS the pending
tag text automatically (same code path as pressing Enter) and proceeds with the save; the
dialog disappears entirely. If there is a product reason not to auto-commit (ambiguous
partial name?), the dialog must offer the resolution actions itself: "Add tag and save" /
"Save without tag", never just OK-and-nothing-happens.

Also sweep the same overlay for any other input with commit-on-Enter semantics that could
hold Save hostage the same way.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - handleSave
  ~258-262, the tag input component
- `src/frontend/src/containers/AnnotateContainer.jsx` - save flow context

### Related Tasks
- T7510 (attempted-vs-successful): would give the telemetry to see this trap firing
- Tutorial Redesign epic: the guided path will walk users through this exact form

### Technical Notes
- Real-browser verification required (drive-app-as-user), not jsdom: this is an
  interaction/focus bug class (memory: real browser for pointer/interaction fixes).
- Gesture persistence: auto-committing the tag inside handleSave is part of the same Save
  gesture; no new write paths.

## Acceptance Criteria

- [ ] Typing a partial tag then clicking Save saves the clip (tag committed or explicitly
      resolved via dialog actions); no path exists where Save produces only a dialog and
      no state change
- [ ] Real-browser test of the exact loop (type name, no Enter, Save)
- [ ] Sweep note listing other commit-on-Enter inputs checked in the overlay
