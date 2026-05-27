# T3160: Screenshot Regression

**Epic:** [Bug Report Diagnostic Quality](EPIC.md)
**Status:** TODO
**Stack Layers:** Frontend
**Files Affected:** ~1-2 files
**LOC Estimate:** ~20 lines
**Test Scope:** Manual (visual verification on staging)

## Problem

Bug #1's screenshot is a 1170x2695px image showing garbled, duplicated content with dark voids where video should be. The user reports screenshots were "fairly good (just missing video)" during the email-based system.

## Investigation Summary

### What did NOT change

The T3100 commit (email → Postgres+R2 storage) **did not modify any frontend code**. The screenshot bytes produced by `captureScreenshot()` are identical in both systems. The `ReportProblemButton.jsx` screenshot capture code has been the same since `7b1ca607` (May 7).

### What did change

The **app's layout grew taller** over time. New features, panels, and code-split routes added more content to `document.body`. Since `html2canvas(document.body)` captures the full scrollable height (not just the viewport), the resulting image got proportionally taller and more garbled:

- **Viewport**: ~1170x900 (normal screen)
- **Captured image**: 1170x2695 (full body, 3x taller than viewport)

### Two specific bugs in the capture

1. **Full body capture**: `html2canvas(document.body, { scale: 0.75 })` renders ALL of `document.body` including below-fold content. No viewport constraint. This produces the doubled/garbled tall image.

2. **Video dark voids**: `captureVideoFrames()` (added `7b1ca607`) tries to draw each `<video>` to a canvas and replace it in the clone. `crossOrigin="anonymous"` was added to video elements (`b47a8e05`). Despite this, the catch block silently eats `SecurityError` (tainted canvas). Likely cause: the `crossOrigin` attribute is set at render time, but if the video source changed (e.g., presigned URL refreshed) after initial load, the browser may re-taint the canvas.

### Why it "looked OK" in email

Gmail renders email attachments in a constrained preview pane. The tall image was auto-scaled to fit, making the duplicated content less noticeable. When viewed at native resolution (as the R2 presigned URL serves it), the problems are obvious.

## Fix

### 1. Constrain html2canvas to viewport

In `captureScreenshot()` in `src/frontend/src/components/ReportProblemButton.jsx`:

```javascript
const canvas = await html2canvas(document.body, {
  scale: 1.0,                          // was 0.75 — R2 can handle larger files
  width: window.innerWidth,            // NEW: viewport width only
  height: window.innerHeight,          // NEW: viewport height only
  x: window.scrollX,                   // NEW: scroll position
  y: window.scrollY,                   // NEW: scroll position
  useCORS: true,
  logging: false,
  backgroundColor: '#111827',
  onclone: ...
});
```

### 2. Debug video frame capture

Add visible error logging to `captureVideoFrames()` catch block so cross-origin failures are captured in console logs (which ARE sent with the bug report):

```javascript
} catch (err) {
  console.warn('[ReportProblem] Video frame capture failed for element:', 
    video.src?.substring(0, 80), err?.message);
}
```

Also verify: does `videoFrames.get(originalVideos[i])` match correctly? The `originalVideos` array is captured before `html2canvas` clones the DOM, so index matching should work. But if videos are dynamically added/removed between capture and clone, the indices could mismatch.

### 3. Consider fallback for video

If the crossOrigin issue can't be resolved (R2 presigned URLs may not return correct CORS headers for canvas capture), add a fallback: overlay a "Video playing at {currentTime}s" text label on the dark void so the screenshot at least communicates the video state.

## Files

- `src/frontend/src/components/ReportProblemButton.jsx` — `captureScreenshot()` and `captureVideoFrames()` functions

## Verification

1. Deploy to staging
2. Navigate to each mode (annotate, framing, overlay)
3. Click "Report a problem" and submit
4. Download the screenshot from R2 via admin endpoint
5. Confirm: viewport-sized image (~1170x900), readable text, video frame visible (or labeled fallback)

## Future: Screenshot Lab

A separate task (outside this epic) will deploy a test branch to staging with a "screenshot lab" button that captures the same view using multiple techniques (html2canvas, video-only canvas, native Screen Capture API, hybrid composite). The user can take screenshots across different pages and browsers, then compare results empirically to choose the best approach going forward.

## Dependencies

None. Independent of T3150/T3170/T3180.
