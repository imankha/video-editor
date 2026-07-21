# T5641 — Video format-error: hard-reset recovery + server beacon

**Status:** STAGING (pending merge)
**Tier:** M · Frontend (useVideo) + Backend (telemetry endpoint)
**Follows:** [T5620](T5620*) (format-error backoff retry — this fixes why that retry didn't recover)

## Problem (found on staging, sarkarati proj 5)

A Framing/Overlay `<video>` streams its source **directly from R2 via a presigned
URL** (`/playback-url` → presigned; server is NOT in the byte path). Occasionally
Chrome throws `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4) **after fully buffering a
valid file** (`readyState=4`, whole clip buffered) — a transient decode-pipeline
wedge, not a real format problem (ffprobe decodes the file 100% clean).

Two gaps in T5620:
1. **Recovery**: the retry called `video.load()` on the **same src / same wedged
   element**, so 3 reloads in ~5s hit the same wedge. A manual page refresh
   recovers it (fresh element + fresh resource selection).
2. **Visibility**: the failure was invisible server-side (R2→browser direct). The
   only diagnostic (`[VIDEO_DIAG]`) fired **after** retries exhausted (re-probing
   a possibly-cleared transient → misleading `200`), and the retry log emitted an
   opaque `{ url }` object — never the MediaError code/state.

## Change

Frontend `src/hooks/useVideo.js` (FORMAT_ERROR branch of `handleError`):
- Snapshot `diag` (code, message, networkState, readyState, bufferedSec,
  currentTime, videoW/H, srcKey) **at failure time**; log the full object on each
  retry (flows into `clientLogger` → "Report a problem").
- **Hard-reset** on retry: `removeAttribute('src'); load(); src=retrySrc; load()`
  instead of a bare `load()` — tears down the wedged pipeline like a refresh does.
- On exhaustion: fire-and-forget **beacon** (`reportVideoError`) with the diag +
  the R2 Range-probe result.

New `src/utils/videoErrorBeacon.js`: `stripUrlSignature` (path only — never leaks
the presigned signature) + `reportVideoError` (fire-and-forget, never throws,
`keepalive`).

Backend:
- New `src/backend/app/routers/telemetry.py`: `POST /api/client-errors/video` —
  unauthenticated, never 500s (opportunistic user attribution, else `anon`), logs
  `[CLIENT_VIDEO_ERROR] …` at WARNING. Registered in `main.py`.
- `db_sync.py`: `/api/client-errors/` added to `AUTH_ALLOWLIST_PREFIXES` (a dead
  session can be the cause we're chasing — the beacon must still land).
- `ruff.toml`: per-file `E402` ignore for `app/main.py` (matches the existing
  `modal_functions` precedent; main.py intentionally orders imports after logging
  config). Also fixed 2 pre-existing RUF059 unused-var warnings in main.py.

## Tests
- `tests/test_telemetry.py` (3 pass): 204 + `[CLIENT_VIDEO_ERROR]` log on full &
  empty payloads; 422 (not 500) on a wrong-typed field.
- `src/utils/videoErrorBeacon.test.js` (7 pass): `stripUrlSignature` (null/blob/
  presigned/proxy) + `reportVideoError` (POST shape, never throws on reject/throw).

## Not verified in a live repro
The transient wedge is not reproducible on demand, so the hard-reset's recovery
of the *actual* transient is unverified end-to-end. The happy path is unchanged
(retry fires only on error); diagnostics + beacon are fully unit-tested. Watch
staging `[CLIENT_VIDEO_ERROR]` logs after deploy to confirm the beacon fires and
to capture the real probe status/content-type for the underlying cause.
