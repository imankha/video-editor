# T1710: Buffering Spinner Feedback

**Status:** TESTING
**Impact:** 5
**Complexity:** 1
**Created:** 2026-04-22

## Problem

When the user seeks to an unbuffered position in a video (especially long game videos in annotate mode), the video just pauses with no visual feedback. The user has no way to know the video is buffering vs broken.

## Root Cause

`useVideo.js` already sets `isBuffering=true` in the store via the `waiting` event handler, and clears it on `playing`/`canplay`. But no UI component reads this state to show feedback.

## Fix

Read `isBuffering` from `useVideoStore` in `VideoPlayer.jsx` and render a lightweight spinner overlay when buffering mid-playback (not during initial load, which already has `VideoLoadingOverlay`).

## Files

| File | Changes |
|------|---------|
| `src/frontend/src/components/VideoPlayer.jsx` | Import `useVideoStore`, read `isBuffering`, render spinner |
