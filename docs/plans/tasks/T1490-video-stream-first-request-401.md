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

### A — Why is the first request unauth'd?

Hypotheses:
- Vite dev-proxy does not forward cookies on HTML5 video's initial
  probe-style range request (possibly `Range: bytes=0-0` preconnect).
- `<video>` element lacks `crossOrigin="use-credentials"`, so a preflight
  goes without creds. Unlikely for same-origin but worth checking.
- Some upstream middleware strips cookies on specific paths.

Action: reproduce on dev, inspect the first `/stream` request in Network
tab for cookies. If absent: check `vite.config.js` proxy config (cookies,
`xfwd`, `cookieDomainRewrite`). If present on client but backend does
not see them: check `app/middleware/db_sync.py` request-context logic.

Also verify prod (Fly.io) — proxy is not involved there, so this may be
dev-only.

### B — Frontend must surface 401 instead of hanging

Currently the `<video>` element auto-retries after 401 and eventually
gets 206, so the user just sees a long spin. The spinner should either:
- Fail fast on 401 with a clear "session expired" error + re-auth flow, or
- At minimum emit a `[VIDEO_LOAD]` warning so it's greppable in prod logs.

## Files to inspect

- `src/frontend/vite.config.js` — proxy config
- `src/frontend/src/components/VideoPlayer.jsx` — video error handling
- `src/frontend/src/hooks/useVideo.js` — error classifier / retry
- `src/backend/app/middleware/db_sync.py` — REJECTED logic
- `src/backend/app/routers/clips.py` — stream endpoint auth check

## Acceptance

- [ ] Root cause for missing session cookie on first request identified
- [ ] First `/stream` request either succeeds with auth or fails fast
- [ ] If 401 does occur, video element error is surfaced (not retried silently)

## Context

Observed in dev server logs for project 3 (2-clip project), clips 3 and
4. Each new clip selection repeats the 401→206 pattern.
