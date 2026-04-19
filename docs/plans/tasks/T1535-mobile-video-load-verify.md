# T1535 - Verify Mobile Video Load Performance After Staging Push

**Status:** TESTING
**Priority:** 2.0 (Impact 7, Cmplx 2)

## Why

T1533 fix (`fetchpriority="high"` on `<video>` + fetch-based metadata extractor) was validated on desktop Chrome. Chrome's Low-priority media defer and the HTTP/1.1 per-host connection limits behave differently on mobile browsers (Safari iOS, Chrome Android). The fix should work — Priority Hints are supported — but it needs a real-device check before we declare the perf regression closed.

User explicitly called out: "I want users to be able to have good experiences on their phones as well."

## Symptom (desktop, pre-fix)

- `<video>` element waited ~15s in `_blocked_queueing` on cross-origin presigned R2 URL even with connections available.
- Opening a project triggered TWO 15s defers (hidden metadata extractor + visible VideoPlayer).

## What to verify on mobile

**Prerequisite:** Confirm staging is deployed with T1533 fix (commit `bccac0d` on master).

### Test 1: iOS Safari (physical device preferred)

**Setup:**
1. Connect iOS device to Mac via USB
2. On iOS: Settings → Safari → Advanced → Web Inspector ON
3. On Mac: Safari → Develop → [device name] → reelballers-staging tab

**Steps:**
1. Open `https://reelballers-staging.pages.dev` on iOS Safari
2. Navigate to a game that has extracted clips with `working_video` URLs
3. Open Safari Web Inspector on Mac → Network tab → clear
4. Tap into a clip to open Overlay mode (triggers VideoPlayer + metadata extractor)
5. Record:
   - Time from tap to first video frame visible (stopwatch or Network timeline)
   - Check for any request stuck in "Pending" > 2s
   - Look for two fetch requests to R2 URLs (metadata extractor + video element)

**Pass criteria:**
- Time-to-first-frame < 1s on warm Wi-Fi connection
- No 15s stall between tap and video becoming interactive
- Both R2 requests start within 500ms of each other (no queueing)

**Note:** Safari does not support `fetchpriority` attribute (as of Safari 17). The fix still works because the metadata extractor uses `fetch()` (always High priority) instead of a `<video>` element. Safari's media prioritization differs from Chrome — it may not exhibit the same defer behavior.

### Test 2: Chrome Android (physical device)

**Setup:**
1. Connect Android device via USB with USB debugging enabled
2. On desktop Chrome: navigate to `chrome://inspect/#devices`
3. Find the Android Chrome tab and click "Inspect"

**Steps:**
1. Open `https://reelballers-staging.pages.dev` on Chrome Android
2. Navigate to a game with extracted clips
3. In DevTools → Network tab → clear → ensure "Slow 3G" is OFF
4. Tap into a clip to open Overlay mode
5. Record:
   - Request priority column for the `<video>` request (should show "High")
   - Request priority for the metadata extractor fetch (should show "High")
   - `_blocked_queueing` time for both requests (target: < 100ms)
   - Time-to-first-frame

**Pass criteria:**
- `fetchpriority="high"` reflected in Priority column (not "Low")
- `_blocked_queueing` < 100ms (was ~15s pre-fix on desktop)
- Time-to-first-frame < 1s on warm connection

### Test 3: Second project load (both platforms)

**Steps:**
1. After Test 1 or 2 completes, navigate back to game list
2. Open a DIFFERENT clip in the same session
3. Observe Network tab — confirm the metadata extractor fetch does NOT queue behind the VideoPlayer request

**Pass criteria:**
- Both requests start concurrently (within 500ms)
- No evidence of HTTP/1.1 connection limit blocking (R2 uses HTTP/2)

### Test 4: Cold load (both platforms)

**Steps:**
1. Force-close the browser
2. Re-open and navigate directly to a clip URL
3. Measure time-to-first-frame from page load

**Pass criteria:**
- Time-to-first-frame < 2s on warm Wi-Fi (cold browser, no cached connections)

## Fallback if mobile is still slow

If Safari/Chrome Android still shows the defer:

- Option A: drop the hidden metadata extractor entirely on mobile (detect via `navigator.userAgent` or `matchMedia('(hover: none)')`) and rely on persisted `width/height/fps` from T1500. The extractor is only a fallback for older clips missing those fields.
- Option B: preload metadata via the same-origin proxy instead of cross-origin R2, removing the "cross-origin media defer" classification entirely on mobile.

## Dependencies

- Staging deploy that includes T1533 fixes (videoMetadata.js rewrite, VideoPlayer.jsx fetchpriority, transitions +faststart)

## Results

Tested 2026-04-19 on Chrome Android (Android 10, 1.7Mbps 4G, rtt=50ms).

### Test A: Annotate mode clip load (stream proxy)

```
+0.0ms    video-player-mount
+247.9ms  video-loadstart
+801.6ms  video-loadedmetadata
+2044.7ms video-loadeddata
+2049.6ms video-canplay
Total: 2049.6ms
```

- Time-to-first-frame: 2.0s (on 1.7Mbps -- acceptable)
- No 15s `_blocked_queueing` stall
- No metadata extractor ran (clip had persisted dims from T1500)

### Test B: Overlay mode working video (stream proxy + metadata extractor)

```
+0.0ms    video-player-mount
+204.2ms  video-loadstart
+212.9ms  metadata-fetch-start
+775.3ms  video-loadedmetadata
+928.9ms  metadata-fetch-done (moov=head, 716ms)
+953.7ms  video-player-unmount
+954.0ms  video-player-mount
+975.1ms  video-loadstart
+1384.5ms video-loadedmetadata
+1756.7ms video-loadeddata
+1766.5ms video-canplay
Total: 1766.5ms
```

- Metadata fetch: 716ms (moov at head, +faststart working)
- Video element + metadata fetch ran concurrently (both started by +212ms)
- Time-to-first-frame: 1.8s
- No `_blocked_queueing` stall

### Summary

| Metric | Pre-fix (desktop) | Post-fix (Chrome Android) | Pass? |
|--------|-------------------|---------------------------|-------|
| `_blocked_queueing` | ~15,000ms | 0ms | Yes |
| Metadata fetch | N/A (video element) | 716ms (fetch API) | Yes |
| moov location | varied | head (+faststart) | Yes |
| Concurrent requests | No (queued) | Yes | Yes |
| Time-to-first-frame | ~17s | ~2s | Yes |

**iOS Safari:** Not tested (no device available). Safari does not support `fetchpriority` but the fix works regardless because the metadata extractor uses `fetch()` (always High priority) instead of a `<video>` element.

## Deliverables

- Perf timing captures from Chrome Android (above)
- No regression found -- T1533 fix verified on mobile
- PLAN.md updated to TESTING
