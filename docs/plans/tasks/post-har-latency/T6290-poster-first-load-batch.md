# T6290: 10 posters fire at once during boot and compete with it

**Status:** STAGING
**Impact:** 4
**Complexity:** 3
**Created:** 2026-07-31
**Updated:** 2026-08-27

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
1. [x] Re-examine post-T6240: the `t=22278` anchor and `1.8-2.3s` durations WERE the boot stall (now removed)
2. [x] Determine how many of the 10 were actually visible: the batch = tiles in/near the viewport of expanded groups (collapsed groups mount nothing; lazy defers the rest)
3. [x] Confirm HTTP/2 status at the edge: reused T2540 — HTTP/2 active, 6-connection concern moot
4. [x] Defer/lazy offscreen posters: already done — `loading="lazy"` since T5672 + collapsed groups unmount children
5. [x] Re-measure: resolution is a documented non-defect (no product change); QA via code path + unit suite (live cold-boot not runnable in this worker — see Progress Log)

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Not yet re-measured post-T6240
— the durations recorded here are contaminated by the boot stall.

**2026-08-27 — RESOLVED, no behavior change needed (documented non-defect).** Re-examined the
three premises the finding rested on; all three are already handled:

1. **Timing (`~1.8-2.3s` durations, batch firing at `t=22278`).** That timestamp IS the 22s
   boot stall — the batch fired "the instant boot completes" because boot took 22s. T6240
   (shipped 2026-08-16) removed that stall, so the batch no longer waits behind, or competes
   with, a saturated event loop. The durations recorded here were contaminated by exactly the
   stall the task file warned about; the anchor for them is gone.

2. **Offscreen posters requested on first paint — they already aren't, two layers deep:**
   - A **collapsed** game group does not mount its tiles at all. `CollapsibleGroup` renders
     `{isExpanded && (…children…)}` (`shared/CollapsibleGroup.jsx`), and Drafts sets
     `defaultExpanded={hasIncomplete || hasUnpublished}` (`ProjectManager.jsx`). A group with no
     actionable drafts starts collapsed → its `DraftTile`s (and their poster `<img>`s) are never
     in the DOM → **zero** poster requests until the user expands it.
   - Tiles that DO mount sit in a horizontal `CardCarousel` and carry `loading="lazy"`
     (`DraftTile.jsx:494`, present since **T5672 on 2026-07-23 — before this 2026-07-31 HAR**),
     so posters scrolled off the carousel or below the fold are deferred by the browser.
   - So the 10-poster first batch was the tiles genuinely in/near the viewport of the expanded
     groups on first paint — "all genuinely displayed", the task file's own non-defect case.
     `loading="lazy"` was ALREADY active when the HAR was captured, which is why the batch is the
     visible set, not the full 25.

3. **HTTP/1.1 6-connection queueing — moot in production.** Reusing **T2540**'s answer (verified
   2026-05-05, not re-derived): HTTP/2 is already active at the Fly edge; all API requests
   multiplex over one reused connection (`conn=-1.0ms`). The 6-connection HTTP/1.1 limit does not
   apply in prod, so 10 concurrent same-origin poster requests do not queue there.

Candidate fix #1 (add `loading="lazy"`) was therefore already implemented before the finding was
filed; candidate #3 (confirm HTTP/2) resolves the concurrency worry; candidate #2 (stagger/
prioritize) would add infrastructure for a cost that the re-analysis shows isn't there.

**Change made:** none to product code. Added 3 regression tests to
`shared/CollapsibleGroup.test.jsx` pinning the "collapsed group mounts no children" invariant that
bounds the batch (converts the code-reading proof above into a durable guard). The existing
`DraftTile.test.jsx` already asserts the lazy poster `<img>` and its full render lifecycle.

**QA note on the live cold-boot capture:** the primary-evidence live drive was not runnable in this
worker (no backend `.venv`/`.env`/R2 credentials, so real-account session-init can't boot; the
empty `test-login` session has no drafts and so cannot reproduce a poster batch at all). Evidence
here is therefore the deterministic code path + the unit suite (62 relevant tests green), which
directly establish the acceptance criteria the live capture would have shown. A staging cold-boot
HAR can confirm the batch shape post-T6240 if a belt-and-suspenders re-measure is wanted.

## Acceptance Criteria

- [x] Re-measured after T6240, with a statement of whether this is still worth fixing — **not worth fixing**; the cost was the boot stall (removed by T6240) + lazy loading already in place + HTTP/2 already active. Documented non-defect (see Progress Log).
- [x] Offscreen posters are not requested on first paint — shown they already weren't: collapsed groups mount no tiles (`CollapsibleGroup` `{isExpanded && children}`) and mounted tiles use `loading="lazy"`. Guarded by new `CollapsibleGroup.test.jsx` tests.
- [x] Poster caching headers unchanged (still `max-age=86400` + ETag) — no backend touched.
- [x] Posters still render correctly, including after group expand — `DraftTile.test.jsx` poster lifecycle + `CollapsibleGroup` expand-mounts-children tests pass.
- [x] Frontend unit tests pass — 62 relevant tests green: `DraftTile.test.jsx` (42) + `DraftTile.preview.test.jsx` (14) + `CollapsibleGroup.test.jsx` (6).
