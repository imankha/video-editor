# T7380: Global presigned-URL cache outlives its own signature expiry

**Status:** DONE (deployed 2026-08-24 prod). File header was stale at WIP; commit `82fa176b`
("T7380/T7390: add to PLAN.md, flip T7380 to STAGING") and PLAN.md both confirm it merged and
shipped in this deploy.
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-20
**Updated:** 2026-08-20

## Problem

Found live-testing T4330 in a Modal-disabled dev container: a freshly-uploaded game's poster
never generates, backend log shows repeated `HTTP error 403 Forbidden` when ffmpeg fetches the
presigned R2 URL to grab a frame, even though the same underlying video streams fine through
the app's own authenticated `/api/games/{id}/video` route.

Root cause: `generate_presigned_url_global()` (`storage.py`) caches generated URLs in a
process-wide `TTLCache(maxsize=1000, ttl=12600, timer=time.time)` (3.5h) keyed by
`(key, expires_in)`, but the cache's own eviction TTL is fixed and independent of the
`expires_in` value actually passed to the R2 SDK's `ExpiresIn` param. Two callers in
`poster.py` (`ensure_recap_poster`'s `recap_url`, line ~961, and `ensure_game_source_poster`'s
`source_url`, line ~1197) pass `expires_in=3600` (1 hour) — 1.5 hours SHORTER than the cache's
3.5h TTL. Once cached, that URL is served for up to 3.5 hours even though R2 stops honoring its
signature after 1 hour: every call in that dead window gets a stale, already-expired presigned
URL and R2 correctly 403s it.

Confirmed in the backend log: the failing URL's embedded `X-Amz-Date=20260820T190416Z`
(19:04:16) was unchanged across calls at 20:34:59-20:38:00 — 90 minutes later, well past its
1-hour expiry, proving the SAME cached (now-expired) URL was being replayed rather than
regenerated.

Most other callers of `generate_presigned_url_global` omit `expires_in` (default 14400s = 4h,
which IS longer than the 12600s cache TTL — the cache correctly evicts and regenerates before
those URLs expire, so they're safe by accident). Only the two `poster.py` call sites pass a
shorter `expires_in`, breaking that implicit invariant.

## Solution

Make the cache incapable of serving a URL past its own `expires_in`, regardless of any
particular caller's chosen expiry — store the URL's actual expiry timestamp alongside it and
validate on read (treat as a miss, not just an eventual TTL sweep) rather than relying on a
single global `TTLCache` ttl to always exceed every caller's `expires_in`.

## Context

### Relevant Files
- `src/backend/app/storage.py` — `_PRESIGNED_URL_CACHE` (~L36), `generate_presigned_url_global`
  (~L2592)

### Related Tasks
- Found alongside T7370 while live-verifying T4330; unrelated bug, no shared code path

## Implementation

### Steps
1. [x] Store `(url, expires_at)` in the cache instead of a bare URL string; on read, treat an
       entry as a miss (and regenerate) once `time.time() >= expires_at - <safety margin>`
2. [x] Keep the outer `TTLCache` as a memory bound (maxsize), not as the source of truth for
       per-entry expiry
3. [x] Regression test: two calls to `generate_presigned_url_global` with a short `expires_in`,
       separated by a simulated time jump past that expiry but within the old fixed TTL, must
       produce a freshly-signed URL on the second call
4. [ ] Relevant test set green; backend import check clean

### Progress Log

**2026-08-20**: Found live while manually testing T4330/T7370 in a Modal-disabled dev
container; root-caused via backend log timestamp analysis (stale `X-Amz-Date` reused 90 minutes
after its 1h expiry). Fixed directly, no branch (small, single-file, interactive session).

## Acceptance Criteria

- [ ] A presigned URL is never served once its own `ExpiresIn` window has elapsed, regardless of
      how soon after that the cache's outer TTL would otherwise have evicted it
- [ ] Existing callers relying on the cache for repeat-request performance still get a cache hit
      within the valid window (no regression to the common case)
