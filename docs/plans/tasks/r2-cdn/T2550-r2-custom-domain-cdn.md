# T2550: CDN + Auth Worker

**Epic:** [R2 CDN Video Serving](EPIC.md)
**Priority:** P0
**Impact:** 8
**Complexity:** 4
**Status:** TODO
**Depends on:** T3250 deployed (presigned URL streaming working in prod)

## Problem

After T3250, video streams directly from R2 via presigned URLs. Two gaps remain:

1. **HTTP/1.1 connection limit**: R2 S3 endpoint (`*.r2.cloudflarestorage.com`) is HTTP/1.1 -- Chrome caps at 6 connections per origin. Video player and warmup prefetcher compete for the same 6 sockets.
2. **No CDN caching**: Every video request hits R2 origin. Working/final videos that are replayed frequently get no edge cache benefit.
3. **Presigned URL auth**: 4hr expiry presigned URLs with AWS-style query params are functional but not ideal -- query params bust CDN cache keys, and long TTLs are a wider exposure window than needed.

## Solution

Deploy custom domain `cdn.reelballers.com` with an auth-only Cloudflare Worker. The Worker validates HMAC-signed URLs and serves video via R2 binding (internal, zero egress). No byte proxying -- the Worker does auth + pass-through only (avoids documented Worker stalling issues with large files).

## What This Unlocks

- **HTTP/2+3** -- unlimited concurrent streams, no socket exhaustion
- **CDN edge caching** -- repeat requests served in <10ms from nearest PoP
- **Zero Fly.io egress** for all video bytes
- **HMAC signed URLs** -- CDN-friendly (cache key = path only, not query params), short TTLs
- **Auth from day one** -- no public bucket window

## Implementation

### Steps

1. [ ] **R2 custom domain**: Cloudflare dashboard -> R2 -> Settings -> Custom Domains -> connect `cdn.reelballers.com`. Auto-creates CNAME + SSL.
2. [ ] **Worker project setup**: `wrangler init video-edge-worker`, configure R2 binding to `reel-ballers-users` bucket. Deploy to the custom domain route immediately -- bucket is never publicly exposed without the Worker.
3. [ ] **Worker: HMAC validation**: Parse `?verify={expiry}-{hmac}` param, validate HMAC-SHA256(secret, path + expiry), check timestamp. Return 403 on failure.
4. [ ] **Worker: Pass-through serving**: `env.BUCKET.get(key)` with client Range header forwarded. Stream response with correct Cache-Control headers per video type.
5. [ ] **Worker: Cache key normalization**: Strip `?verify=` from cache key so all signed URLs for the same file share one cache entry.
6. [ ] **Worker: SQLite blocking**: Return 403 for any `*.sqlite` path.
7. [ ] **Worker: CORS headers**: `Access-Control-Allow-Origin` for `app.reelballers.com` and staging origins.
8. [ ] **Worker: Observability**: Structured JSON logging (path, cache status, latency, HMAC result). Set up Logpush or Workers Analytics Engine so logs persist beyond `wrangler tail`.
9. [ ] **Enable Cache Reserve** ($5/mo): Required for game videos >512MB.
10. [ ] **Cache Rules**: Via Worker response headers:
    - Working videos: `Cache-Control: public, max-age=60, s-maxage=300`
    - Final videos: `Cache-Control: public, max-age=3600, s-maxage=86400`
    - Raw clips: `Cache-Control: public, max-age=86400`
    - Game videos: `Cache-Control: public, max-age=31536000, immutable`
11. [ ] **HMAC signing in backend**: New function `generate_signed_cdn_url(path, expiry=3600)` in `storage.py`. Uses shared HMAC secret (Worker secret + backend env var).
12. [ ] **Backend: Switch playback-url endpoints to CDN URLs**: Update T3250's `/playback-url` endpoints to return HMAC-signed CDN URLs instead of presigned R2 URLs.
13. [ ] **Backend: Update working/final/raw endpoints** to return CDN URLs:
    - `/api/projects/{id}/working_video/stream` -> return signed CDN URL
    - `/api/downloads/{id}/stream` -> return signed CDN URL
    - `/storage/warmup` -> return signed CDN URLs
14. [ ] **Frontend: Update URL handling**: Video elements use CDN URLs from playback-url endpoints. Remove `no-cors` mode for video types (Worker serves CORS headers).
15. [ ] **Backend: Cache purge on re-export**: When working/final video is re-exported, call Cloudflare purge API for that URL.
16. [ ] **Set Cache-Control on R2 uploads**: Update `storage.py` to set `CacheControl` metadata on video objects at upload time.
17. [ ] **Deploy to staging first**: `cdn-staging.reelballers.com`, test all video types.
18. [ ] **Deploy to prod**: `cdn.reelballers.com`, monitor `cf-cache-status` and error rates.

### Architecture

```
All video types:
  Browser -> cdn.reelballers.com (HTTP/2)
    -> CDN edge cache
      -> HIT -> serve from edge (<10ms)
      -> MISS -> Worker -> HMAC check -> env.BUCKET.get(key) -> stream
```

### Files

**New:**
- `workers/video-edge/` -- Cloudflare Worker project (wrangler.toml, src/index.ts)

**Modified:**
- `src/backend/app/storage.py` -- `generate_signed_cdn_url()`, HMAC signing, `CacheControl` on uploads
- `src/backend/app/routers/games.py` -- update playback-url endpoint to return CDN URL
- `src/backend/app/routers/clips.py` -- update playback-url endpoint to return CDN URL
- `src/backend/app/routers/projects.py` -- return CDN URL for working video
- `src/backend/app/routers/downloads.py` -- return CDN URL for final video
- `src/backend/app/routers/storage.py` -- warmup endpoint returns CDN URLs
- `src/frontend/src/utils/cacheWarming.js` -- use CDN URLs
- `src/frontend/src/hooks/useStorageUrl.js` -- update URL handling for CDN

## Risks

- **Worker stalling on large files**: Research shows Workers proxying large R2 video bytes stall for 1-2 minutes. Mitigated by auth-only Worker (HMAC validation + `env.BUCKET.get()` pass-through, no byte-level proxying).
- **New runtime in the stack**: TypeScript Worker alongside Python backend. Two deploy pipelines, two logging systems. Mitigated by keeping the Worker simple (auth + pass-through).
- **HMAC secret management**: Secret shared between Fly.io env and Worker secret. Rotation requires checking both old and new secret during transition.
- **Cache invalidation on re-export**: Working/final videos can be overwritten. Short edge TTLs (60s-5min) + explicit purge API call on re-export.

## Acceptance Criteria

- [ ] `cdn.reelballers.com` resolves and serves R2 content
- [ ] HTTP/2 confirmed on custom domain
- [ ] HMAC auth enforced -- unsigned URLs return 403
- [ ] `*.sqlite` paths return 403
- [ ] All video types (game, clip, working, final, raw) served via CDN
- [ ] CDN cache hits return `cf-cache-status: HIT`
- [ ] Cache Reserve enabled
- [ ] Cache purge fires on working/final video re-export
- [ ] Worker logs persist (not just `wrangler tail`)
- [ ] Presigned URL fallback removed from playback-url endpoints
