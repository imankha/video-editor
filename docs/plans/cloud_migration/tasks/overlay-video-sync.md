# Task: Fix Overlay Video/Tracking Square Synchronization

## Overview
Fix two desync bugs in Overlay mode where tracking squares (highlight ellipses) and playhead become out of sync with the actual video frame being displayed.

## Status
**PLANNED** - Ready for implementation

## Priority
**HIGH** - Affects core user experience in Overlay mode

---

## Bug Reports

### Bug 1: Buffering Desync
**Scenario**: Video is playing, network hiccup causes buffering
**Expected**: Playhead and tracking squares pause while video buffers
**Actual**: Video frame freezes, but playhead and tracking squares continue advancing
**Root Cause**: RAF loop reads `videoRef.currentTime` which advances even during buffer stalls

### Bug 2: Scrubbing Desync
**Scenario**: User scrubs the timeline quickly
**Expected**: Tracking squares match the displayed video frame
**Actual**: Old tracking squares visible briefly; squares update before video frame catches up
**Root Cause**: `seek()` immediately updates React state before browser finishes seeking to new frame

---

## Current Architecture Analysis

### Time Flow (Current)
```
videoRef.currentTime (browser-reported)
    ↓ RAF loop (~60fps)
setCurrentTime(videoRef.currentTime)  ← Immediately trusted
    ↓
currentHighlightState = useMemo(..., [currentTime])
    ↓
<HighlightOverlay /> renders at currentTime position
```

### Problems Identified

1. **No buffering event handlers** - The system doesn't listen to:
   - `onWaiting` - Video stalled, needs buffering
   - `onPlaying` - Video resumed after buffering
   - `onStalled` - Network stall detected
   - `onCanPlay` / `onCanPlayThrough` - Ready to play

2. **Seek completes asynchronously** - In `useVideo.js`:
   ```javascript
   const seek = (time) => {
     videoRef.currentTime = validTime;   // Set target
     setCurrentTime(validTime);          // Update UI immediately ← BUG
   };
   ```
   The UI updates to target time before video actually displays that frame.

3. **RAF loop doesn't check video state** - Currently:
   ```javascript
   if (videoRef.current && !isSeeking) {
     setCurrentTime(videoRef.current.currentTime);
   }
   ```
   Only checks `isSeeking`, not `isBuffering` or `readyState`.

---

## Proposed Solution

### Approach: "Video Frame as Source of Truth"

The core principle: **Never update UI until the video frame actually changes.**

### Implementation Tasks

#### Task 1: Add Video State Tracking

**File:** `src/frontend/src/stores/videoStore.js`

Add new state:
```javascript
// Video playback state
isBuffering: false,
setIsBuffering: (isBuffering) => set({ isBuffering }),

// For frame-accurate sync (optional, see Task 4)
lastRenderedFrame: null,
setLastRenderedFrame: (frame) => set({ lastRenderedFrame: frame }),
```

#### Task 2: Add Buffering Event Handlers

**File:** `src/frontend/src/hooks/useVideo.js`

Add event handlers:
```javascript
// Buffering detection
const handleWaiting = () => {
  console.log('[Video] Buffering started');
  setIsBuffering(true);
};

const handlePlaying = () => {
  console.log('[Video] Playback resumed');
  setIsBuffering(false);
};

const handleCanPlay = () => {
  // Video has enough data to play
  if (isBuffering) {
    setIsBuffering(false);
  }
};

// Attach to video element
videoRef.current.addEventListener('waiting', handleWaiting);
videoRef.current.addEventListener('playing', handlePlaying);
videoRef.current.addEventListener('canplay', handleCanPlay);
```

#### Task 3: Pause RAF Loop During Buffering

**File:** `src/frontend/src/hooks/useVideo.js`

Update RAF loop to skip updates during buffering:
```javascript
useEffect(() => {
  if (!isPlaying || !videoRef.current) return;

  let rafId;
  const updateTime = () => {
    // Skip updates if buffering or seeking
    if (videoRef.current && !isSeeking && !isBuffering) {
      // Additional check: video is actually progressing
      const readyState = videoRef.current.readyState;
      if (readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        setCurrentTime(videoRef.current.currentTime);
      }
    }
    rafId = requestAnimationFrame(updateTime);
  };

  rafId = requestAnimationFrame(updateTime);
  return () => cancelAnimationFrame(rafId);
}, [isPlaying, isSeeking, isBuffering]);
```

