# T15870: Click once, the box and the spotlight follow the athlete

**Status:** BLOCKED
**Impact:** 9
**Complexity:** 7
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 5, Click-once following (see PLAN.md). BLOCKED on T15860 GO. L-tier, design gate.

## Problem

Frame's crop box and Spotlight's ellipse are placed and corrected by hand, keyframe by keyframe. It is
the slowest step for phones and the one most users abandon between Opened Frame and Paid.

## Solution

1. Frame: after the parent taps their athlete once ("Tap your athlete", T14520 copy), a Modal job
   (T15860's winner) returns a smoothed box path; the crop keyframes are derived from it and shown as
   the usual keyframes so every existing gesture still works as a correction. "Is your athlete in the
   box?" (T14830) stays as the one-time confirm.
2. Spotlight: the same path seeds the ellipse; the parent corrects by dragging as today (T5610).
3. Cost: GPU seconds are small (under $0.02 per clip) and folded into the existing sharpen price; no
   new charge line. The job runs before the paid step so a failure never spends credits: on failure
   the UI falls back to today's manual keyframes with a plain message.
4. Confidence gating: where the tracker reports a loss, the timeline shows a marker and asks for a
   re-tap at that frame; the re-tap re-seeds from there.
5. Measurement: `following_used`, `following_retapped` milestones; framing points per clip and
   Opened Frame to Paid on the Journey are the gates.

Architect gate first: where the path is stored (project keyframes vs a derived layer), how Modal
progress is surfaced, and the mobile gesture for re-tap.

## Acceptance Criteria

- [ ] On a phone, one tap on the athlete produces a following crop box and spotlight for a 10-second play with at most one re-tap on the T15860 clip set.
- [ ] Manual keyframe edits still work and override the path; export output is identical whether the path came from a tap or by hand.
- [ ] Failure of the follower never charges credits and lands the parent in today's manual flow.
- [ ] Framing points per clip and the Opened Frame to Paid edge are read before and after on the Journey.

## Context

### Related Tasks
T15860 (prototype and GO), T15900 (history), T15800, T14830, T14520, T5600, T5610, T11000.

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx`
- `src/backend/app/modal_functions/video_processing.py`
- `src/backend/app/services/modal_client.py`
- `src/backend/app/services/export_cost_guard.py`
