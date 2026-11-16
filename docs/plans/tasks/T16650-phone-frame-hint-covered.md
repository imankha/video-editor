# T16650: On a phone the Frame screen hides the rotate hint and the empty-timeline message overlaps the playhead

**Status:** WIP
**Impact:** 4
**Complexity:** 2
**Created:** 2026-11-16
**Updated:** 2026-11-16

## In plain words

On a phone (390x844) the Frame screen has a hint card that says to rotate the device for a larger video. Its title is cut off because the video controls cover its top half. The message "No positions yet. Drag the box..." runs across the playhead line and the track label column.

## How we got here

Found on staging on 2026-11-16 in the same walk as the other Frame layout bugs.

## Solution

Make the hint fully visible, or dismissible, and keep the empty-timeline message clear of the playhead and the labels.

## Why

Parents on a phone see these two messages first; if they are cut off, parents do not learn that rotating helps or how to place the first crop position.

## Relevant Files

- the Frame screen under src/frontend/src/screens/
- the rotate hint and the timeline empty-state components

## Acceptance Criteria

- [ ] C1: At 390x844 the rotate hint is fully readable and not behind the video controls, or can be dismissed.
- [ ] C2: At 390x844 the empty-timeline message does not overlap the playhead or the track labels.
