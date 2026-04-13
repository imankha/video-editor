# T1420: Warmup Abort Polish

**Status:** TODO
**Epic:** [Video Load Reliability](EPIC.md)
**Created:** 2026-04-13
**Follows:** T1410 (merged; landed warmer pause + StrictMode AbortController)

## Problem

T1410 fixed the 35–56s cold-load regression (post-fix: ~400–950ms). Verification log revealed three cosmetic issues worth cleaning up:

1. **Spurious failure log on intentional aborts.**
   When the warmer is paused for a foreground load, every in-flight fetch logs:
   ```
   [CacheWarming] Tail warm failed: signal is aborted without reason
   ```
   This is our own abort, not a real failure. Looks like an error in the log even though everything is working.

2. **StrictMode still fires the init load twice.**
   Dev-mode log shows:
   ```
   [FramingScreen] Initializing video for first clip: 2
   [useVideo] loadVideoFromStreamingUrl (RANGE REQUESTS) called with: …
   [FramingScreen] Initializing video for first clip: 2
   [useVideo] loadVideoFromStreamingUrl (RANGE REQUESTS) called with: …
   ```
   T1410 added an `AbortController` in the cleanup, but the effect body runs to completion synchronously before React invokes cleanup, so both loads already fired. The abort signal is honored only for the internal fetch inside `loadVideoFromStreamingUrl`; the outer `[useVideo] loadVideoFromStreamingUrl called` log fires both times. Not a perf issue (each load is <1s) but it's wasted work and clutters the log.

3. **`Warmup already in progress, skipping` fires twice** for the same reason — StrictMode echo on the mount effect that kicks off `warmAllUserVideos`.

## Target behavior

1. Catch `AbortError` explicitly in `cacheWarming.js` tail-warm / clip-range catch blocks. Log at `debug` level (or silent) with a different message: `[CacheWarming] aborted by foreground (expected)` — do not reuse the "failed" wording.
2. Add a short-lived module-level latch keyed by `{videoUrl, clipId}` in `useVideo.loadVideoFromStreamingUrl` (or the calling effect) so the second StrictMode invocation returns immediately without re-entering fetch logic. Clear the latch on unmount (real unmount, not StrictMode synthetic).
3. Ditto for `warmAllUserVideos` — the existing `warmupInProgress` guard logs once per invocation; collapse the second invocation silently or dedupe via a latch on the calling `useEffect`.

## Files

- `src/frontend/src/utils/cacheWarming.js` — abort-vs-failure log classification; silent-dedup for double-invoke
- `src/frontend/src/screens/FramingScreen.jsx` — effect-level latch per {clipId, videoUrl}
- `src/frontend/src/screens/AnnotateScreen.jsx` — same
- `src/frontend/src/hooks/useVideo.js` — optional: short-circuit `loadVideoFromStreamingUrl` if currently loading the identical URL

## Out of scope

- Revisiting warmer pause/resume logic (T1410 shipped it, verified working).
- Wall-clock regression harness (noted as known gap in T1410).

## Context

- Verification log from T1410 (2026-04-13, imankh@gmail.com session): framing cold load 952ms, annotate cold load 395ms. Abort wiring confirmed clean.
- This is polish only — shippable without it.

## Acceptance Criteria

- [ ] No `[CacheWarming] Tail warm failed` line emitted during a normal foreground-load abort
- [ ] Only one `[FramingScreen] Initializing video for first clip` log per real mount (dev mode)
- [ ] Only one `[CacheWarming] Warmup already in progress` log per real mount (or none)
- [ ] No regression in T1410 abort behavior — warmer still aborts and resumes correctly
- [ ] Existing cacheWarming tests still pass; add one for the abort-log classification
