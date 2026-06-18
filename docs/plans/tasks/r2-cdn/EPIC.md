# R2 CDN Video Serving

**Status:** TODO
**Started:** --
**Depends on:** T3250 (Direct R2 Video Streaming) -- presigned URL streaming must be deployed first

## Goal

Add Cloudflare edge infrastructure on top of T3250's direct R2 streaming: custom domain for HTTP/2 multiplexing, HMAC-signed URLs for tighter auth, and CDN caching for smaller video types. Backend becomes API-only for video requests.

## Prerequisite: T3250 Deployed

T3250 replaces the Fly.io video proxy with presigned R2 URLs for game and clip streaming. Once T3250 is deployed and validated, this epic adds edge infrastructure:

- **Custom domain** (`cdn.reelballers.com`) -- HTTP/2 multiplexing eliminates the 6-connection-per-origin limit on R2's S3 endpoint
- **HMAC auth Worker** -- replaces presigned URLs with CDN-friendly signed URLs (cache key = path only, not query params)
- **CDN edge caching** -- repeat requests served from nearest PoP
- **Byte-range clamping** -- likely unnecessary since T3250 drops clamping (user-owned content, zero egress)

## Why (after T3250)

T3250 fixes the throughput bottleneck (Fly.io proxy) but leaves two gaps:

1. **HTTP/1.1 connection limit**: R2 S3 endpoint caps Chrome at 6 connections per origin. Video player and warmup prefetcher compete for sockets. Custom domain with HTTP/2 eliminates this.
2. **No CDN caching**: Working/final videos are re-fetched from R2 origin on every request. CDN edge caching serves repeat requests in <10ms.

Additionally, HMAC-signed URLs provide tighter auth than presigned URLs (shorter TTLs possible, cache-friendly).

## Measured Learnings (2026-06-18, from T3760 spike)

The T3760 spike measured the real direct-R2 playback path against the actual prod game video
(clip 48, 3.05 GB, confirmed faststart). The numbers **downgrade this epic's strongest stated
justification** — the HTTP/1.1 6-socket-cap latency story (`#1` above):

- **R2 TTFB at a 2.0 GB offset = 82–151 ms** (cold). R2 is fast to first byte at deep offsets.
- **Cold time-to-first-frame after a deep seek = 266 ms** (warm 16 ms); the browser buffers only
  ~3 seconds and transfers ~1.85 MB cold — not the gigabytes implied by the advertised
  `Content-Length`.
- **Seeks resolve in ~300 ms even under deliberate 8-socket saturation** — the socket-contention /
  multiplexing stall this epic was partly meant to fix **did not reproduce**.

**What survives as justification** (these are real, but none is a *playback-latency* fix):

1. ~~HTTP/2 multiplexing to fix playback latency~~ — **empirically weak**; seeks don't stall, TTFF is
   already 266 ms. Keep only as a minor robustness nicety, not an impact driver.
2. **CDN edge caching** for repeat plays of smaller types (working/final/raw clips <512 MB). Cold
   loads are already handled by the warming system (T2040/T1890/T2890, all DONE).
3. **Egress cost reduction** — real only at scale (cost table below: CDN wins above ~500 GB/mo).
   Low urgency at current scale.
4. **HMAC auth** vs 4 h presigned URLs — security hardening, not urgent.

**Implication:** this epic is **legitimate but low-urgency infra**, not a latency fix. Do **not** let
any framing/seek "stall" report (e.g. T3760) pull it forward — that report was a HAR mis-read. The
impact rating that was anchored on latency should drop accordingly. **T2560 (byte-range clamping) is
resolved KEPT-SKIP** (no latency benefit + free egress — see its file). Full evidence + method:
[`../T3760-decision.md`](../T3760-decision.md).

## Architecture

Custom domain `cdn.reelballers.com` -> Cloudflare CDN edge -> Worker (HMAC auth + pass-through) -> R2 binding (internal, zero egress).

Key design decisions:
- **Auth-only Worker**: HMAC validation + `env.BUCKET.get()` pass-through. No byte proxying (avoids documented Worker stalling issues with large files).
- **Cache Reserve required** ($5/mo) for game videos >512MB (Free/Pro plan limit)
- **SQLite DBs stay on S3 API** -- never exposed on custom domain
- **Custom domain + Worker deploy together** -- no public bucket without auth

## Research Findings (2026-05-29)

### Worker Reliability Warning

Multiple Cloudflare community reports (2025-2026) document Workers proxying R2 video **stalling for 1-2 minutes** on load, with root cause traced to `cache_put` events taking up to 30s. This is a known pattern with large files.

**Implication:** Worker should be auth-only (HMAC validation + pass-through), not byte-proxying. T3250 proves presigned URLs work, so the Worker doesn't need to proxy video bytes.

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

See T3250 for full details and sources.

## Tasks

| ID | Task | Status | Depends On |
|----|------|--------|------------|
| T3250 | [Direct R2 Video Streaming](../T3250-direct-r2-streaming-fix.md) | TODO | -- |
| T2550 | [CDN + Auth Worker](T2550-r2-custom-domain-cdn.md) | TODO | T3250 deployed |
| T2560 | [Edge Byte-Range Clamping](T2560-edge-video-worker.md) | KEPT-SKIP (T3760) | — (no latency benefit, free egress) |
| T2570 | [Remove Fly.io Video Proxy](T2570-remove-flyio-video-proxy.md) | TODO | T2550 stable 2+ weeks |
| T2580 | [Faststart Upload Validation](T2580-faststart-upload-validation.md) | TODO | T3250 deployed |

**Sequencing rationale:**
- **T3250** ships first -- fixes playback stalls by switching to presigned R2 URLs. No new infrastructure.
- **T2550** ships the custom domain, Worker, and HMAC auth. Worker is auth-only (HMAC validation + pass-through to R2 binding). No byte proxying.
- **T2560** ports 3-window byte-range clamping to Worker. **Resolved KEPT-SKIP (2026-06-18, T3760)** -- measured TTFF 266 ms cold / seeks ~300 ms even under socket saturation; a `Content-Length` clamp has zero latency benefit and egress is free. See T2560 + `../T3760-decision.md`.
- **T2570** cleanup after CDN path is stable. Deletes dead proxy code.

## Completion Criteria

- [ ] All video served via `cdn.reelballers.com` with HTTP/2
- [ ] HMAC auth on all video URLs, SQLite excluded from custom domain
- [ ] Working/final videos cached at CDN edge with appropriate TTLs
- [ ] Game videos cached with Cache Reserve (immutable, 1yr TTL)
- [ ] Byte-range clamping at edge OR explicit decision to drop it (documented)
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

1. **Worker stalling**: Workers proxying large R2 video bytes have documented reliability issues. Mitigated by auth-only Worker (HMAC + pass-through, no byte proxying) since T3250 validates presigned URLs.
2. **New runtime**: TypeScript Worker alongside Python backend. Two deploy pipelines, two logging systems.
3. **512MB cache limit**: Cache Reserve ($5/mo) required for game videos on Free/Pro plans.
4. **Cache invalidation**: Re-exported working/final videos need CDN purge API call.
5. **Observability gap**: Worker logging weaker than Fly.io backend. Must set up persistent logging before cutting over.

## Full Analysis

`C:\Users\imank\AppData\Local\Temp\r2-cdn-strategy.md`
