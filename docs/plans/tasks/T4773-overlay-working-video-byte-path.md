# T4773: Overlay/Working-Video Byte Path — Proxy TTFB (pooled-httpx) or 302→R2

**Status:** STAGING — KEEP (pooled-httpx, lever 1). Storm-isolated re-measure confirmed a real residual proxy-TTFB cost.

## Outcome (2026-07-09, post-T4772 storm fix, in-container dev stack)

**STEP 0 verdict: PROCEED (not DROP).** Re-measured on the storm-free base first: live isolated
`working_video/stream` TTFB median **245ms** while co-timed `/health` was flat at ~2ms → not a
contention artifact; the endpoint was paying **two** fresh-TLS R2 round-trips per request (a 1-byte
size probe + the stream). Real residual cost → proceeded with **lever 1 only** (pooled-httpx +
single round-trip). Lever 2 (302→presigned-R2) was NOT needed.

**Fix:** `src/backend/app/routers/projects.py:stream_working_video` — module-level pooled httpx client
`_get_working_video_r2_client()` (keepalive, mirrors `downloads.py:_get_r2_stream_client`, T4630) and
dropped the size-probe: GET forwards the client's Range to R2 in one round-trip and passes R2's
status/Content-Range/Content-Length through unchanged (working_videos aren't byte-windowed, so R2's 206
is authoritative). HEAD keeps a 1-byte probe. Scoped to this endpoint only (four-proxy unification is a
separate task).

**Before → after (medians):**

| Metric | Base | After | Δ |
|---|---|---|---|
| overlay `clicked→videoReady` (walkthrough ×3) | 3474ms | 2136ms | **-39%** |
| HAR main-stream first-byte (ssl+wait, under overlay burst) | 1037ms | 408ms | **-61%** |
| HAR all-request first-byte median | 1334ms | 682ms | **-49%** |
| live isolated single-request TTFB (×5, co-timed `/health` ~2ms) | 245ms | 224ms | -9% |

The isolated single-request number barely moves (a lone request has no warm pool to reuse; its only
saving is the eliminated probe round-trip, small vs in-container R2 RTT). The win is under the
concurrent Range burst Chrome fires when overlay opens — exactly where fresh-TLS-per-request stacked.

**Correctness (verified live vs real app):** GET 200 full (9638173B); 206 with correct Content-Range for
head-range and mid-file seek; HEAD 200 with Content-Length; 416 for unsatisfiable range; byte-integrity
(full file md5 == concatenated ranges md5); valid faststart MP4 (ftyp→moov→mdat). Ranged playback intact.

**Test note:** `tests/test_stream_auth.py` / `test_t1690_stream_proxy_probe.py` can't collect in-container
(pre-existing starlette `TestClient(app=...)` vs installed httpx mismatch — fail identically with the edit
stashed). Verification is the live integration evidence above.

**Original status:** TODO
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

- [x] Overlay first-video-paint (`overlay:clicked→videoReady`) drops materially vs the T4770 baseline. — 3474→2136ms (-39%), ×3 walkthrough medians.
- [x] `working_video/stream` proxy TTFB improved (evidence: live before/after, co-timed with `/health`) — HAR main-stream first-byte 1037→408ms (-61%) under the overlay burst; live isolated 245→224ms; `/health` flat ~2ms. (Kept lever 1; 302→R2 not needed.)
- [x] Bounded-window/ranged playback still correct. — live: 206 Content-Range for head+mid-file seek, 416 unsatisfiable, byte-integrity match, faststart MP4 (ftyp→moov→mdat).
- [x] No reactive persistence; read-path only. — pure GET/HEAD proxy; no writes.
