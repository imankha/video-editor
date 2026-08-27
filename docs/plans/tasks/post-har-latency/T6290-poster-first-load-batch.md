# T6290: 10 posters fire at once during boot and compete with it

**Status:** WIP
**Impact:** 4
**Complexity:** 3
**Created:** 2026-07-31
**Updated:** 2026-07-31

Epic task 6/6. See [EPIC.md](EPIC.md).

## Problem

The 2026-07-31 session fetched **25 poster images**, 60-78KB each. The first batch — 10
`/api/projects/{id}/poster.jpg` requests — all start at **t=22278**, immediately as the boot
storm releases, and each takes 1.8-2.3s. A later batch of 4 starts together at t=89278
(736-937ms each).

Two separate issues:

1. **Timing.** The first batch fires the instant boot completes, competing for connections at
   the worst moment (see T6240 — the backend was already unresponsive for 22s).
2. **Concurrency.** 10 simultaneous same-origin requests exceed the browser's ~6-connection
   HTTP/1.1 limit, so some queue. Whether this matters in production depends on HTTP/2 being in
   effect at the Fly edge — **that is T2540's question; reuse its answer rather than
   re-deriving it.**

**Caching is already correct** and is not the problem: posters send
`Cache-Control: private, max-age=86400` with an ETag, so repeat visits are cheap. This is a
first-load cost only.

## Solution

Measure before changing anything — a first-load cost that only appears behind a 22s backend
stall may substantially resolve when T6240 lands. **Re-capture after T6240 and confirm this is
still worth fixing.**

If it is, candidates in preference order:

1. **Only fetch posters that are actually visible.** `ReelTile` already uses `loading="lazy"`;
   check whether the Drafts poster batch does the same, and whether the collapsed-group
   structure means offscreen posters are being requested anyway.
2. **Stagger or prioritize** — the poster for the "continue where you left off" card matters
   more than the tenth tile in a collapsed group.
3. Confirm HTTP/2 at the edge (T2540) before treating the 6-connection limit as real in prod.

Do not add a service-worker cache or a bespoke image cache for this — the HTTP cache is already
doing its job.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx` — draft poster rendering
- `src/frontend/src/components/collections/ReelTile.jsx` — already uses `loading="lazy"`; the
  reference for how it should be done
- `src/backend/app/routers/projects.py` / `downloads.py` — poster handlers (already send
  `max-age=86400` + ETag; do not change that)
- `.claude/knowledge/persistence-sync.md` — poster warming/backfill background

### Related Tasks
- **T6240** — do it first; re-measure this afterwards. The 1.8-2.3s durations here are
  contaminated by the boot stall.
- **T2540** (`tasks/page-load-optimization/T2540-verify-http2-fly-edge.md`) — HTTP/2
  verification. Reuse, do not duplicate.
- **T5671-T5683** (UI Pass epic) — introduced the poster card-key architecture and deferred
  slivers; the lazy-loading conventions live there.

### Technical Notes
- A prior task (T3760) established that an apparent over-fetch was a HAR misread and R2 deep
  reads are fast. Do not assume slow == broken; measure.
- 25 posters in one session is not inherently wrong if they were all genuinely displayed. Check
  how many were actually on screen before calling it waste.

## Implementation

### Steps
1. [ ] Re-capture a cold boot AFTER T6240; confirm the batch is still slow
2. [ ] Determine how many of the 10 were actually visible on screen
3. [ ] Confirm HTTP/2 status at the edge (per T2540)
4. [ ] Defer/lazy offscreen posters; prioritize above-the-fold ones
5. [ ] Re-measure first-load poster cost

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Not yet re-measured post-T6240
— the durations recorded here are contaminated by the boot stall.

## Acceptance Criteria

- [ ] Re-measured after T6240, with a statement of whether this is still worth fixing
- [ ] Offscreen posters are not requested on first paint (or it is shown they already weren't)
- [ ] Poster caching headers unchanged (still `max-age=86400` + ETag)
- [ ] Posters still render correctly, including after group expand
- [ ] Frontend unit tests pass
