# T6250: Entering Overlay fires `overlay-data` 3x and `outdated-clips` 2x

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 2/6. See [EPIC.md](EPIC.md) for the capture and the StrictMode caveat.

## Problem

From the 2026-07-31 HAR, switching Framing -> Overlay on project 30:

| start | duration | request |
|-------|----------|---------|
| 44352 | 157ms | `GET /api/projects/30/outdated-clips` |
| 44354 | 156ms | `GET /api/export/projects/30/overlay-data` |
| 44355 | 155ms | `GET /api/projects/30/outdated-clips` |
| 44356 | 155ms | `GET /api/export/projects/30/overlay-data` |
| 44363 | 148ms | `GET /api/export/projects/30/overlay-data` |

Five requests inside 11ms where two would do. This is the same defect class T6190 fixed for
project-open — two owners fetching the same data — on a transition T6190 did not cover.

**`overlay-data` x3 cannot be StrictMode alone.** Dev double-invoke produces *even* multiples,
so an odd count proves at least two genuine owners (likely 2 owners with one double-invoked).
`outdated-clips` **x2 may well be StrictMode** and could be x1 in production — **verify against
a production build before changing that one.**

Unlike T6190's pair (which were ~685ms apart and sequential), these are 1-9ms apart and
genuinely concurrent — so an in-flight dedupe latch would collapse them. There isn't one on
either endpoint.

## Solution

1. Find every caller of `overlay-data` and `outdated-clips` on the Framing->Overlay path.
   Name them explicitly; do not guess from effect order (T6190's lesson: an `await import()`
   can reorder the wire relative to declaration order).
2. Reduce to **one owner per fetch**, per the epic rule. Prefer deleting the redundant caller
   over adding a cache.
3. Confirm the x2 on `outdated-clips` against a production build (`npm run build && npm run
   preview`) before treating it as real — if it is StrictMode, say so and leave it.

Do NOT add a blanket request cache or a longer-lived in-flight latch. That hides the second
owner rather than removing it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/OverlayScreen.jsx` — mount effects; note the T5670 comment at
  ~L99-102 (it already reads game info from the loaded projects list rather than refetching)
- `src/frontend/src/App.jsx` — `handleModeChange` (~L541); T6190 added `invalidateClips` here
  for the leave-annotate gesture — check whether the Overlay branch has an analogous owner
- `src/frontend/src/hooks/useProjectLoader.js` — the project-open fetch owner
- Backend handlers: `src/backend/app/routers/projects.py` (`outdated-clips`),
  `src/backend/app/routers/export/` (`overlay-data`)

### Related Tasks
- **T6190** — same defect class on project-open; reuse its approach (remove the extra owner,
  gesture-driven invalidation where a refresh is genuinely needed). Read its Progress Log for
  the trap that a mount refetch can race the mount itself.
- **T6190's regression** — moving a fetch earlier triggered a latent render loop in
  `FramingScreen`. If you change *when* a fetch fires here, re-check the console for
  `Maximum update depth exceeded`.

### Technical Notes
- The QA spec `src/frontend/e2e/T6190-project-open-fetches.qa.spec.js` already has a
  request-counting helper and a console-error guard — extend it rather than writing a new
  harness.
- `working_video/stream` is also fetched twice (t=37636 Framing, t=44335 Overlay), but those are
  different byte ranges (9.4MB then 1MB), which is normal player behaviour. Not part of this task.

## Implementation

### Steps
1. [ ] Enumerate every caller of `overlay-data` and `outdated-clips` on the Overlay entry path
2. [ ] Verify against a production build which counts survive (StrictMode check)
3. [ ] Remove the redundant owner(s); one owner per fetch
4. [ ] Extend the T6190 QA spec with Overlay-entry request counts
5. [ ] Re-capture and confirm the counts

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Call sites not yet traced.

## Acceptance Criteria

- [ ] Framing -> Overlay fires `overlay-data` exactly **once**
- [ ] `outdated-clips` fires once, OR is documented as StrictMode-only with production-build evidence
- [ ] Overlay still renders correctly (overlay data present, outdated-clip warnings still work)
- [ ] Request counts pinned by a test, alongside T6190's project-open counts
- [ ] No `Maximum update depth exceeded` on the transition
- [ ] Frontend unit tests pass
