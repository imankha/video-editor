# T2540: Verify HTTP/2 on Fly.io Edge

**Epic:** [Page Load Optimization](EPIC.md)
**Priority:** P1
**Complexity:** 2
**Impact:** 6
**Status:** TESTING

## Result: No-Op — HTTP/2 Already Active

Verified 2026-05-05: HTTP/2 multiplexing is already working on Fly.io edge. No configuration changes needed.

## Evidence (Production HAR: app.reelballers.com-annotate.har)

**All 34 API requests to reel-ballers-api.fly.dev use `http/2.0` with `conn=-1.0ms`** — confirming HTTP/2 multiplexing is active and all requests share a single connection.

Protocol distribution across entire HAR:
- `http/2.0`: 34 requests (all Fly.io API calls) — **conn=-1.0ms** (reused)
- `h3`: 8 requests (Stripe, Google, Cloudflare CDN)
- `HTTP/1.1`: 3 requests (R2 presigned URLs) — conn=36-43ms

The 40-60ms connection overhead originally mentioned came from:
1. **R2 presigned URLs** (e41331ed...r2.cloudflarestorage.com) — HTTP/1.1, conn=36-43ms. Different domain, outside our control.
2. **Third-party scripts** (Stripe, Cloudflare Insights) — different domains, expected behavior.

## Why It Works

Fly.io's edge proxy (`fly-proxy`) handles ALPN negotiation automatically for all HTTPS connections. The `[http_service]` config with `force_https = true` in `fly.production.toml` ensures all traffic goes through the TLS-terminating edge, which advertises h2 support.

## Test Plan

- [x] HAR shows `http/2.0` in httpVersion for all 34 Fly.io API requests
- [x] Connection timing is -1.0ms (reused) for all API requests — no per-request TLS overhead
- [x] The 40-60ms overhead is isolated to third-party domains (R2, Stripe) — not actionable

## Files

- `src/backend/fly.production.toml` — no changes needed
