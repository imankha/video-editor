# R2 CDN Video Serving

**Status:** TODO
**Started:** --
**Depends on:** T3240 (Direct R2 Streaming Experiment) — results determine scope

## Goal

Move video serving from Fly.io backend proxy to Cloudflare edge (R2 custom domain + optional Worker). Eliminates Fly.io egress cost, HTTP/1.1 socket exhaustion, and lack of CDN caching. Backend becomes API-only for video requests.

## Prerequisite: T3240 Experiment Results

T3240 tests presigned URLs direct to browser (no Worker, no custom domain) behind a feature flag. Its results determine **which tasks in this epic are needed**:

| T3240 Result | Epic Scope |
|---|---|
| Presigned URLs fix TTFB + playback smooth | T2550 simplifies to custom domain + HMAC auth (no proxying Worker). T2560 (byte-range clamping) likely unnecessary — presigned URLs already work. T2570 cleanup proceeds. |
| Presigned URLs fix TTFB but non-faststart files break | T2550 adds faststart enforcement on upload. T2560 may shrink to moov-only proxying instead of full 3-window clamping. |
| Presigned URLs don't fix TTFB (R2 origin too slow) | Full epic proceeds as designed — CDN caching via Worker required. |
| `Accept-Ranges` header missing or R2 bugs surface | T2550 Worker must add/fix headers. Worker becomes required, not optional. |

**Do not start T2550 until T3240 results are analyzed.** The experiment is small (Complexity 4) and fast — it will either prove the simple path works or reveal exactly what the Worker needs to solve.

## Why

Current architecture proxies all video bytes through Fly.io:
- **$0.02/GB egress** -- 85% of total cost at scale (>500GB/mo crossover)
- **HTTP/1.1 socket exhaustion** -- R2 S3 endpoint caps Chrome at 6 connections. Warmup prefetcher and video player compete for sockets.
- **No caching** -- `Cache-Control: no-store` everywhere. Presigned URL query params bust any CDN cache.
- **600KB/s observed** on staging for 9MB game video fetch (15.3s)

## Architecture

Custom domain `cdn.reelballers.com` -> Cloudflare CDN edge -> Worker (HMAC auth + serving) -> R2 binding (internal, zero egress).

Key design decisions:
- **HMAC signed URLs** replace S3 presigned URLs (CDN-friendly, cache key = path only)
- **Worker scope adapts** based on T3240: may be auth-only pass-through (if presigned URLs work) or include byte-range clamping (if needed)
- **Cache Reserve required** ($5/mo) for game videos >512MB (Free/Pro plan limit)
- **SQLite DBs stay on S3 API** -- never exposed on public custom domain
- **Custom domain + Worker deploy together** -- no public bucket without auth

## Research Findings (2026-05-29)

### Worker Reliability Warning

Multiple Cloudflare community reports (2025-2026) document Workers proxying R2 video **stalling for 1-2 minutes** on load, with root cause traced to `cache_put` events taking up to 30s. This is a known pattern with large files.

**Implication for T2560:** Byte-range clamping in a Worker means the Worker proxies video bytes. If T3240 proves presigned URLs work without clamping, the Worker can be auth-only (HMAC validation + redirect to R2) which avoids the stalling pattern entirely.

