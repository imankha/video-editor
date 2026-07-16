# T5175: Tutorial watch step completes on X-out OR 85% watched

**Status:** TODO
**Impact:** 5
**Complexity:** 1
**Created:** 2026-07-15
**Updated:** 2026-07-15

## Problem

The `watch_*_tutorial` quest steps (quest step 0 for each of the four NUF quests) auto-complete
via `TutorialVideoModal`. The old rules were surprising: closing the video only completed the
step if the user had watched **>= 10s**, and the watch-progress trigger fired at **80%**. User
direction (2026-07-15): the watch step should complete when **the user X-es out of the video**
(closing = done, no minimum) **OR** when they **watch 85%**.

## Solution

`src/frontend/src/components/TutorialVideoModal.jsx` (single file):
1. `handleClose` fires `fireAchievement()` unconditionally on close (dropped the `currentTime >= 10`
   gate). `fireAchievement` is idempotent (guarded by `completedRef`), so a close after the 85%
   trigger is a safe no-op.
2. The `handleTimeUpdate` progress trigger threshold changed **0.8 -> 0.85**.
3. Header comment updated to describe the new rule.

No backend/trigger/schema/migration change — this only changes WHEN the existing
`watched_*_tutorial` achievement is recorded on the client.

## Acceptance Criteria

- [ ] Closing (X-ing out of) a tutorial video completes that quest's watch step, regardless of
      how long it was watched.
- [ ] Watching >= 85% of a tutorial video completes the watch step without closing.
- [ ] The achievement is recorded at most once per open (idempotent).
- [ ] Branch CI green (eslint regression gate, vitest, build).
