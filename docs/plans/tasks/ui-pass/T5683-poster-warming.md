# T5683: Poster warming (gesture + list-time + in-flight dedup)

**Status:** STAGING
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-24
**Epic:** [UI Pass](EPIC.md) — added from user feedback during wave-3 testing ("minimize time to load posters")

## Problem

Even with T5682's thumbs/caching, the FIRST view of a poster paid multi-second on-demand
generation (source-frame extraction 1.7–5s per artifact).

## Solution (`poster_warmer.py` + hooks)

1. **Warm-at-gesture** (epic decision #1): card posters generate inside the gestures that
   create/change the artifact — clip add/remove/reorder/upload (drafts), game activation
   (games). Best-effort; never fails the parent op; not reactive (explicit handler hooks).
2. **List-time warming**: `GET /api/projects` and `/api/games` kick bounded (3–4 in flight)
   background generation for missing card posters — cache warming only, single-HEAD skip
   for already-cached keys.
3. **In-flight dedup**: per-key async locks; concurrent GETs for the same missing poster
   share one ffmpeg run.
4. `fire_and_forget()` holds strong task references (bare `create_task` results are only
   weakly referenced and can be GC'd mid-flight — verified with a gc-forcing test); a task
   killed at shutdown never leaves a partial poster (R2 upload only after ffmpeg completes).

## Measured (live stack, real account)

- All 6 game card posters warm **0.62s** after the LIST calls return (fire-and-forget,
  LIST latency unaffected).
- Subsequent poster GETs: 175–304ms warm hits.

## Notes

- Full-suite run surfaced and fixed a real regression: redundant local
  `from app.user_context import ...` imports inside the new warming blocks shadowed the
  module-level import and would have `UnboundLocalError`'d every direct upload.
- Fire-and-forget here is idempotent R2 media cache writing (no DB writes) — outside the
  intent of the standing "defer fire-and-forget persistence" decision; flagged at review.

## Acceptance

- [x] 13/13 T5683 tests + 137/137 poster regression suites + full backend green
- [x] Warm-time + TTFB measured on the live stack (table above)
