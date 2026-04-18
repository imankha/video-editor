# T1535 - Verify Mobile Video Load Performance After Staging Push

**Status:** TODO
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

## Results Template

Fill in after testing:

| Test | Platform | Time-to-first-frame | _blocked_queueing | Priority shown | Pass? |
|------|----------|---------------------|--------------------|----------------|-------|
| 1 | iOS Safari | | N/A (no column) | N/A | |
| 2 | Chrome Android | | | | |
| 3 | 2nd project (iOS) | | | | |
| 3 | 2nd project (Android) | | | | |
| 4 | Cold load (iOS) | | | | |
| 4 | Cold load (Android) | | | | |

## Deliverables

- HAR captures from iOS Safari + Chrome Android showing load times
- Completed results table above
- If any regression: scope a follow-up fix task
- If verified: update PLAN.md status to TESTING
