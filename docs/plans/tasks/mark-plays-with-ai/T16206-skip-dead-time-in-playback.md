# T16206: Skip dead time when watching an AI Coach game

## In plain words

A youth game is full of dead time: the ball is out and being fetched, players set up a corner, the referee manages a wall. In the ten minutes we tested, the two model runs marked 27% and 44% of the clock as dead, and in the 98 seconds the owner timed by hand, 52 were dead. Since 2026-11-20 the AI Coach analysis (the paid option that has a video model mark the plays in a game) writes each of these stretches down as its own entry, with a start and an end, because that turned out to be what makes it cut plays cleanly. Today nothing uses them. We will let a parent watching a game that has AI Coach turn on "Skip dead time": playback jumps over each dead stretch and carries on at the restart. The app already does this kind of jump when a parent watches only their plays. Parents get a game they can watch in well under its full length, from work the analysis has already done. Done when a game with AI Coach plays through with the dead stretches skipped, a game without it has no such control, and turning it off plays every second as today.

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Tier:** M (frontend playback plus one read of data the analysis already stores)
**Created:** 2026-11-20

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Runs after T16190. Owner request 2026-11-20.

## Problem

The dead stretches are in the stored analysis and are thrown away on import: T16190 brings in plays, and a stoppage is not a play. A parent who paid to have the game watched still sits through every goal kick being set up.

## Solution

1. **The data.** The stored analysis keeps every stoppage entry, with its start and end in seconds. Nothing new is asked of the model. The dead stretches are read from the analysis when the game is opened; they are not copied into the parent's own data, so there is one copy.
2. **Who gets it.** A game the parent has AI Coach on (the entitlement from T16165, including a free share from T16202). No AI Coach, no control.
3. **The control.** One switch in the game's playback controls, "Skip dead time", off by default. The UI designer places it next to the existing way of watching only the plays.
4. **What skipping does.** When playback reaches a dead stretch it jumps to that stretch's end. Each stretch is shortened by a safety margin at both ends, so a second of live play is never jumped over; the margin comes from the measured error in T16145 (about two seconds so far). A stretch shorter than the two margins plus three seconds is not skipped. The timeline shows each dead stretch as a quiet gap, with its reason on hover or tap ("ball out of play", "setting up a restart"), so the parent can see what was skipped and click into one. The words for each reason are sport-neutral.
5. **Not saved.** The switch is how this parent is watching right now. It is not stored on the game or the profile.
6. **Measure.** `dead_time_skip_on` and `dead_time_skip_off`, so the Journey shows whether parents use it.

## Why this and not something else

Cutting the dead time out of the stored video was considered and dropped: it would change every play's time and cannot be undone if a stretch was wrong. A playback jump changes nothing. Offering it on every game, by detecting dead time some cheaper way, would need a second detector; the analysis already paid for this one.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/hooks/useVirtualTimeline.js`, `useAnnotationPlayback.js` (the existing plays-only playback; reuse its jump, do not build a second one)
- `src/frontend/src/containers/AnnotateContainer.jsx` (playback controls)
- the analysis read from T16150 and T16190 (`src/backend/app/routers/analysis.py`): return the stoppages with the entitlement check
- `src/backend/app/analytics.py` (two events)
- `.claude/knowledge/annotate.md` (read first)

### Technical Notes
- Dead time is the stored result's `dead_time` list: `{start_s, end_s, reason}` per range (T16145 step 7b). Read them through the same path that checks the purchase; never from the parent's SQLite.
- The switch is view state: keep it in memory. Do not persist it (owner rule: no persisted view state).
- Margins and the shortest stretch worth skipping are named constants in `constants/`, set from T16145's measured stoppage error.
- Marking a play by hand inside a dead stretch must still work; the switch only affects automatic playback, never seeking.
- A game with several videos: stoppage times are per video; map them through the same offsets the plays use.

### Related Tasks
- Depends on: T16150 (stoppages stored), T16165 (entitlement), T16190 (import and the analysis read). Related: T16145 (measures how accurate the stoppage times are).

## Acceptance Criteria

- [ ] On a game with AI Coach, with "Skip dead time" on, playback jumps from the start of each dead stretch (after the margin) to its end (before the margin) and continues playing.
- [ ] With the switch off, and on a game without AI Coach, every second plays as today; a game without AI Coach shows no switch.
- [ ] A dead stretch shorter than the minimum is not skipped.
- [ ] The parent can still seek into a dead stretch and mark a play there.
- [ ] The switch is not stored: after a reload it is off, and no request that writes is sent when it is toggled, other than the two analytics events.
- [ ] The dead stretches are read from the stored analysis with the purchase check; nothing is copied into the parent's own data.
