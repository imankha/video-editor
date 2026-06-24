# T3920: Reel Drafts Show Clip Game Time (Soccer Notation)

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-23
**Updated:** 2026-06-23

## Problem

Reel Draft cards don't show *where in the game* a clip came from. Parents identify a play
by its game time ("the goal at 38'"), so showing the clip's minute-and-second mark in
soccer notation (e.g. `38'45"`, or `45'+2` for stoppage) makes drafts scannable and lets
the user match a card to a moment they remember.

## Solution

Display the clip's start position in the source game on each Reel Draft card, formatted in
soccer notation (minute mark + seconds). Derive it from the clip's existing start time in
the game video — no new persisted field if the start offset is already available on the clip.

Open question for architecture: a "reel" can contain multiple clips and clips can come from
multiple games / two halves. Decide what to show per card:
- single-clip draft -> that clip's game time
- multi-clip draft -> first clip's time, or a range, or per-clip in an expanded view

Handle the unified two-half video model (T2750): the mark should reflect game time, which
may map onto first/second-half offsets.

## Context

### Relevant Files (REQUIRED — confirm during Code Expert pass)
- `src/frontend/src/components/**` — Reel Draft card component (the Drafts list)
- Clip data model — where the clip's start offset within the game video lives
- Existing time formatting utils (check for an mm:ss formatter to reuse before adding one)
- Two-half mapping logic from T2750 (Unified Multi-Video Experience)

### Related Tasks
- Related: T2750 (unified two-half video — game-time mapping), T3540 (draft card visuals)

### Technical Notes
- Display-only derivation from existing clip start time — no reactive persistence.
- Reuse any existing time-format helper rather than duplicating one (DRY).
- Decide soccer-notation format precisely (e.g. `MM'SS"`) and apply consistently.

## Implementation

### Steps
1. [ ] Code Expert: confirm the clip carries its game-relative start time; find the card
2. [ ] Decide single- vs multi-clip card display
3. [ ] Add/reuse a soccer-notation formatter
4. [ ] Render the mark on the Reel Draft card
5. [ ] Unit test the formatter + card rendering (incl. two-half offset)

## Acceptance Criteria

- [ ] Reel Draft cards show the clip's game time in soccer notation
- [ ] Correct for two-half / multi-video games
- [ ] Multi-clip draft behavior decided and consistent
- [ ] No new persisted field unless justified; display-only derivation
- [ ] Tests pass
