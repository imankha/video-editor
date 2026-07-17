# T5350: Clip-gesture sync_failed 503 is confusing/invisible on the frontend

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-17
**Epic:** durability-sync campaign (completes T4320)

## Problem

T4320 made clip-creating gestures durable: on a sync failure the backend now returns a retryable
**503 `{code: 'sync_failed', retryable: true}`** instead of a silent success. But the frontend
doesn't complete the loop, so T4320's "never a silent success" guarantee is only half-delivered on
the failure path:

1. **Wrong message.** The clip 503 reuses the shared `DURABLE_SYNC_FAILED_RESPONSE` whose text says
   *"Your reel was not moved"* — nonsensical for a clip-save gesture.
2. **No handling.** `useRawClipSave.js` (and the update/delete paths) don't recognize
   `code === 'sync_failed'` to surface a Retry / "not saved" affordance the way publish/move do.
   T4320's backend change makes these 503s newly reachable, so a real durability failure currently
   reads as a generic error, not an actionable "retry — your clip wasn't saved."

Found by T4320's fresh-context reviewer (MAJOR, frontend, deferred out of the backend task's scope).

## Solution
- Give clip gestures a clip-appropriate `sync_failed` message (not the reel/move copy) — either a
  gesture-typed variant of the durable-fail payload or a frontend mapping keyed on the gesture.
- Handle `code === 'sync_failed'` in `useRawClipSave.js` (+ update/delete): surface a clear "clip
  not saved — retry" state with a Retry action, mirroring the publish/move durable-fail UX. Never a
  silent success toast (the whole point of T4320).
- Keep it gesture-based: the retry is a user action, not a reactive re-send.

## Relevant files
- `src/frontend/src/hooks/useRawClipSave.js` (+ the update/delete clip paths)
- backend `DURABLE_SYNC_FAILED_RESPONSE` / `export_sync_failed_data` (source of the message)
- the publish/move `sync_failed` UX as the pattern to mirror

## Acceptance Criteria
- [ ] A forced clip-save sync failure shows a clip-appropriate message (not "your reel was not
      moved") with a Retry affordance; the clip is clearly marked not-saved.
- [ ] Update + delete clip gestures handle `sync_failed` the same way.
- [ ] No silent success on a 503; retry is a gesture.
- [ ] Tests: 503 `sync_failed` → surfaced state (unit/e2e); happy path unchanged.

## Classification hint
M-tier, frontend-only. Completes T4320's user-visibility criterion. Do after/with T4320 merge.
