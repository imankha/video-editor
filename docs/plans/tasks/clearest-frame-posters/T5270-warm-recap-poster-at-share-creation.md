# T5270: Warm recap poster at share creation (crawlers must never pay the ffmpeg cost)

**Status:** TODO
**Impact:** 6 | **Complexity:** 2
**Epic:** [Clearest-Frame Posters](EPIC.md) — follow-up to T5180
**Created:** 2026-07-17

## Problem

User direction (2026-07-16): messenger crawlers (WhatsApp, iMessage, etc.) allot only a few
seconds for og:image fetches — a slow response means NO preview image, silently. T5180 shipped
the teammate recap poster as **generate-on-first-request**: `GET
/api/shared/teammate/{token}/poster.jpg` runs `ensure_recap_poster` (5 ranged ffmpeg seeks over
a presigned R2 recap, seconds of work) when the cache object is missing. But the first request
for a fresh share IS the crawler — the paste-into-WhatsApp moment is exactly when the poster
must already be warm. The 24h Cache-Control only helps the second crawler.

## Solution

Warm the poster at **share-creation time** (a user gesture): when a teammate share is created
(shares.py, the endpoint that mints the teammate token), kick `ensure_recap_poster(game_id)`
for the shared game(s) so the R2 object exists before the link can possibly be pasted anywhere.

Design notes:
- Fire-and-forget from the share-creation handler is acceptable here (poster warming is
  best-effort; the share itself must not fail or slow down because of it) — BUT the repo has a
  fire-and-forget deferral memory (sessions not pinned to one machine). Prefer awaiting it
  inline if it's fast enough (<1s target for share creation is not required — creating a share
  is a heavier gesture already), else `asyncio.to_thread` before returning. Decide in
  implementation; never let poster failure fail share creation (log at info).
- Keep the on-demand path in the GET as the fallback (share created before this task, cache
  evicted/deleted, re-uploaded recap) — it self-heals, it's just not allowed to be the common
  case.
- Idempotent: `ensure_recap_poster` already short-circuits on cache HEAD.
- Consider also warming when a recap is (re)rendered (T4140 hi-q path) — only if trivial;
  share-creation warming alone closes the crawler gap.

## Verification (acceptance)

- [ ] Creating a teammate share leaves `recaps/posters/{game_id}.jpg` in R2 BEFORE the share
      response returns (or within the same request lifecycle) — test asserts the object exists
      after the create call with the GET handler's generation stubbed OFF.
- [ ] First `GET .../poster.jpg` after share creation is a pure cache read — assert no ffmpeg
      invocation (spy/stub) and response under a tight budget on the local stack.
- [ ] Share creation still succeeds when poster warming fails (recap missing) — logged, no
      broken share, GET falls back to on-demand/branded-card behavior.
- [ ] Cold-crawler timing measured once on staging: `time curl` the poster URL for a FRESH
      share -> report ms in the task Progress Log. Target: comfortably under ~2s.

## Relevant files
- `src/backend/app/routers/shares.py` — teammate share creation endpoint + `ensure_recap_poster`
  call site (T5180 added the poster helpers/proxy here)
- `src/backend/app/services/poster.py` — `ensure_recap_poster` (no logic change expected)
- `src/backend/tests/test_t5180_recap_poster.py` — extend with warm-at-creation tests

## Classification hint
S/M-tier, backend-only, 1-2 files + tests, no schema change. The subtlety is the
failure-isolation (share creation never fails/slows on poster problems), not the call itself.
