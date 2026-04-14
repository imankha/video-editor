# T1490: First `<video>` range request to proxy returns 401, no error surfaced

**Status:** TODO
**Type:** Bug
**Found during:** T1460 retest (2026-04-14)

## Symptom

Every time the user selects a clip in framing, the backend sees:

```
[REQ] GET /api/clips/projects/3/clips/3/stream | REJECTED — no session cookie or X-User-ID
GET /api/clips/projects/3/clips/3/stream → 401
[REQ] GET /api/clips/projects/3/clips/3/stream | user=X (via session)
GET /api/clips/projects/3/clips/3/stream → 206
```

The **first** request lacks the session cookie; the retry succeeds. User
observes slow loads and, in the current session, a 35s stall on one clip
(may be compounded by T1460 warmer saturation but this is independent).

## Two issues

### A — Why is the first request unauth'd? [ROOT CAUSE IDENTIFIED 2026-04-14]

**Not a vite proxy / middleware / rendered `<video>` issue.** Confirmed via
backend log + HAR capture + quick test:

`extractVideoMetadataFromUrl()` in `src/frontend/src/utils/videoMetadata.js`
creates a **detached `<video>` element** (`document.createElement('video')`)
with `preload='metadata'` and assigns a proxy `/stream` URL to `src`. This
fires an HTML5 media probe with:

- No Range header
- `Sec-Fetch-Mode: no-cors`
- **No session cookie** (matches backend REJECTED log; matches HAR #0:
  status=0, 19-39ms, no Range, no-cors)

The function's inline comment explicitly says "Don't set crossOrigin"
because it was designed for presigned R2 URLs (auth in the URL). It is
now also called with proxy `/stream` URLs where auth lives in a cookie
the no-cors detached probe does not send.

**Ruled out via test:** adding `crossOrigin="use-credentials"` to the
*rendered* `<video>` in `VideoPlayer.jsx` flipped its requests to
`Sec-Fetch-Mode: cors` but did **not** eliminate request #0 — because
#0 comes from the detached element in `videoMetadata.js`, not the
rendered player. (Change reverted.)

**Callers firing detached probes on proxy URLs:**
- `src/frontend/src/hooks/useProjectLoader.js:151` (batched on project load — N clips = N probes)
- `src/frontend/src/hooks/useProjectLoader.js:209`
- `src/frontend/src/screens/OverlayScreen.jsx:317`
- `src/frontend/src/screens/FramingScreen.jsx` (imports)
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js:64,87`
- `src/frontend/src/modes/overlay/hooks/useOverlayState.js:73,96`

**Backend CORS note:** `/stream` currently returns no CORS headers
(`ACAO=None, ACAC=None` in HAR). Same-origin requests succeed because
CORS checks are skipped. If we pick the `use-credentials` fix path, the
backend must add `Access-Control-Allow-Credentials: true` + specific
origin on `/stream`.

**Prod (Fly.io) applicability:** Same code path runs there. The detached
`<video>` probe misbehavior is browser-level, not vite-proxy-specific,
so the bug reproduces in prod too (timing may differ).

### Fix directions (pick one in design doc)

1. **Eliminate the probe.** Backend already persists clip duration /
   dimensions / fps during extraction — return them on the clip record
   and skip `extractVideoMetadataFromUrl` for proxy URLs.
2. **Replace probe with `fetch(url, {credentials:'include'})` + moov parse.**
   Works for any URL; more code.
3. **Add `crossOrigin="use-credentials"` inside `extractVideoMetadataFromUrl`.**
   Requires backend CORS additions on `/stream`.

### B — Frontend must surface 401 instead of hanging

Currently the `<video>` element auto-retries after 401 and eventually
gets 206, so the user just sees a long spin. The spinner should either:
- Fail fast on 401 with a clear "session expired" error + re-auth flow, or
- At minimum emit a `[VIDEO_LOAD]` warning so it's greppable in prod logs.

Bundle this with A: whichever fix path is taken, add a `[VIDEO_LOAD]
auth_fail` warning on any `/stream` 401 response so regressions are
greppable.

## Files to inspect

- `src/frontend/src/utils/videoMetadata.js` — **the probe source** (primary)
- `src/frontend/src/hooks/useProjectLoader.js` — primary caller
- `src/frontend/src/hooks/useVideo.js` — error classifier for sub-issue B
- `src/backend/app/routers/clips.py` — does the clip record already return duration/dimensions? (determines fix direction 1 feasibility)
- `src/backend/app/middleware/db_sync.py` — REJECTED log source (confirmed, no change needed unless fix path 3)
- `src/frontend/src/components/VideoPlayer.jsx` — video error handling (sub-issue B)

## Acceptance

- [ ] Root cause for missing session cookie on first request identified
- [ ] First `/stream` request either succeeds with auth or fails fast
- [ ] If 401 does occur, video element error is surfaced (not retried silently)

## Context

Observed in dev server logs for project 3 (2-clip project), clips 3 and
4. Each new clip selection repeats the 401→206 pattern.
