# T4772: Tame the `warmAllUserVideos` Cache-Warming Storm

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Parent:** T4770 (Stage B fan-out). Evidence: [T4770-delay-ledger.md](T4770-delay-ledger.md) rows 2 & 6 (systemic).
**Priority:** HIGH — this is the systemic villain: a background preload that competes with the foreground on the single 1-vCPU Fly box, inflating the TTFB of the requests the user is actually waiting on.

## Problem (measured)

`warmAllUserVideos()` (`src/frontend/src/App.jsx:233` and `:336`) fires on every home mount and streams `GET /api/projects/{id}/working_video/stream` for MANY projects (observed: 30, 47, 49, 50 …) **concurrently, through the Fly bounded streaming proxy** (the byte path that routes through the contended box, not 302→R2-direct).

HAR evidence (T4770 cold walkthrough + live re-timing):
- The warm-storm 206 streams show `wait(TTFB)=490–990ms`, `ssl=600–990ms`, some with 9MB+ `receive`.
- **The tell:** concurrent foreground requests `GET /api/games/6/load` and `/api/games/6/video` show **1100–1450ms TTFB in the HAR** but **~100ms when re-timed live in isolation** (co-timed `/api/health` = ~80ms). So the storm is what inflated the foreground — the endpoints are fast. This is the exact T4000 trap: a HAR-only read would wrongly "optimize" `/load`/`/video`.
- The storm recurs on Annotate (47/49/50), Overlay (30/50/49/47), and My Reels (47/50/49) opens.

## Fix class: code / load-ordering

Make warming **foreground-first and bounded** so it never contends with what the user is looking at:
- Defer `warmAllUserVideos()` until the foreground screen is idle / its own video is ready (not on home mount before games even render).
- Cap concurrency hard (the box has 1 vCPU; N simultaneous proxy streams is self-defeating). Reuse the existing priority machinery: `setWarmupPriority`/`WARMUP_PRIORITY`/`clearForegroundActive` in `src/frontend/src/utils/cacheWarming.js` (it already has `inFlightControllers`, abort-on-foreground logic at ~L213, and clip-range vs full-warm separation).
- Don't warm **off-screen** projects on the home screen at all — warm the thing the user is about to open, not the whole library.

## Injected expertise (from T4770)

- **Two byte paths for video** (quantify per case): `GET /api/games/{id}/video` = 302→presigned R2, bytes **bypass Fly**; `GET /api/projects/{id}/working_video/stream` and `/api/games/{id}/stream` = **bounded proxy through the contended Fly box**. The storm is all proxy-path streams → maximum contention on the 1 vCPU.
- **Re-time live before blaming code** (T4000): the foreground endpoints are fast; the fix is to stop starving them, not to "speed up" `/load`.
- Existing loaders to keep the perceived path smooth: `VideoLoadingOverlay`, `SegmentedProgressStrip`.

## Constraints

- **Read/load-path only. No reactive persistence** — warming is a read; it must NOT trigger any `useEffect`→API write, and must not be reintroduced as a "cache to backend" side effect (CLAUDE.md; T4000 §4).
- Preserve the legitimate benefit (a warmed foreground video should still start fast) — this is a *scheduling/scoping* fix, not "delete warming."

## Verify

Re-run the T4770 walkthrough and confirm the foreground request TTFBs (`/games/6/load`, `/6/video`, overlay `working_video/stream`) drop toward their ~100ms live baseline, and My Reels `clicked→settled` shrinks. Compare `attribute.py` output before/after — the storm rows should no longer overlap foreground windows.

## Acceptance criteria

- [ ] `warmAllUserVideos` no longer fires a multi-project storm during a foreground load; concurrency is bounded.
- [ ] Foreground request TTFBs during Annotate/Overlay/My Reels approach their isolated live baselines (evidence: before/after `attribute.py`).
- [ ] Warmed-foreground fast-start still works.
- [ ] No reactive persistence; read-path only.
