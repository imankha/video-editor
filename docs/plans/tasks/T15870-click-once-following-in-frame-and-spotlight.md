# T15870: Click-once following in Frame

## In plain words

Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today they drag the crop box point by point through the play, which is the slowest step on a phone. If the proof on raw game video passes (T15860), a parent taps their athlete once and the crop box follows them through the play; the usual edits still work as corrections. Where the follower loses the athlete, the timeline shows a mark and asks for one more tap. A failure never spends credits and leaves the parent in today's manual flow. Blocked until the proof says go, and it needs a design review first.

**Status:** BLOCKED
**Impact:** 9
**Complexity:** 7
**Created:** 2026-11-09
**Updated:** 2026-11-12
**Milestone:** Roadmap 5, Click-once following for Frame (see PLAN.md). BLOCKED on T15860 go. L-tier, design gate.

## How we got here

One-tap following is being built for Spotlight, the step that draws a circle that follows the athlete ([click-once-spotlight/EPIC.md](click-once-spotlight/EPIC.md)). Frame is the larger prize, 69 parents placed 1,287 crop points by hand, but it is unproven on raw game video.

## The problem

Frame's crop box is placed and corrected by hand, point by point. It is the step most parents abandon between opening Frame and paying.

## What we will do

1. After the parent taps their athlete once, the following engine built for Spotlight (T16220) returns a smoothed box path for the play. The crop points are derived from it and shown as the usual points, so every existing gesture still works as a correction. The one-time question "Is your athlete in the box?" stays.
2. Following runs before the paid step, so a failure never spends credits; on failure the parent gets today's manual points with a plain message.
3. Where the follower is unsure, the timeline shows a mark and asks for a tap there, the same way Spotlight does (T16250).
4. Counts for how often following was used and corrected, and crop points per play before and after.

## How we will know it worked

- [ ] On a phone, one tap on the athlete produces a following crop box for a 10-second play with at most one extra tap on the T15860 play set.
- [ ] Manual edits still work and override the path; the exported video is identical whether the path came from a tap or by hand.
- [ ] A failure of the follower never charges credits and leaves the parent in today's manual flow.
- [ ] Crop points per play and the share of parents who go from opening Frame to paying are read before and after.

## For the implementer

Architect gate first: where the path is stored (project keyframes or a derived layer), how job progress is surfaced, and the phone gesture for the extra tap. Reuse the thinning from T16230 and the doubtful-spot handling from T16250 rather than building Frame versions.

### Related Tasks
T15860 (proof and go), T16220, T16230, T16250 (Spotlight pieces to reuse), T15900 (history), T15800, T14830, T14520.

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/FocusScreen.jsx`
- `src/backend/app/modal_functions/video_processing.py`
- `src/backend/app/services/modal_client.py`
- `src/backend/app/services/export_cost_guard.py`
