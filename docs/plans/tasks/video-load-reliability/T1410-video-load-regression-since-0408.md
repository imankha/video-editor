# T1410: Fix Video Load Regression Since 2026-04-08 Deploy

**Status:** TODO
**Epic:** [Video Load Reliability](EPIC.md)
**Branch:** `feature/T1330-remove-guest-accounts` (must land here — blocks T1330 merge)
**Created:** 2026-04-13
**Blocks:** T1330 merge to master

## Problem

Staging (last deployed 2026-04-08, tag `deploy/frontend/2026-04-08-5`) loads videos quickly. On current `master` and on the T1330 branch, a cold load of an 8-second clip from a ~3GB / 90-min source takes **35–56 seconds** and post-load scrubs stall play/pause for many seconds.

User confirmed: **master reproduces the slowness locally**, so the regression is not T1330-specific. It was introduced by one of the commits merged to master between `deploy/frontend/2026-04-08-5` and `HEAD`, but the fix must ship on the `feature/T1330-remove-guest-accounts` branch because T1330 cannot merge until this is resolved.

## Observed log pattern

```
[CacheWarming] Queued: 1 project clips (tier 1), 3 games (3 large with tail warm), 1 gallery, 0 working
[CacheWarming] Starting 5 workers for 5 videos (priority: games)
[VIDEO] Loading: https://…r2.cloudflarestorage.com/…mp4
[VIDEO] Mode: STREAMING (range requests)
[VIDEO] SLOW LOAD: 35250ms for 5649.4s video
[SCRUB] seek(1924.63) → readyState drops 4→1
[SCRUB] event:waiting …          ← play() stalls here
[SCRUB] play() aborted (normal — interrupted by pause/seek)
```

readyState=1 (HAVE_METADATA) after every seek means the browser must range-fetch the new region. During that wait, `play()` returns a promise that doesn't resolve until `seeked` fires. `pause()` aborts it. That *feels* broken but is network-bound, not logic-bound.

## Suspects (between `deploy/frontend/2026-04-08-5` and `master`)

All three landed Apr 9, same day, after the last deploy:

1. **57f03a0** "T1210: smart video preloading & clip-scoped loading" — rewrote `cacheWarming.js` to 3-tier priority system, 5 concurrent workers issuing `tail warm` range-fetches against *every* game (3 × 3GB in the reproduced session). Highest a-priori suspicion: the warmer is now racing the foreground `<video>` range-fetch on the same R2 origin.
2. **d5a2d51** "T1350: switch cache warming to no-cors" — `no-cors` fetches are opaque, can force full-body download instead of honoring 206.
3. **446ba0a** "Add playback diagnostics, remove unproven warmup pause/resume" — removed the mitigation that would have paused warmups during foreground load. Commit message says A/B testing showed stalls happen even with fully-buffered blobs; verify whether that test was representative (it may have been on small videos).

## Investigation plan

1. **Confirm the regression commit via bisect**
   ```bash
   git bisect start master deploy/frontend/2026-04-08-5
   # mark each checkout bad/good by cold-loading the same game on a fresh profile
   ```
   Measure: time from `[VIDEO] Loading` to `[VIDEO] SLOW LOAD` or to first `seeked`. Target: identify the single commit that pushed cold-load over ~10s.

2. **If T1210 (57f03a0) is the culprit**, the fix is T1400's plan — port it onto this branch:
   - Add `WARMUP_PRIORITY.FOREGROUND_ACTIVE`.
   - Abort in-flight warm fetches via `AbortController` when `useVideo.loadVideoFromStreamingUrl` starts.
   - Clear the priority on `loadeddata` or error.
   See [T1400-video-load-contention.md](T1400-video-load-contention.md) for the full design.

3. **If T1350 (d5a2d51) is the culprit**, revert the `no-cors` switch on the warmer and re-solve the CORS console spam a different way (e.g., silence the specific offending requests, or add `Access-Control-Allow-Origin` on R2 bucket CORS policy).

4. **If 446ba0a is the culprit**, restore warmup pause/resume; the original A/B finding may have been on videos small enough that warmer contention was not the bottleneck.

5. **Fix the StrictMode double-mount** regardless of which commit caused the regression. `FramingScreen.jsx:458` and the equivalent in `AnnotateScreen.jsx` fire `loadVideoFromStreamingUrl` twice in dev. Use an `AbortController` returned from the effect cleanup so the first request is canceled when StrictMode remounts.

## Acceptance criteria

- [ ] Cold-load of 8s clip from 3GB source on this branch ≤ 10s (matching staging)
- [ ] After scrub, `play()` resumes within ≤ 1s once buffered
- [ ] No regression of T1350's CORS fix (console stays clean)
- [ ] Branch is mergeable; all existing tests pass
- [ ] Add a test or measurement harness that fails if cold-load exceeds 10s on a fixture video (so this doesn't regress silently again)

## Files likely affected

- `src/frontend/src/utils/cacheWarming.js` — priority state, abort logic
- `src/frontend/src/hooks/useVideo.js` — set/clear priority on load start/end; honor abort on cleanup
- `src/frontend/src/screens/FramingScreen.jsx` — effect dedup
- `src/frontend/src/screens/AnnotateScreen.jsx` — effect dedup
- `src/frontend/src/components/VideoPlayer.jsx` — possibly revisit `#t=` fragment if it causes full-file fetches on some paths

## Out of scope

- mp4 faststart / moov atom relocation (T1380 already shipped for new uploads). If existing R2 videos have trailing moov, that is a separate pre-existing issue and should be logged separately.
- Production deploy of the fix — user will deploy after merge.

## Context

- Last green deploy: `deploy/frontend/2026-04-08-5` (2026-04-08)
- First suspected regression commit: `57f03a0` (2026-04-09)
- User report: "when I play staging I don't see a long loading problem or a scrub or play problem … master also loads slowly"
- Related tasks: T1400 (same fix pattern, defers to this one), T1210 (likely author of regression), T1350 (no-cors change), T1360 (blob URL recovery — shipped same window)
- Diagnostic `[SCRUB]`-tagged logs already in `useVideo.js` (commit 467de1d) — use them to measure.

## Result (fill after fix)

| Metric | Before | After |
|---|---|---|
| Cold-load 8s clip from 3GB source | 35–56s | — |
| Scrub → play resume latency | multi-second stalls | — |
| Warmer aborts on foreground load | No | — |
| StrictMode double-mount deduplicated | No | — |
| Regression commit identified | — | — |
