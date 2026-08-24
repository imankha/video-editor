# T7590: Mobile "Add your first game" dead-end (iPhone Safari)

**Status:** TODO
**Priority:** P1 (the 50% signup->upload cliff is concentrated on mobile)
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

The largest funnel cliff (2026-08-24 investigation): 6 of 12 users never started an
upload; 4 of the 6 are mobile; ZERO mobile-only users have ever gotten a game in, while
all 4 upload successes were desktop. Direct user evidence that the entry point itself
fails on iPhone:

- bug_reports #18 (2026-06-07, anonymous, iPhone Safari, viewport 352x541, page
  /home/games): "I hit add your first game and nothing happened."
- bug_reports #46 (2026-08-24, avi468870, iPhone Safari 26.6.1, viewport 320x498, page
  /home): filed 17 seconds after finishing the annotate tutorial, description NULL: he
  hit the wall at exactly the upload step and reached for help.
- hiro.mt629 (mobile): finished the tutorial, returned 3.5h later, still produced
  nothing. Three mobile users completed the tutorial and stopped at exactly the
  upload-a-game quest step.

Nothing is known server-side about what the tap did (no clicked/picker-opened/failed
telemetry, no client error capture), so this needs live reproduction.

## Solution

1. **Reproduce on real iPhone Safari** (and DevTools device emulation at 320/352/375px
   as a fast first pass, but the verdict needs a real device: memory rule, pointer/
   input fixes verified in real browsers). Walk signup -> tutorial -> "Add your first
   game" tap on /home and /home/games. Candidate failure modes to check explicitly:
   - the tap handler not firing (overlay/z-index/pointer-events at narrow widths;
     element covered by the quest UI or a safe-area inset)
   - the file input never opening (programmatic .click() on a hidden input outside a
     user-gesture call stack; iOS Safari restrictions)
   - `accept=` / capture attribute filtering out camera-roll videos
   - the GameDetailsModal (required fields at creation) rendering unusably at 320px with
     the keyboard open
   - an unhandled JS exception (silent on mobile; nothing reaches the server)
   - the iOS 18 Safari cellular-upload bug (Apple dev forums thread 764420: uploads
     >1MB over cellular time out while wifi works) - if the tap DID work and the
     transfer died instantly on cellular, the entry point may be innocent and this
     platform bug + the T7480 timeout math the whole story
   - the iOS photo-picker "preparing" transcode delay (HEVC->H.264 export of a large
     video before the file reaches Safari) reading as "nothing happened"
2. Fix what reproduces; if NOTHING reproduces, instrument the entry point (tap, picker
   opened, file selected events via the T7510/T7480 beacon channel) and ship that, so
   the next mobile user answers the question for us.
3. Screen-size test matrix for the fix (320-428px, keyboard open/closed) per the
   responsiveness skill.

## Context

### Relevant Files
- Games screen / empty-state "Add your first game" button (ProjectsScreen/ProjectManager)
- Upload entry: file input wiring in the add-game flow (uploadManager.startUpload
  callers), GameDetailsModal
- Quest/tutorial overlay stacking context at mobile widths

### Related Tasks
- T7480 (transfer failures AFTER the picker; this task is the entry point BEFORE it)
- Tutorial Redesign epic (will re-anchor guidance on this exact button)
- T7360 (upload store rework; coordinate file contention)

## Acceptance Criteria

- [ ] Real-device (or faithfully emulated + user-confirmed) repro attempt documented per
      candidate failure mode above
- [ ] Either a reproduced bug fixed with real-browser evidence at 320-428px, or entry-
      point telemetry shipped and the instrumentation verified live
- [ ] A mobile user (or emulated run) can go tap -> picker -> upload started
