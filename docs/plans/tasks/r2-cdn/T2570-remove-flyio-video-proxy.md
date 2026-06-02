# T2570: Remove Fly.io Video Proxy

**Epic:** [R2 CDN Video Serving](EPIC.md)
**Priority:** P2
**Impact:** 4
**Complexity:** 3
**Status:** TODO
**Depends on:** T2550 stable in prod for 2+ weeks (T3250 already moved streaming off the proxy; T2550 adds CDN layer)

## Problem

After T3250 (presigned URL streaming) and T2550 (CDN + HMAC auth), all video is served via direct R2 or CDN but the old Fly.io proxy code remains. Dead code, unnecessary R2 transfer client configuration (120s timeout, 20-pool), and frontend socket management complexity that no longer serves a purpose.

T3250 keeps the proxy endpoints as fallback. Once T2550 is stable in prod, the fallback is no longer needed and the proxy code can be deleted.

## Solution

Remove all video proxy endpoints and related infrastructure from the backend. Backend becomes API-only for video -- it generates signed CDN URLs (or presigned R2 URLs) but never streams bytes.

## Implementation

### Steps

1. [ ] **Remove proxy endpoints**:
   - `games.py` -- remove game streaming proxy logic (~200 lines: bounded-range clamping, httpx proxy, 3-window calculation)
   - `clips.py` -- remove clip streaming proxy logic (~230 lines: `stream_clip` handler, 3-window byte-range clamping, `_clamp_range`, `_build_windows`)
   - `projects.py` -- remove `get_working_video_stream` proxy handler
   - `downloads.py` -- remove `stream_download` proxy handler (if still proxying)
2. [ ] **Simplify R2 clients**: Remove the transfer client (120s timeout, 20-pool connections) from `storage.py`. Only need default client (API ops) and sync client (DB middleware).
3. [ ] **Remove frontend fallback logic**: Delete proxy fallback paths added in T3250. Video elements exclusively use CDN URLs.
4. [ ] **Remove frontend socket management**: Delete FOREGROUND_ACTIVE/FOREGROUND_DIRECT priority system, abort-on-visibility-change logic, and HTTP/1.1 workarounds from `cacheWarming.js` (HTTP/2 on CDN eliminates the need).
5. [ ] **Update tests**: Remove/update tests that reference proxy endpoints.
6. [ ] **Evaluate Fly.io instance size**: Less bandwidth = potentially smaller machine. Check if downsizing is appropriate.

### Files

**Delete/gut:**
- `src/backend/app/routers/games.py` -- streaming proxy section (~lines 1941-2147)
- `src/backend/app/routers/clips.py` -- streaming proxy section (~lines 1537-1768)
- `src/backend/app/routers/projects.py` -- working video proxy section
- `src/backend/app/routers/downloads.py` -- download streaming section (if still proxying)

**Modify:**
- `src/backend/app/storage.py` -- remove transfer client, simplify client setup
- `src/frontend/src/utils/cacheWarming.js` -- remove socket priority management
- `src/frontend/src/hooks/useStorageUrl.js` -- simplify (CDN URLs only)
- Frontend video components -- remove proxy fallback paths

## Risks

- **No rollback**: Once proxy code is deleted, you can't fall back to Fly.io serving. Only do this after CDN is proven stable.
- **Hidden dependencies**: Search for all `/stream` route references before deleting. Other code may depend on the proxy endpoints indirectly.

## Acceptance Criteria

- [ ] No video streaming/proxy code in Fly.io backend
- [ ] Only 2 R2 clients remain (default + sync)
- [ ] Frontend socket management simplified (no HTTP/1.1 workarounds)
- [ ] All existing tests pass or updated
- [ ] Fly.io bandwidth metrics show ~0 video transfer
