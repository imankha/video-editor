# T446: Screen Wake Lock

**Status:** TODO
**Impact:** 5
**Complexity:** 1
**Created:** 2026-05-13

## Problem

Parents annotating a full 45-90 minute game half get screen dimming and auto-lock interrupting their workflow. They're actively watching the video and tapping to mark clips, but periods of passive watching (waiting for the next highlight) trigger the device's screen timeout.

## Solution

Use the Screen Wake Lock API (`navigator.wakeLock.request('screen')`) to keep the screen on during Annotate mode. Release the lock when leaving Annotate mode or when the tab becomes hidden.

~20 lines of code. No backend changes.

## Implementation

1. [ ] Create `useWakeLock` hook -- requests wake lock on mount, releases on unmount
2. [ ] Apply in AnnotateContainer (or equivalent top-level annotate component)
3. [ ] Release on `visibilitychange` (browser hides tab), re-acquire on visible
4. [ ] Graceful no-op on unsupported browsers (Firefox desktop)

## Acceptance Criteria

- [ ] Screen stays on during Annotate mode on Android Chrome and iOS Safari
- [ ] Screen lock resumes when leaving Annotate mode
- [ ] No errors on unsupported browsers
