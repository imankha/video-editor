# T5160: Keep First-Run Users On-Task During Export Wait (Quest 2)

**Status:** TODO
**Priority:** P2
**Impact:** 6 | **Complexity:** 1
**Reported:** NUF feedback 2026-07-15 (Item 2 of 3)

## Problem

Quest 2 "Frame Your Highlight" ends with `wait_for_export` ("Crisp It Up to 1080p"). Its
description tells the user to leave and frame another reel while the upscale runs:

> "We are upscaling your highlight to crisp 1080p. Feel free to go back home and frame your
> next reel while you wait."
> ([questDefinitions.jsx:177](../../src/frontend/src/config/questDefinitions.jsx#L177))

For a first-run user following the tutorial this is wrong: they have exactly **one** clip,
which they just sent to framing. Telling them to go frame "your next reel" sends them looking
for work that doesn't exist and risks losing them mid-flow. They should stay on this reel and
see the full first-reel creation through to the spotlight.

## Decision (from user)

**Reword for everyone** (pure copy edit — no conditional logic, no draft-count lookup). Anchor
the copy to this reel and point forward to the next step (the spotlight).

## Implementation

1. In [questDefinitions.jsx](../../src/frontend/src/config/questDefinitions.jsx), replace the
   `wait_for_export` description string. Suggested copy (final wording at implementor's
   discretion, keep it outcome-framed and jargon-free per the file header):

   > "We're upscaling your highlight to crisp 1080p — this takes a minute. Sit tight; next
   > you'll add a spotlight to your player on this same reel."

   Keep it a plain string (no new components needed). Do NOT reintroduce a "frame another
   reel" nudge.

2. `STEP_TITLES.wait_for_export` ("Crisp It Up to 1080p") can stay as-is.

## Out of scope

The "frame another reel while you wait" nudge could later be made **conditional** (only shown
to users with more than one draft reel). The user chose the simpler global reword for now; a
conditional variant is a possible future follow-up, not part of this task.

## Tests

Frontend: assert `STEP_DESCRIPTIONS.wait_for_export` no longer contains the "frame your next
reel" phrasing. This is a string change; no backend or trigger changes.

## Classification hint

S/M-tier, frontend copy only, single file, no schema/trigger/migration. Lint hook + targeted
test + commit. No agents required beyond a quick Reviewer if bundled with the others.
