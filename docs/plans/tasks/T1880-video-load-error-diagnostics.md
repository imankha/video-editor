# T1880: Video Load Error Diagnostics

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-25

## Problem

When the browser video element reports "format not supported" or other load errors, the frontend logs the raw error code (`code=4 kind=format-error`) but not the HTTP response that caused it. This makes it impossible to distinguish between:

1. **Server returned an error page** (502, 503, HTML body) — transient, retry will fix
2. **Actual codec/container issue** (wrong container, missing codecs) — needs re-export
3. **R2 timeout returned broken stream** (partial data, truncated) — T1690 related
4. **Cached stale response** (browser served old error from cache) — needs cache bust

All four produce the same "Video format not supported" message, but have completely different root causes and fixes.

## Solution

When a video load error occurs, make a diagnostic fetch to the same URL and log:

- HTTP status code
- Content-Type header (video/mp4 vs text/html vs other)
- First ~100 bytes of response body (to detect HTML error pages)
- Response headers (Cache-Control, X-Request-Id if present)
- Whether the URL was served from browser cache (via `response.headers` or Performance API)

Log this with a `[VIDEO_DIAG]` tag so it's easy to grep in user-reported logs.

## Relevant Files

- `src/frontend/src/hooks/useVideo.js` — video error handler
- `src/frontend/src/utils/videoMetadata.js` — metadata fetch (already does HTTP probing)

## Acceptance Criteria

- [ ] Video load errors log HTTP status, content-type, and body snippet with `[VIDEO_DIAG]` tag
- [ ] "Server returned error page" cases are clearly distinguishable in logs from codec issues
- [ ] Diagnostic fetch doesn't block retry logic or cause additional user-visible delay
- [ ] No change to user-facing error messages (just better internal diagnostics)