Sources: [Worker stalling](https://community.cloudflare.com/t/r2-video-streaming-via-worker-stalling-on-load-for-minutes/861913), [MP4 seeking unreliable](https://community.cloudflare.com/t/mp4-streaming-seeking-from-r2-no-longer-works-reliably-despite-no-config-changes/844957), [video ends abruptly](https://community.cloudflare.com/t/r2-mp4-video-streaming-ends-abruptly/759300)

### CDN Caching Constraints

| Plan | Max Cacheable File Size |
|------|------------------------|
| Free/Pro/Business | 512 MB |
| Enterprise | 5 GB |
| Cache Reserve | No limit ($0.015/GB/mo) |

Full 2GB game videos won't cache without Cache Reserve. CDN caching primarily benefits exported clips (<200MB) and working videos. Game video TTFB improvement comes from HTTP/2 + edge proximity, not caching.

### R2 Known Bugs

- Range responses off by 64KB (~0.1-0.5% of requests, intermittent)
- `Accept-Ranges: bytes` header may be missing on public bucket responses
- Video ends abruptly on non-faststart files

See T3240 research section for full details and sources.

## Tasks

| ID | Task | Status | Depends On |
|----|------|--------|------------|
| T3240 | [Direct R2 Streaming Experiment](../T3240-direct-r2-streaming.md) | TODO | -- |
| T2550 | [CDN + Auth Worker](T2550-r2-custom-domain-cdn.md) | TODO | T3240 results |
| T2560 | [Edge Byte-Range Clamping](T2560-edge-video-worker.md) | TODO | T2550 + T3240 results may eliminate need |
| T2570 | [Remove Fly.io Video Proxy](T2570-remove-flyio-video-proxy.md) | TODO | T2560 stable 2+ weeks (or T2550 if T2560 skipped) |

**Sequencing rationale:**
- **T3240** runs first — cheap experiment that validates whether presigned URLs solve the problem without new infra. Results gate the rest of the epic.
- **T2550** ships the custom domain, Worker, and HMAC auth together. Scope may simplify to auth-only (no video proxying) if T3240 proves presigned URLs sufficient. Worker avoids the stalling pattern by doing HMAC validation + redirect, not byte proxying.
- **T2560** ports 3-window byte-range clamping to Worker. **May be skipped entirely** if T3240 proves clamping unnecessary (game videos are user's own content, soft barrier not security boundary). If kept, the Worker reliability risk requires Fly.io fallback and cautious rollout.
- **T2570** cleanup after CDN path is stable. Deletes dead proxy code.

## Completion Criteria

- [ ] All video served via `cdn.reelballers.com` with HTTP/2
- [ ] Game videos cached at CDN edge (immutable, 1yr TTL) — requires Cache Reserve for >512MB
- [ ] Working/final videos cached with short TTL + purge on re-export
- [ ] HMAC auth on all video URLs, SQLite excluded from custom domain
- [ ] Byte-range clamping at edge OR explicit decision to drop it (documented in T3240 results)
- [ ] Zero video bytes flowing through Fly.io
- [ ] Backend video proxy endpoints removed

## Cost at Scale

| Scale | Current (Fly.io proxy) | CDN + Worker |
|-------|------------------------|--------------|
| 200GB/mo | $4.78 | $10.64 |
| 500GB/mo | ~$10.78 | ~$10.64 (break-even) |
| 1TB/mo | $23.57 | $12.99 |
| 5TB/mo | $118.45 | $25.57 |

## Caching Strategy

| Video Type | Cache-Control | Edge TTL |
|------------|---------------|----------|
| Game videos (`/games/{hash}.mp4`) | `public, immutable, max-age=31536000` | 1 year |
| Working videos | `public, max-age=60, s-maxage=300` | 5 min |
| Final videos | `public, max-age=3600, s-maxage=86400` | 1 day |
| Raw clips | `public, max-age=86400` | 1 day |
| SQLite DBs | N/A -- not on custom domain | Never |

## Key Risks

1. **Worker stalling (NEW from research)** -- Workers proxying large R2 video bytes have documented reliability issues. Mitigated by preferring auth-only Worker (HMAC + redirect) over byte-proxying Worker if T3240 validates presigned URLs.
2. **New runtime** -- TypeScript Worker alongside Python backend. Two deploy pipelines, two logging systems.
3. **512MB cache limit** -- Cache Reserve ($5/mo) required for game videos on Free/Pro plans.
4. **Byte-range clamping port** -- 3-window logic must be carefully ported from Python to Worker JS. May be unnecessary if T3240 proves clamping can be dropped.
5. **Cache invalidation** -- re-exported working/final videos need CDN purge API call.
6. **Observability gap** -- Worker logging weaker than Fly.io backend. Must set up persistent logging before cutting over.

## Full Analysis

`C:\Users\imank\AppData\Local\Temp\r2-cdn-strategy.md`
