# R2 CDN Video Serving

**Status:** TODO
**Started:** --

## Goal

Move video serving from Fly.io backend proxy to Cloudflare edge (R2 custom domain + Worker). Eliminates Fly.io egress cost, HTTP/1.1 socket exhaustion, and lack of CDN caching. Backend becomes API-only for video requests.

## Why

Current architecture proxies all video bytes through Fly.io:
- **$0.02/GB egress** -- 85% of total cost at scale (>500GB/mo crossover)
- **HTTP/1.1 socket exhaustion** -- R2 S3 endpoint caps Chrome at 6 connections. Warmup prefetcher and video player compete for sockets.
- **No caching** -- `Cache-Control: no-store` everywhere. Presigned URL query params bust any CDN cache.
- **600KB/s observed** on staging for 9MB game video fetch (15.3s)

## Architecture

Custom domain `cdn.reelballers.com` -> Cloudflare CDN edge -> Worker (HMAC auth + serving/clamping) -> R2 binding (internal, zero egress).

Key design decisions:
- **HMAC signed URLs** replace S3 presigned URLs (CDN-friendly, cache key = path only)
- **Worker does 3-window byte-range clamping** for game videos (ports logic from `clips.py:1537-1768`)
- **Cache Reserve required** ($5/mo) for game videos >512MB (Free/Pro plan limit)
- **SQLite DBs stay on S3 API** -- never exposed on public custom domain
- **Custom domain + Worker deploy together** -- no public bucket without auth
- **Byte-range clamping isolated** -- risky port gets its own task with Fly.io fallback

## Tasks

| ID | Task | Status |
|----|------|--------|
| T2550 | [CDN + Auth Worker](T2550-r2-custom-domain-cdn.md) | TODO |
| T2560 | [Edge Byte-Range Clamping](T2560-edge-video-worker.md) | TODO |
| T2570 | [Remove Fly.io Video Proxy](T2570-remove-flyio-video-proxy.md) | TODO |

**Sequencing rationale:**
- T2550 ships the custom domain, Worker, and HMAC auth together so the bucket is never public without auth. Moves working/final/raw videos to CDN (simple pass-through, low risk).
- T2560 ports the complex 3-window byte-range clamping to the Worker. Keeps Fly.io proxy as fallback behind a feature flag. Highest risk task -- isolated so a failed port doesn't block the CDN wins from T2550.
- T2570 is cleanup after T2560 is stable in prod for 2+ weeks. Deletes dead proxy code, simplifies R2 clients and frontend socket management.

## Completion Criteria

- [ ] All video served via `cdn.reelballers.com` with HTTP/2
- [ ] Game videos cached at CDN edge (immutable, 1yr TTL)
- [ ] Working/final videos cached with short TTL + purge on re-export
- [ ] HMAC auth on all video URLs, SQLite excluded from custom domain
- [ ] Byte-range clamping for game clips runs at Cloudflare edge
- [ ] Zero video bytes flowing through Fly.io
- [ ] Backend video proxy endpoints removed

## Research

Full analysis: `C:\Users\imank\AppData\Local\Temp\r2-cdn-strategy.md`

### Cost at Scale

| Scale | Current (Fly.io proxy) | CDN + Worker |
|-------|------------------------|--------------|
| 200GB/mo | $4.78 | $10.64 |
| 500GB/mo | ~$10.78 | ~$10.64 (break-even) |
| 1TB/mo | $23.57 | $12.99 |
| 5TB/mo | $118.45 | $25.57 |

### Caching Strategy

| Video Type | Cache-Control | Edge TTL |
|------------|---------------|----------|
| Game videos (`/games/{hash}.mp4`) | `public, immutable, max-age=31536000` | 1 year |
| Working videos | `public, max-age=60, s-maxage=300` | 5 min |
| Final videos | `public, max-age=3600, s-maxage=86400` | 1 day |
| Raw clips | `public, max-age=86400` | 1 day |
| SQLite DBs | N/A -- not on custom domain | Never |

### Key Risks

1. **New runtime** -- TypeScript Worker alongside Python backend. Two deploy pipelines, two logging systems.
2. **512MB cache limit** -- Cache Reserve ($5/mo) required for game videos on Free/Pro plans.
3. **Byte-range clamping port** -- 3-window logic must be carefully ported from Python to Worker JS. Off-by-one errors corrupt video playback. Isolated in T2560 with Fly.io fallback.
4. **Cache invalidation** -- re-exported working/final videos need CDN purge API call.
5. **Observability gap** -- Worker logging weaker than Fly.io backend. Must set up persistent logging before cutting over.
