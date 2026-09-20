# T10790: "Add footage" (attach to existing game) 422s on every real attempt

**Status:** TODO
**Impact:** 9
**Complexity:** 2
**Created:** 2026-09-20
**Updated:** 2026-09-20

## Problem

Attaching a second video to an already-`ready` game — the "Add footage to game" button in
Annotate (second half, a sideline angle, footage added later) — **fails 100% of the time** with a
422 before the request handler ever runs. Confirmed live by reproducing it in dev
(2026-09-20) while doing unrelated verification work for T10770.

This is not dev-specific or data-specific: it is a schema contract mismatch between the frontend
and the Pydantic model, present on master right now, so it is live wherever this code is deployed
(staging/prod included, same source).

## Root cause

`src/backend/app/routers/games.py` `VideoReference.sequence` is a **required** field:

```python
sequence: int = Field(..., description="Video sequence number (1-based)")
```

`src/frontend/src/services/uploadManager.js` `attachVideoToExistingGame` (the function behind
"Add footage to game") builds its `videoRef` **without a `sequence` key at all**:

```js
// Step 3: attach to the game. The endpoint assigns the append-only sequence
// (MAX(sequence)+1) server-side, so we intentionally omit `sequence`.
const videoRef = {
  blake3_hash: r2Result.blake3_hash,
  file_size: r2Result.file_size,
  duration: null,
  width: null,
  height: null,
  recorded_at,
  original_filename: file.name || null,
};
```

That comment is correct about the *handler* — `add_game_videos` (T8700) does assign
append-only sequences server-side and explicitly never trusts the client's value (see its own
docstring and the "APPEND-ONLY (GAP 3)" comment). But FastAPI/Pydantic reject the request at the
body-validation boundary — `sequence` required, not present, missing → **422 — before
`add_game_videos`'s body ever executes.** The handler's "never trust the client's sequence" logic
is correct but unreachable for this caller.

Confirmed live: `POST /api/games/{id}/videos` with the frontend's actual payload (no `sequence`
key) returns:
```json
{"detail":[{"type":"missing","loc":["body","sequence"],"msg":"Field required", ...}]}
```

Introduced by `6e71192a1` (2026-09-07, "T8892: real angle names ..."), which rewrote
`attachVideoToExistingGame`'s `videoRef` construction and dropped `sequence` based on the (true,
but insufficient) belief that the server ignores it. `VideoReference.sequence` itself has been
required since `3a621e8029` (2026-06-25) and was never revisited.

## Why the test suite didn't catch it (real gap, not just this bug)

`src/backend/tests/test_t8700_attach_video.py` — every test calls
`games_router.add_game_videos(game_id, request)` **directly**, constructing the request via a
`_video_ref()` helper that **always passes `sequence=`** explicitly (e.g.
`_video_ref(HASH_2, sequence=99)`). This bypasses the FastAPI/Pydantic HTTP boundary entirely, so
the tests exercise the handler's append-only override logic perfectly but never exercise the JSON
body FastAPI actually receives from a browser. This is the same "vacuous test" class flagged in
the T10760/T10770 handoff (a test that passes for the wrong reason) — worth fixing alongside the
schema, so a future frontend/backend contract drift here is caught again.

## Fix

1. `VideoReference.sequence` → `int | None = None` in `games.py` (mirrors the other optional
   fields on the same model; `add_game_videos` already recomputes it server-side and ignores
   whatever arrives, so this is safe). Confirm `create_game`'s path (which DOES rely on the
   client-supplied sequence for the initial multi-upload, via `uploadMultiVideoGame` — that caller
   always sends real sequence numbers and is unaffected either way) still gets a real value in
   practice; no behavior change needed there.
2. Add a backend test that goes through the actual FastAPI app (`TestClient`/`httpx` against the
   router, not a direct handler call) posting the exact shape the frontend sends — no `sequence`
   key — asserting 200, to close the boundary-testing gap described above.
3. Manual verification: real "Add footage" click on a `ready` game in dev must succeed end to end
   (this task's discovery repro: Home → open a ready game in Annotate → "Add footage to game" →
   drop a video → "Add to this game" → 200, `game_videos` gains a row, timeline duration grows).

## Context

### Relevant Files
- `src/backend/app/routers/games.py` — `VideoReference` (line ~297), `add_game_videos` (line ~716)
- `src/frontend/src/services/uploadManager.js` — `attachVideoToExistingGame` (line ~1352)
- `src/backend/tests/test_t8700_attach_video.py` — add the boundary-level test here (or a sibling
  file if the existing one stays handler-level only)

### Related Tasks
- Discovered incidentally during T10770 (multi-video Annotate-entry verification) live testing.
  Unrelated to T10750/T10760's `useVideo`/selection work.

## Acceptance Criteria

- [ ] `VideoReference.sequence` is optional; `add_game_videos` behavior unchanged (still
      append-only, still ignores client value)
- [ ] A real "Add footage to game" click on a ready game succeeds (manual, dev)
- [ ] A new test posts through the actual HTTP/Pydantic boundary with no `sequence` key and gets 200
- [ ] Existing `test_t8700_attach_video.py` suite still passes unchanged
