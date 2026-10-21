# T13280: Annotate gives no way to see or jump between the videos of a multi-video game

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Tier:** M (frontend; needs a small design decision first)
**Created:** 2026-10-21
**Updated:** 2026-10-21
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

User tested T13040 on 2026-10-21: after adding footage to a game they could not find "a way of flipping between video sources".

## Problem

Comparing the original add-footage tasks (T8910, T8890, T8900, T9350) with the code:

- **Overlapping footage (angles):** T8890 built source switching (`Main camera | {angle}` pill, angle strip, `switchSource`). It only renders when footage overlaps the main camera in time (`sourcesAt(playhead).length >= 2`).
- **Sequential or appended footage (a second half, a second card, footage with no timestamp):** by design this is one continuous virtual timeline, so there is nothing to switch. The only visual cue that a second video exists is the T2750 boundary marker in `AnnotateTimeline.jsx`: a 1 px line at 30% opacity (`w-px bg-gray-500/30`), effectively invisible. The main track carries no per-video label, and there is no list of the game's videos anywhere in Annotate.

So for the most common case (add the second half) a user has no way to see that there are two videos, where the second starts, what it is called, or to jump to it. T8910's "Add footage" gives landing feedback once (toast) and then the information is gone.

## User minimums (2026-10-21, after testing)

1. The user can **see the different video sources** of the game in Annotate.
2. The user can **flip between sources at any point on the timeline where they intersect** (overlap in time), not only via the first-seen angle pill.

These are the floor for this task; the options below are ways to meet them. Check first why the existing angle switcher (T8890) did not show for the user's footage: either it landed by prefix-sum (amber, no overlap known) or the overlap was not detected. If the user's two videos genuinely cover the same wall-clock time, the switcher failing to appear is a separate bug to root-cause here.

## Solution

Needs a small design decision (propose 2 options with mocks, per the decision-artifacts rule, before building):

- **A:** label each video on the main track (name + start time) with a visible boundary tick, tap to seek to its start.
- **B:** a "Videos in this game" list (name, duration, start time, tap to jump, Fix timing entry) reachable from the timeline header, plus a visible boundary.
- Both keep the angle pill for true overlaps and must not change angle-free single-video games (the epic's common-case guard).

Gesture rules: jumping is a seek, not a write. Nothing here persists.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/AnnotateTimeline.jsx` (`boundaryOffsets` markers ~L318-330)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js` (`buildFullVideoTimeline`, `buildGameTimeline`, `videoDisplayName`)
- `src/frontend/src/modes/annotate/AngleSwitcherBadge.jsx`, `AngleLanes.jsx` (existing angle UI to stay consistent with)
- `src/frontend/src/containers/AnnotateContainer.jsx`, `src/frontend/src/modes/AnnotateModeView.jsx`
- `.claude/knowledge/annotate.md` (T8880/T8890 sections)

### Related Tasks
- Original specs: T8910, T8890, T8892, T8900, T9350, T10770 (multi-video entry check)
- Found while testing T13040
- Sibling: T13270 (amber landing feedback)

## Acceptance Criteria

- [ ] A multi-video game shows each video's boundary and name on the Annotate timeline, visible at 390 and 1440
- [ ] The user can jump to the start of any video of the game with one tap
- [ ] Single-video games render byte-identically (existing equivalence test still passes)
- [ ] Overlap games keep the angle pill and strip unchanged
- [ ] A frontend test covers the labels and the jump
