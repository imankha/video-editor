# T12430: "Play added" toast should fire after Done, not on Mark play

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Tier:** M
**Created:** 2026-10-10
**Updated:** 2026-10-10
**Found by:** User, human test of group g-t12370-3 (2026-10-10)

## Problem

Tapping Mark play creates the region and its backend row immediately (T10610 A.1) and opens the editor on it. `announcePlaySaved` ("Added play ..." / "Play added") fires from that create path in `AnnotateContainer.jsx` (~line 1589), so the confirmation appears while the user is still editing the play. It should appear after the user clicks Done.

## Solution

Move the `announcePlaySaved` call out of the create path and into the Done gesture handler for the editor. The persistence stays as is (create on Mark play); only the notification moves. Keep it gated on the real persistence result (raw_clip_id resolved), fire once, and do not fire if the user leaves the editor without Done (decide: cancel/delete). Do not touch the `project_created` branch (`notifyReelCreated`) unless it has the same timing problem; check and report.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/containers/AnnotateContainer.jsx` (`announcePlaySaved`, create path ~1570-1590, Done handler)
- `src/frontend/src/containers/AnnotateContainer.reelCreated.test.jsx`
- `.claude/knowledge/annotate.md`

### Related Tasks

- T9450/D5 (saved confirmation gated on real persistence), T9580 (bare-play toast), T10610 (create on Mark play).

## Acceptance Criteria

- [ ] Mark play shows no "Play added" toast
- [ ] Clicking Done shows it once, naming the play
- [ ] Test written first, fails against current behavior
