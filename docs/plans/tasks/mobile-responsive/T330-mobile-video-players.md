# T330: Mobile Video Players

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

Video players across the app (annotate, framing, overlay) are not optimized for mobile:
- Playback controls (play/pause, scrub bar, volume) may be too small for touch
- Custom controls may overlap or be inaccessible on narrow screens
- Timeline scrubbing needs touch-friendly hit targets
- Fullscreen playback may not work properly on mobile browsers
- iOS Safari and Android Chrome have different native video behaviors (autoplay restrictions, inline playback, fullscreen APIs)

## Solution

Ensure all video players are touch-friendly and work correctly on mobile browsers:
- Increase touch targets for playback controls (min 44px)
- Ensure scrub bar / timeline is draggable via touch
- Handle mobile-specific video quirks (iOS `playsinline`, autoplay policies)
- Test fullscreen behavior on both platforms
- Consider mobile-specific control layout (larger buttons, simplified controls)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/VideoPlayer.jsx` - Main video player component
- `src/frontend/src/components/Timeline.jsx` - Timeline/scrub bar
- `src/frontend/src/screens/AnnotateScreen.jsx` - Annotate video player usage
- `src/frontend/src/screens/FramingScreen.jsx` - Framing video player usage
- `src/frontend/src/screens/OverlayScreen.jsx` - Overlay video player usage

### Related Tasks
- Part of: Mobile Responsive epic
- Related: T310 (layout affects player sizing), T320 (crop preview also uses video)

## Implementation

### Steps
1. [ ] Audit current video player controls for touch target sizes
2. [ ] Add `playsinline` attribute for iOS inline playback
3. [ ] Increase control button sizes at mobile breakpoint
4. [ ] Ensure timeline scrub works with touch drag events
5. [ ] Test play/pause/seek on Android Chrome and iOS Safari
6. [ ] Verify fullscreen works on both platforms

## Acceptance Criteria

- [ ] All video playback controls are tappable (min 44px touch targets)
- [ ] Timeline scrubbing works via touch drag
- [ ] Video plays inline on iOS (no forced fullscreen)
- [ ] Playback works on Android Chrome and iOS Safari
