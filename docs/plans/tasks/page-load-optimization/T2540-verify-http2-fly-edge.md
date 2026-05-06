# T2540: Verify HTTP/2 on Fly.io Edge

**Epic:** [Page Load Optimization](EPIC.md)
**Priority:** P1
**Complexity:** 2
**Impact:** 6
**Status:** TODO

## Problem

Many requests in the HAR show 40-60ms of TLS connection setup overhead. With 12 parallel API requests on page load, the browser opens multiple TCP connections (HTTP/1.1 limit: 6-8 per domain). Each new connection incurs a TLS handshake. HTTP/2 multiplexing would send all requests over a single connection.

## Evidence

HAR timing breakdown for parallel batch at t=60ms:
- First 6-8 requests: `conn=43-57ms` (new TLS connections)
- Remaining requests: `conn=-3ms` (reused connections after first batch completes)

Total wasted on connection overhead: ~240-360ms across all requests.

## Investigation

1. Check what protocol the browser actually negotiated (HAR may contain this in `httpVersion` field)
2. Fly.io edge terminates TLS — check if it advertises h2 ALPN
3. `curl -v --http2 https://reel-ballers-api.fly.dev/api/health` to test
4. Check if Fly.io's internal proxy (fly-proxy) downgrades to HTTP/1.1 before reaching the app

## Implementation (if needed)

If HTTP/2 is not active:
- Fly.io edge should handle h2 by default for HTTPS — may need `[[services.ports]]` config change
- Or: if the API domain is separate from the frontend domain, the browser can't reuse the frontend's h2 connection — consider proxying API requests through the same origin

## Test Plan

- [ ] `curl --http2 -v` confirms h2 negotiation
- [ ] HAR shows `h2` in httpVersion field
- [ ] Connection overhead drops from 40-60ms to ~0ms for parallel requests

## Files

- Fly.io deployment config (if changes needed)
