# T1890: Multi-Clip Project Cache Warming

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-25

## Problem

When a user opens a multi-clip project in framing, only the first clip loads fast. Switching to clips 2-5 causes 10-48s cold loads. The warming system *does* queue all clips correctly, but the warmer gets killed before it finishes.

## Root Cause Analysis

The warming pipeline for multi-clip projects:

1. **FramingScreen.jsx:416-436** — `pushClipRanges()` queues ALL clips to tier-1 (correct)
2. **cacheWarming.js:522** — Ranges added to FRONT of tier1Queue (correct)
3. **useProjectLoader.js:106** — `setWarmupPriority(FOREGROUND_ACTIVE)` fires on project load
4. **cacheWarming.js:116** — FOREGROUND_ACTIVE is a one-way latch that **permanently disables the warming worker** and aborts all in-flight warm fetches

Result: clip 1 may partially warm, clips 2-5 never warm. When the user switches to clip 2, `warmVideoCache()` is called but it's a no-op because the warmer is already disabled.

### Secondary gap: Exported projects excluded from tier-1

`storage.py:321` filters `WHERE p.final_video_id IS NULL` — exported projects only get gallery warming (the merged final video), not individual clip ranges. Re-editing an exported multi-clip project cold-loads every clip.

## Solution

The core fix: don't kill the warming worker when loading a clip. The FOREGROUND_ACTIVE latch was designed to prevent warming from competing with active video loads for bandwidth, but it's too aggressive — it kills warming for ALL clips when only ONE is loading.

Options to investigate:

1. **Exempt tier-1 clip ranges from the FOREGROUND_ACTIVE kill** — Let the warmer continue processing the current project's clips even after FOREGROUND_ACTIVE fires. Only pause/abort warming for lower-tier items (games, gallery).

2. **Defer FOREGROUND_ACTIVE until video is playable** — Don't fire the latch on `loadstart`, fire it on `canplay`. This gives the warmer a window to process clip ranges while clip 1 is still buffering.

3. **Warm all project clips synchronously before loading clip 1** — In FramingScreen's useLayoutEffect, warm all clip ranges before calling loadVideo. Downside: may delay first clip load.

Option 1 is likely best — it preserves the bandwidth protection for non-project items while allowing the current project's clips to warm.

## Relevant Files

- `src/frontend/src/utils/cacheWarming.js` — warming worker, queues, FOREGROUND_ACTIVE latch (line 116), pushClipRanges (line 496-528)
- `src/frontend/src/hooks/useProjectLoader.js` — fires FOREGROUND_ACTIVE on project load (line 106)
- `src/frontend/src/hooks/useVideo.js` — fires FOREGROUND_ACTIVE on video load (line 8+)
- `src/frontend/src/screens/FramingScreen.jsx` — pushClipRanges for all clips (lines 416-436), clip switching (lines 542-606)
- `src/backend/app/routers/storage.py` — warmup endpoint, exported project exclusion (line 321)

## Acceptance Criteria

- [ ] Opening a 3-clip project warms all 3 clips' byte ranges before the user switches
- [ ] Switching between clips in an already-opened project loads in <3s (vs 10-48s currently)
- [ ] Warming tier-1 project clips continues even after FOREGROUND_ACTIVE fires
- [ ] Lower-tier warming (games, gallery) is still correctly paused during active video loads
- [ ] Console logs show all clips being warmed with `[CacheWarming]` tag
