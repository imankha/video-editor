# T3760: Framing Clip Cold-Load Over-Fetch (re-evaluate range clamping)

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-06-17
**Updated:** 2026-06-17

## Problem

The framing editor's clip video takes ~4.3s to appear because of a **cold over-fetch from R2**, traced in `Downloads/localhost.har` (captured 2026-06-17).

What the HAR shows for the clip on project 46 / clip 48:
- The source game video is **3.05 GB** (`content-range` total = 3,051,071,723 bytes).
- The clip lives ~66% into that source. The `<video>` element points at the **direct R2 presigned URL** (`*.r2.cloudflarestorage.com`), not the bounded proxy.
- The browser issues an **open-ended range** `bytes=2019000320-` → R2 serves "that offset to EOF" → the browser over-buffers far past the clip window.
- Measured: **3.4 MB received in 4281 ms (~6 Mbps)** on a cold deep-offset R2 read. That receive time is the stall before the video appears.

This is the latency the user reported as "bottlenecking the video from appearing." (For the record: the per-file tag/JS "downloads" the user also noticed are a **dev-mode Vite artifact** — 258 `/src/` module requests that bundle into one gzipped chunk in prod — and are NOT a bottleneck. No action there.)

Why it matters: framing is a core step in the editing loop. A ~4s cold load per clip is real friction, worse on multi-clip projects and slower connections.

## Solution

A **spike → decide → implement** task (don't pre-commit to one fix):

1. **Confirm faststart.** Check whether the clip's source has `moov` at the front. The seek to byte ~2.0 GB may partly reflect a non-front `moov`. If sources aren't guaranteed faststart, **T2580 (faststart-on-upload + remux)** likely removes the tail/deep probe and is the cheapest fix.

2. **Quantify the over-fetch.** On the direct-R2 path there is no `Content-Length` clamp, so the browser pulls N-to-EOF. Measure how far past the clip window it buffers, then pick the lowest-complexity bound:
   - **(a) Edge range-clamping via the CDN Worker (re-open T2560).** Clamp `Content-Length` at the edge so the browser stops at the clip end, **without** the Fly.io proxy throughput cap. This is the "best of both": direct-CDN throughput + bounded bytes. T2560 is currently marked *"likely skipped — user-owned content, zero egress"* — that rationale is about **egress cost**, but this is a **latency** problem, so the skip should be reconsidered with this HAR as evidence.
   - **(b) MSE-driven bounded fetch on the client** (fetch only the clip byte window, append to a `MediaSource`). More complex; only if (a) is infeasible.

3. **Warm the edge.** Ensure CDN edge-cache warming (T2550 + the T2040 cache-warming system) makes cold deep-offset reads rare for clips the user is about to view.

**Do NOT** simply flip the framing editor back to the bounded `/stream` proxy as primary — that reintroduces the ~590 KB/s Fly.io proxy throughput cap that **T3250 deliberately removed**. The goal is direct-R2/CDN throughput *and* bounded bytes.

Likely outcome: faststart guarantee (T2580) + edge range-clamping via the CDN Worker (un-skip T2560), making the framing clip appear in <1.5s instead of ~4.3s.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FramingScreen.jsx` — `getClipVideoConfig` (~L385-420): uses the **direct R2 presigned URL as primary**, the bounded `/stream` proxy only as an error fallback.
- `src/backend/app/routers/clips.py` — `get_clip_playback_url` (~L1624, returns presigned R2 URL); `stream_working_clip_bounded` (~L1665, the existing T1430 3-window MOOV-head/MOOV-tail/clip-window clamp that is now dormant on the happy path).
- `src/backend/app/routers/games.py` — `get_game_video_url`, game `playback-url` / `stream`.
- `src/frontend/src/utils/cacheWarming.js` — warming system (T2040), relevant to edge warming.
- `docs/plans/tasks/r2-cdn/T2560-edge-video-worker.md` — the clamping task this re-opens.
- `docs/plans/tasks/r2-cdn/T2580-faststart-upload-validation.md` — faststart-on-upload.
- `docs/plans/tasks/r2-cdn/T2550-r2-custom-domain-cdn.md` — CDN Worker this would extend.
- Evidence: `Downloads/localhost.har` (2026-06-17).

### Related Tasks
- Informs / re-opens: **T2560** (Edge Byte-Range Clamping — currently "likely skipped" on egress grounds)
- Pairs with: **T2580** (Faststart Upload Validation), **T2550** (CDN + Auth Worker), **T2040** (Connection-Aware Cache Warming)
- Background: **T3250** (Direct R2 Video Streaming — why direct-R2 is primary), **T1430** (the bounded `/stream` proxy + its over-buffer rationale)

### Technical Notes
- **R2 egress is free**, so over-fetch is NOT a cost problem — it's a **latency** problem on cold, deep-offset reads of multi-GB sources. That distinction is the whole reason to revisit T2560's "likely skip."
- The HAR was captured against the **dev server**, but the slow request is a **real direct fetch to R2** (`r2.cloudflarestorage.com`), so the ~4.3s is production-relevant, not a localhost artifact.
- App boot (~2.5s) precedes the first clip byte in the HAR, but that's mostly the dev module waterfall and collapses in a prod bundle — not in scope here.

## Implementation

### Steps
1. [ ] Reproduce the cold over-fetch and capture before-numbers (time-to-first-frame for clip 48).
2. [ ] Determine whether the clip source is faststart (moov at front). If not, validate T2580 fixes the deep probe.
3. [ ] Measure how far past the clip window the direct-R2 path over-buffers.
4. [ ] Write a short decision doc: faststart-only vs edge range-clamp (T2560) vs MSE, with measured numbers.
5. [ ] Implement the chosen fix (most likely: faststart guarantee + edge clamp via CDN Worker).
6. [ ] Re-measure; confirm target.

### Progress Log

**2026-06-17**: Created from HAR analysis. Root cause: direct-R2 presigned playback (T3250) over-fetches an open-ended range at a ~2.0 GB offset into a 3 GB source; 3.4 MB / 4.3s cold receive. Bounded `/stream` proxy (T1430) exists but is only the error fallback. Tags/JS confirmed NOT a bottleneck (dev-mode module artifact).

## Acceptance Criteria

- [ ] Decision doc comparing faststart (T2580) vs edge range-clamp (re-open T2560) vs MSE, citing the measured over-fetch numbers.
- [ ] Framing clip cold-load measured before/after; target time-to-first-frame < 1.5s for the clip in the HAR.
- [ ] Fix does NOT reintroduce the Fly.io proxy throughput cap (no flipping `/stream` back to primary).
- [ ] T2560's "likely skipped" status explicitly resolved (kept-skip with rationale, or un-skipped and scoped).
