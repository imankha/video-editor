# T6280: Small double-fires — `rank/confidence` x2 and `games/{id}/video` 302 x2

**Status:** WIP
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
1. [x] Capture against a production build; record which duplicates survive — no live capture
       possible (container has no backend/R2); used deterministic no-StrictMode request-count
       tests as the production-semantics proxy instead
2. [x] For survivors, identify the trigger — neither survives as a defect: rank/confidence x2 is
       two aspect ratios (by design); video 302 x2 is a dev-StrictMode artifact
3. [x] Reduce to one request per gesture — already one per gesture in production (guards predate
       the HAR); no source change needed
4. [x] Re-capture to confirm — pinned by request-count assertions (see Progress Log)

### Progress Log

**2026-07-31**: Filed from the post-T6190/T6200 verification HAR. Production-build check not
yet done — both findings may be dev-only.

**2026-08-27 (resolution — both findings are non-defects, no source change):** Both duplicate
guards already existed in the code AT the time the HAR was captured (`beginGameVideoLoad` gameId
dedup + breadcrumb pre-seed landed 2026-06-26 `2b4634d3e`; `rankConfidence` per-ratio in-flight
dedup landed 2026-07-09 `71b361064`; HAR is 2026-07-31). So neither x2 is an unguarded double —
each was traced to a benign cause. The container had no backend/R2, so a live production-build
capture was not possible; instead each finding is pinned by a deterministic **request-count
assertion** rendered at production effect semantics (a prod build makes `<StrictMode>` a no-op
passthrough — effects run once, exactly as these tests run them: no StrictMode wrapper).

**Finding 1 — `GET /api/rank/confidence` x2 → BY DESIGN, not a duplicate.**
`ConfidenceBanner` (mounted once, in `DownloadsPanel` / My Reels) reads confidence for BOTH
aspect ratios (`RATIO_ORDER = [portrait, landscape]`) via `Promise.all` — two *distinct* requests
with different `?aspect_ratio=` params. The HAR grouped them by path (`/api/rank/confidence`), so
they looked identical, but they are portrait + landscape. The per-ratio in-flight dedup (T4775)
already collapses the dev-StrictMode double to exactly one request *per ratio*. Production count:
2 (one per ratio, legitimate). No second subscriber exists (`RankingGame`'s probe only runs when
the game is opened *from* the banner, not at My Reels open).
Evidence: `src/components/ranking/__tests__/ConfidenceBanner.requestCount.test.jsx` — a single
mount fires exactly 2 requests with *distinct* aspect_ratio params (asserts `new Set(urls).size
=== 2`), plus the existing `rankConfidence.test.js` "does NOT dedup across different ratios".

**Finding 2 — `GET /api/games/{id}/video` 302 x2 → dev-StrictMode artifact, one request in prod.**
Every production path is guarded to a single `/video` request: (a) the open-game breadcrumb is
read via `consumePendingGame()` (`AnnotateScreen.jsx:384`), which *removes* it, so StrictMode's
double effect-invoke runs `handleLoadGame` only once (second invoke gets `null` and bails);
(b) `beginGameVideoLoad` dedups by gameId; (c) `applyGameData` deliberately does NOT re-set the
single-video src (`AnnotateContainer.jsx:572-579`); (d) the first-paint pre-seed
(`useAnnotateState` `useState` initializer via `buildEarlyGameVideoSrc(pending.gameId,
pending.seekTime)`) builds the SAME URL that `beginGameVideoLoad` later assigns, so the second
`setAnnotateVideoUrl(sameSrc)` is a genuine no-op (no fragment/URL change → no media refetch).
The HAR's x2 is React 18 StrictMode's dev-only double-invoke of the first-paint video element; a
prod build (no StrictMode double) issues one 302.
Evidence: `src/containers/annotateVideoLoad.test.js` — new "early /video src is a single
production request (T6280)" block pins the pre-seed-URL == beginGameVideoLoad-URL invariant (the
link that keeps the second src-set a no-op), on top of the existing gameId-dedup tests.

No source behavior changed. The only non-test edit is a test-only `__resetInflightForTests` seam
added to `rankConfidence.js` (mirrors `__resetBeginLoadDedup` in `annotateVideoLoad.js`) for test
isolation. Per the task's own instruction, a dev-only artifact is documented, not "fixed" by
restructuring code.

## Acceptance Criteria

- [x] Each finding is either fixed, or documented as StrictMode-only / by-design with evidence
      (both documented above; the deterministic no-StrictMode request-count tests stand in for a
      live prod capture, which the container could not run without a backend/R2)
- [x] Any fix is pinned by a request-count assertion (no fix needed; both findings pinned by
      request-count assertions in the two test files above)
- [x] Ranking confidence and game video loading still work (existing `useRanking.test.js`,
      `rankConfidence.test.js`, `annotateVideoLoad.test.js` all green — no source behavior changed)
- [x] Frontend unit tests pass (27 tests across the relevant set: ConfidenceBanner.requestCount 2
      + rankConfidence 5 + annotateVideoLoad 16 + useRanking 4)
