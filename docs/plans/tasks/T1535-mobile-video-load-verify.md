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

After the next staging push:

1. **iOS Safari (physical device preferred, simulator acceptable):**
   - Open a project with a working_video on reelballers-staging
   - Measure time-to-first-frame (stopwatch or Safari Web Inspector → Network timeline)
   - Target: < 1s to first frame on a warm connection
   - Confirm no 15s stall between tap and video becoming interactive

2. **Chrome Android (physical device preferred):**
   - Same flow on a mid-tier Android phone
   - Use chrome://inspect → DevTools → Network with "Slow 3G" off
   - Confirm `fetchpriority="high"` is respected (check request priority column)

3. **Both:** try opening a second project in the same session — confirm the extractor fetch does NOT queue behind the VideoPlayer request (same concern as desktop — both should be High priority now).

## Fallback if mobile is still slow

If Safari/Chrome Android still shows the defer:

- Option A: drop the hidden metadata extractor entirely on mobile (detect via `navigator.userAgent` or `matchMedia('(hover: none)')`) and rely on persisted `width/height/fps` from T1500. The extractor is only a fallback for older clips missing those fields.
- Option B: preload metadata via the same-origin proxy instead of cross-origin R2, removing the "cross-origin media defer" classification entirely on mobile.

## Dependencies

- Staging deploy that includes T1533 fixes (videoMetadata.js rewrite, VideoPlayer.jsx fetchpriority, transitions +faststart)

## Deliverables

- HAR captures from iOS Safari + Chrome Android (before/after load times)
- If any regression: scope a follow-up fix, otherwise close as verified
