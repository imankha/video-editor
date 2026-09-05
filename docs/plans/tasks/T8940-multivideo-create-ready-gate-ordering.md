# T8940: Multi-video game creation always failed on the 2nd file ("Videos can only be added to a ready game")

**Status:** WIP
**Impact:** 9
**Complexity:** 2
**Created:** 2026-09-05
**Follows:** T8935 (error-message extraction is what surfaced this readable error in the
first place — the original report was an unreadable `[object Object]`)

## Problem

Live-testing feedback: creating a game with 2+ files via T8810's universal dropzone
(folder pick or multi-select) failed every time on the second file with
`Videos can only be added to a ready game` (backend 409, `code: game_not_ready`).

This is a **deterministic ordering bug, not a timing-dependent race** — it fails 100% of
the time for any create-time upload of 2+ files, because:

1. `uploadMultiVideoGame` (`uploadManager.js`) creates the game as `status='pending'` with
   video 1's reference, uploads each file's bytes to R2 in a loop, and for i > 0 calls
   `addVideosToGame` (`POST /api/games/{id}/videos`) to attach it — but only called
   `activateGame` (`POST /api/games/{id}/activate`, flips `pending` -> `ready`) ONCE, AFTER
   the entire loop finished.
2. `add_game_videos` (games.py, hardened by T8700) rejects attaching onto any game that
   isn't already `status='ready'` — a guard written for the POST-creation "attach a video
   to an existing game" gesture, which correctly assumes a pending game there means
   "someone else's upload is still in flight, don't touch it."
3. T8700's own hardening comment even flags the tension: "it was previously called ONLY by
   the create-time multi-upload path (uploadMultiVideoGame), which owns sequencing/
   credits/refs itself" — but the guard it added didn't account for that caller still
   needing to attach BEFORE activation completed.

This almost certainly went unnoticed because create-time multi-file uploads were rare
before T8810 (the old "Per Half" UI required a deliberate mode toggle); T8810's universal
dropzone with folder support made 2+ file creates the norm for camera-folder users, and
this is very likely the exact test-account upload the live-testing session hit.

## Solution

Activate the game right after video 1's upload completes, BEFORE attaching video 2..N —
not after the whole loop. This is safe and matches the codebase's existing architecture,
not a workaround:

- `_insert_game_videos` (called by `add_game_videos`) already independently probes and
  backfills duration/dimensions from R2 for whatever it attaches — it doesn't depend on
  `activate_game` having seen that video.
- T8700's whole "attach a video to an existing READY game" feature already proves the app
  fully supports a game gaining more videos incrementally after activation (that's its
  entire purpose) — the timeline (`buildFullVideoTimeline`) recomputes as `game_videos`
  rows arrive.
- This also makes the game usable immediately after video 1 finishes (matching T1540's
  "annotate during upload" intent), rather than only after ALL N videos finish — a genuine
  UX improvement, not just a bug fix.

Considered and rejected: a broader event-driven/pub-sub rewrite of the upload pipeline
(raised as a general suggestion during triage). The root cause is a two-line, fully
deterministic sequencing bug inside one already-imperative async function — reordering it
is the minimal, correct fix. An event-bus abstraction here would be premature per this
codebase's own coding standards (abstract on the 3rd duplication, not the 1st; no
reactive-persistence patterns) and wouldn't fix anything a reorder doesn't already fix.

## Relevant Files

- `src/frontend/src/services/uploadManager.js` — `uploadMultiVideoGame`: moved
  `activateGame` from after the loop to inside the `i === 0` branch, right after that
  video's `ensureVideoInR2` call.
- `src/frontend/src/services/uploadManager.test.js` — new
  `describe('uploadMultiVideoGame — T8940 create-time ready-gate ordering')`, a
  stateful mock faithfully reproducing the backend's exact `game_not_ready` 409 contract.

## Acceptance Criteria

- [x] A red test reproducing the exact reported error exists and failed against the
      pre-fix code (`Videos can only be added to a ready game`) — written FIRST, per
      the bug-reproduction workflow
- [x] The same test passes after the fix, with `activate` provably called before ANY
      `videos(ready)` attach (asserted via call-order, not just overall success)
- [x] A 4-file case confirms every subsequent attach (not just the second file) happens
      after activation, with zero attempts while `pending`
- [x] No regression in `uploadManager.test.js`, `uploadManager.attachVideo.test.js`,
      `uploadManager.stall.test.js`, `uploadStore.test.js` (77 tests total)
- [x] eslint clean

## Follow-up

Ask the user to retry the multi-file upload now that this is deployed — this should be
the actual end-to-end fix for the reported failure.