#### Task 4: Fix Seek to Wait for Frame

**File:** `src/frontend/src/hooks/useVideo.js`

Option A: Wait for `seeked` event before updating state
```javascript
const seek = (time) => {
  if (videoRef.current && videoRef.current.src) {
    const validTime = Math.max(0, Math.min(time, duration));

    setIsSeeking(true);
    videoRef.currentTime = validTime;
    // DON'T update currentTime here - wait for seeked event
  }
};

const handleSeeked = () => {
  setIsSeeking(false);
  if (videoRef.current) {
    setCurrentTime(videoRef.current.currentTime);  // Update AFTER seek completes
  }
};
```

Option B: Use `requestVideoFrameCallback` (more precise, Chrome/Edge only)
```javascript
const seek = (time) => {
  if (videoRef.current && videoRef.current.src) {
    const validTime = Math.max(0, Math.min(time, duration));

    setIsSeeking(true);
    videoRef.currentTime = validTime;

    // Wait for actual frame render
    if ('requestVideoFrameCallback' in videoRef.current) {
      videoRef.current.requestVideoFrameCallback((now, metadata) => {
        setCurrentTime(metadata.mediaTime);
        setIsSeeking(false);
      });
    } else {
      // Fallback for Safari/Firefox
      videoRef.current.addEventListener('seeked', () => {
        setCurrentTime(videoRef.current.currentTime);
        setIsSeeking(false);
      }, { once: true });
    }
  }
};
```

#### Task 5: Show Buffering Indicator in UI (Optional)

**File:** `src/frontend/src/modes/OverlayModeView.jsx`

```jsx
{isBuffering && (
  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
    <Loader2 className="w-8 h-8 animate-spin text-white" />
  </div>
)}
```

#### Task 6: Handle Continuous Scrubbing Gracefully

During rapid scrubbing, we need to:
1. Debounce seek requests OR
2. Cancel previous seeks when new one starts OR
3. Show "scrubbing" state that hides tracking until stable

Recommended approach - throttle seek updates:
```javascript
const throttledSeek = useMemo(
  () => throttle((time) => {
    videoRef.current.currentTime = time;
  }, 50), // Max 20 seeks per second
  []
);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/frontend/src/stores/videoStore.js` | Add `isBuffering` state |
| `src/frontend/src/hooks/useVideo.js` | Add buffering handlers, fix seek, update RAF |
| `src/frontend/src/modes/OverlayModeView.jsx` | Optional: buffering indicator |

---

## Testing Checklist

### Buffering Sync
- [ ] Play video, simulate slow network (DevTools → Network → Slow 3G)
- [ ] Verify playhead pauses when video buffers
- [ ] Verify tracking squares pause when video buffers
- [ ] Verify playback resumes in sync when buffer fills

### Scrubbing Sync
- [ ] Scrub timeline slowly - squares match video frame
- [ ] Scrub timeline rapidly - no stale squares visible
- [ ] Scrub to specific frame - squares appear at correct position

### Edge Cases
- [ ] Seek to unbuffered section - UI waits for video
- [ ] Seek during existing seek - no race conditions
- [ ] Pause during buffering - state is correct
- [ ] Play/pause rapidly during buffering - no desync

---

## Technical Notes

### Video ReadyState Values
```javascript
HTMLMediaElement.HAVE_NOTHING = 0     // No data
HTMLMediaElement.HAVE_METADATA = 1    // Duration known
HTMLMediaElement.HAVE_CURRENT_DATA = 2 // Current frame available
HTMLMediaElement.HAVE_FUTURE_DATA = 3  // Next frame available
HTMLMediaElement.HAVE_ENOUGH_DATA = 4  // Enough to play through
```

### Browser Compatibility
- `requestVideoFrameCallback`: Chrome 83+, Edge 83+, Opera 69+
- Safari/Firefox: Use `seeked` event as fallback
- All browsers: `waiting`, `playing`, `canplay` events supported

### Performance Considerations
- Throttling seeks prevents browser overload during rapid scrubbing
- RAF loop should remain ~60fps during normal playback
- Buffering detection adds minimal overhead (event listeners)
