# T4773: Overlay/Working-Video Byte Path — Proxy TTFB (pooled-httpx) or 302→R2

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Parent:** T4770 (Stage B fan-out). Evidence: [T4770-delay-ledger.md](T4770-delay-ledger.md) row 3.
**Priority:** MEDIUM-HIGH — Overlay is where the user adds spotlights on their reel; first video paint is the slowest of the editor screens.

## Problem (measured)

Opening a draft in Overlay: `overlay:clicked → overlay:videoReady ≈ 3233ms` (first byte ≈ 2187ms after click).

HAR evidence (T4770 cold walkthrough):
- `GET /api/projects/30/working_video/stream` = **9.4MB received THROUGH the Fly bounded proxy**, `wait(TTFB)=490–900ms`, `receive=523ms`, amid a storm of 4 concurrent `working_video/stream` (30/50/49/47).
- Working videos take the **proxy byte-path** (bytes route through the contended 1-vCPU Fly box), unlike game videos which use `302→presigned-R2-direct`.

## Fix class: config (and/or byte-path change)

Two levers (pick per design gate; they compose):
1. **Pooled-httpx proxy TTFB** — apply the **T4630 `R2StreamProxy`** pattern (pooled/keep-alive httpx client) to `working_video/stream` so the proxy's TTFB isn't paying fresh-connection cost per request. This is the precedent config-level latency win.
2. **302→presigned-R2 for working videos** — if the overlay `<video>` can seed from a stable presigned-R2 URL (as game video does via `/api/games/{id}/video`), the bytes bypass Fly entirely. Trade-off: the bounded proxy exists to serve moov + windowed ranges; quantify whether overlay playback needs the bounded window or can take the direct object (T4000 §Design gate did this trade-off analysis — reuse the method).

Row 3 is compounded by the **T4772** warm-storm (4 concurrent working_video streams) — land T4772 first or together; measure Overlay after the storm is tamed to isolate the pure proxy-TTFB cost before deciding whether the 302 change is even needed (avoid a T3760-style fix for a contention artifact).

## Injected expertise (from T4770)

- **Byte paths:** `working_video/stream` / `games/{id}/stream` = bounded proxy through Fly (contended); `games/{id}/video` = 302→R2 direct (bypasses Fly). See `.claude/knowledge/export-pipeline.md` (working_video R2 refs) and `backend-services.md`.
- **T4630** is the pooled-httpx precedent (`R2StreamProxy` service; 4 streaming-proxy copies to unify).
- **Verify with a 2nd measurement** (T3760): re-time the proxy TTFB live AND after T4772, so a contention spike isn't mistaken for proxy-endpoint slowness.

## Constraints

- **Read/load-path only. No reactive persistence.**
- If touching the streaming proxy, respect the bounded-window contract (moov + clip ranges) — don't regress ranged playback.

## Verify

Re-run the T4770 walkthrough (after T4772) and diff `overlay:clicked → overlay:videoReady`; live re-time `GET /api/projects/{id}/working_video/stream` TTFB before/after the pooled-httpx change, co-timed with `/api/health`.

## Acceptance criteria

- [ ] Overlay first-video-paint (`overlay:clicked→videoReady`) drops materially vs the T4770 baseline.
- [ ] `working_video/stream` proxy TTFB improved (evidence: live before/after, co-timed with `/health`) OR working video seeds from 302→R2 direct.
- [ ] Bounded-window/ranged playback still correct.
- [ ] No reactive persistence; read-path only.
