# T6280: Small double-fires — `rank/confidence` x2 and `games/{id}/video` 302 x2

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 5/6. See [EPIC.md](EPIC.md) — **the StrictMode caveat is the whole story for this
task.** Both findings are x2, so both may be x1 in production. Verify against a production build
FIRST; a written-up "StrictMode only, no action" is a successful outcome.

## Problem

Two small duplicate pairs in the 2026-07-31 HAR:

**1. `GET /api/rank/confidence` x2** — both at t=87807, both 142ms. Identical start
millisecond, identical duration. A clean double-fire from one trigger.

**2. `GET /api/games/6/video` 302 x2** — t=54756 (90ms) and t=54767 (83ms), with
`GET /api/games/6/load` (87ms) between them. Each pays a redirect before the media request. This
one is worth checking even if it is "just" the video element, because a duplicated 302 on a
media URL can mean two `src` assignments — which also means two connection setups and,
potentially, two range-request chains.

## Solution

1. **Production-build check first** (`npm run build && npm run preview`, capture again). If both
   collapse to x1, write that up and close the task. Do not restructure code to fix a dev-only
   artifact.
2. For anything that survives: find the trigger and reduce to one. `rank/confidence` firing
   twice in the same millisecond suggests either two subscribers or an effect without a guard.
3. For `games/{id}/video`: check whether the video element's `src` is assigned more than once
   (or assigned then immediately reassigned) during game load.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/rankConfidence.js` + its callers (grep `rank/confidence`)
- `src/frontend/src/components/ranking/` — the ranking surfaces that consume confidence
- Game video loading: grep `games/${...}/video` and `/load` in the annotate path
- `src/backend/app/routers/games.py` — the `video` 302 handler

### Related Tasks
- **T6250** — same duplicate-fetch family; if you are already tracing owners there, these may
  share a root cause (a component mounting twice).
- **T6240** — unrelated in mechanism, but the `/api/games` x8 burst at t=81739 should be
  re-checked after T6240 lands and may belong here if it survives.

### Technical Notes
- Two requests at the *same* millisecond are almost never a user gesture firing twice — look for
  a component rendering twice or two independent subscribers, not a double click.
- Keep the fix proportional. This is the lowest-impact task in the epic; if the cause turns out
  to be structural (e.g. a shared component mounted in two places by design), file it rather
  than forcing a fix here.

## Implementation

### Steps
1. [ ] Capture against a production build; record which duplicates survive
2. [ ] For survivors, identify the trigger
3. [ ] Reduce to one request per gesture
4. [ ] Re-capture to confirm

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Production-build check not
yet done — both findings may be dev-only.

## Acceptance Criteria

- [ ] Each finding is either fixed, or documented as StrictMode-only with production-build evidence
- [ ] Any fix is pinned by a request-count assertion
- [ ] Ranking confidence and game video loading still work
- [ ] Frontend unit tests pass
