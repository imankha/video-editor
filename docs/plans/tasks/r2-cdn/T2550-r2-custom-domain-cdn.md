# T2550: CDN + Auth Worker for Working/Final/Raw Videos

**Epic:** [R2 CDN Video Serving](EPIC.md)
**Priority:** P0
**Impact:** 8
**Complexity:** 4
**Status:** TODO

## Problem

All R2 access uses the S3-compatible endpoint (`*.r2.cloudflarestorage.com`) which is HTTP/1.1 only — Chrome caps at 6 connections per origin. No CDN layer exists; `Cache-Control: no-store` on all video responses. Working/final video proxying through Fly.io exists solely to avoid this socket limit, costing $0.02/GB egress.

## Solution

Deploy the R2 custom domain and auth Worker together as one unit — no security gap. The Worker handles HMAC URL verification, pass-through video streaming, and cache management for working videos, final videos, and raw clips.

Game video clip streaming (byte-range clamping) stays on the Fly.io proxy for now — that's the complex port isolated in T2560.

## What This Unlocks

- **HTTP/2+3** — unlimited concurrent streams, no socket exhaustion for working/final/raw videos
- **CDN edge caching** — repeat requests served in <10ms from nearest PoP
- **Zero Fly.io egress** for ~60% of video bytes (working + final + raw)
- **HMAC signed URLs** — CDN-friendly (cache key = path only, not query params)
- **Auth from day one** — no public bucket window

## Implementation

### Steps

1. [ ] **R2 custom domain**: Cloudflare dashboard → R2 → Settings → Custom Domains → connect `cdn.reelballers.com`. Auto-creates CNAME + SSL.
2. [ ] **Worker project setup**: `wrangler init video-edge-worker`, configure R2 binding to `reel-ballers-users` bucket. Deploy to the custom domain route immediately — bucket is never publicly exposed without the Worker.
3. [ ] **Worker: HMAC validation**: Parse `?verify={expiry}-{hmac}` param, validate HMAC-SHA256(secret, path + expiry), check timestamp. Return 403 on failure.
4. [ ] **Worker: Pass-through serving**: `env.BUCKET.get(key)` with client Range header forwarded. Stream response with correct Cache-Control headers per video type.
5. [ ] **Worker: Cache key normalization**: Strip `?verify=` from cache key so all signed URLs for the same file share one cache entry.
6. [ ] **Worker: SQLite blocking**: Return 403 for any `*.sqlite` path.
7. [ ] **Worker: CORS headers**: `Access-Control-Allow-Origin` for `app.reelballers.com` and staging origins.
8. [ ] **Worker: Observability**: Structured JSON logging (path, cache status, latency, HMAC result). Set up Logpush or Workers Analytics Engine so logs persist beyond `wrangler tail`.
9. [ ] **Enable Cache Reserve** ($5/mo): Required for game videos >512MB. Enable now so it's ready for T2560.
10. [ ] **Cache Rules**: Via Cloudflare dashboard or Worker response headers:
    - Working videos: `Cache-Control: public, max-age=60, s-maxage=300`
    - Final videos: `Cache-Control: public, max-age=3600, s-maxage=86400`
    - Raw clips: `Cache-Control: public, max-age=86400`
    - Game videos: `Cache-Control: public, max-age=31536000, immutable` (served by Worker but clamped streaming handled by Fly.io until T2560)
11. [ ] **HMAC signing in backend**: New function `generate_signed_cdn_url(path, expiry=3600)` in `storage.py`. Uses shared HMAC secret (Worker secret + backend env var).
12. [ ] **Backend: Update working/final/raw endpoints** to return CDN URLs instead of proxying:
    - `/api/projects/{id}/working_video/stream` → return signed CDN URL
    - `/api/downloads/{id}/stream` → return signed CDN URL
    - `/storage/warmup` → return signed CDN URLs for working/final/raw (game clip URLs still use Fly.io proxy)
13. [ ] **Frontend: Update video loading** for working/final/raw videos:
    - Video elements use CDN URLs directly
    - Remove `no-cors` mode for these video types (Worker serves CORS headers)
14. [ ] **Backend: Cache purge on re-export**: When working/final video is re-exported, call Cloudflare purge API for that URL.
15. [ ] **Set Cache-Control on R2 uploads**: Update `storage.py` to set `CacheControl` metadata on game video objects at upload time.
16. [ ] **Deploy to staging first**: `cdn-staging.reelballers.com`, test all non-clip video types.
17. [ ] **Deploy to prod**: `cdn.reelballers.com`, monitor `cf-cache-status` and error rates.

### Architecture

```
Working/final/raw videos:
  Browser → cdn.reelballers.com (HTTP/2)
    → CDN edge cache
      → HIT → serve from edge (<10ms)
      → MISS → Worker → HMAC check → env.BUCKET.get(key) → stream

Game clip streaming (unchanged until T2560):
  Browser → Fly.io /api/projects/{id}/clips/{id}/stream (HTTP/2)
    → Backend 3-window byte-range clamping → R2 presigned URL
```

### Files

**New:**
- `workers/video-edge/` — Cloudflare Worker project (wrangler.toml, src/index.ts)

**Modified:**
- `src/backend/app/storage.py` — `generate_signed_cdn_url()`, HMAC signing, `CacheControl` on uploads
- `src/backend/app/routers/projects.py` — return CDN URL for working video instead of proxying
- `src/backend/app/routers/downloads.py` — return CDN URL for final video instead of proxying
- `src/backend/app/routers/storage.py` — warmup endpoint returns CDN URLs for non-clip videos
- `src/frontend/src/utils/cacheWarming.js` — use CDN URLs for working/final/raw
- `src/frontend/src/hooks/useStorageUrl.js` — update URL handling for CDN

**Not modified (yet):**
- `src/backend/app/routers/clips.py` — game clip streaming stays on Fly.io proxy until T2560

## Risks

- **New runtime in the stack**: TypeScript Worker alongside Python backend. Two deploy pipelines, two logging systems. Mitigated by keeping the Worker simple (auth + pass-through) in this task.
- **HMAC secret management**: Secret shared between Fly.io env and Worker secret. Rotation requires checking both old and new secret during transition.
- **Cache invalidation on re-export**: Working/final videos can be overwritten. Short edge TTLs (60s-5min) + explicit purge API call on re-export.

## Acceptance Criteria

- [ ] `cdn.reelballers.com` resolves and serves R2 content
- [ ] HTTP/2 confirmed on custom domain
- [ ] HMAC auth enforced — unsigned URLs return 403
- [ ] `*.sqlite` paths return 403
- [ ] Working/final/raw videos served via CDN with correct Cache-Control
- [ ] CDN cache hits return `cf-cache-status: HIT`
- [ ] Cache Reserve enabled
- [ ] Cache purge fires on working/final video re-export
- [ ] Worker logs persist (not just `wrangler tail`)
- [ ] Game clip streaming still works via Fly.io proxy (unchanged)
