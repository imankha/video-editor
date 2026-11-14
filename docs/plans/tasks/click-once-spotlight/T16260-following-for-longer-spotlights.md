# T16260: Following for longer spotlights

## In plain words

A spotlight (the circle that follows the athlete through a highlight) is two seconds long unless the parent stretches it, because every extra stretch used to mean more taps. Once one tap follows the athlete, length is nearly free, and a goal or a long dribble deserves more than two seconds. Today, stretching a spotlight or adding a second one leaves the new part with no following at all. With this change, when the parent stretches a followed spotlight the following continues to the new end, and a new spotlight added later in the highlight asks for one tap and follows from there. The prototype held the athlete for five seconds; beyond that is untested, so this task measures how far following can be trusted and stops there. Done when stretching a followed spotlight to six seconds keeps the circle on the athlete with no new tap on the test clips.

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Click-once Spotlight (see [EPIC.md](EPIC.md)). Task 5 of 6.

## How we got here

The owner's goal for the prototype was four seconds from one tap, and the prototype met it. The app's two-second default dates from when four taps covered two seconds.

## The problem

One tap that only ever covers two seconds wastes most of what following can do, and a parent who stretches a spotlight today gets a circle that stops following exactly where the interesting part of the play may be.

## What we will do

1. Stretching the end of a followed spotlight continues the following from its last point to the new end, with the same honest progress as the first run.
2. Pulling the start earlier follows backwards from the first point.
3. A spotlight added elsewhere in the highlight asks for one tap on its first frame, as the first spotlight does.
4. Measure, on the test clips, how often following still holds at 6, 8 and 10 seconds, and set the longest stretch the app will follow in one go from that. Past it, the app asks for a fresh tap.
5. Longer stretches are where doubtful spots (T16250) matter most; they are shown the same way.

## Why this and not something else

Following the whole highlight up front would be simpler, but most of it would be thrown away and the wait and cost would grow with highlight length for every parent. Following only what the parent asks for keeps both small.

## How we will know it worked

- [ ] Stretching a followed spotlight from two to six seconds on the test clips keeps the circle on the athlete with no new tap on at least four clips in five; the count is reported.
- [ ] The note records how often following holds at 6, 8 and 10 seconds, and the longest single stretch is set from it.
- [ ] Pulling the start of a followed spotlight earlier follows the athlete backwards.
- [ ] A second spotlight in the same highlight follows from one tap.
- [ ] Stretching past the limit asks for a tap instead of following badly.
- [ ] Shortening a spotlight needs no new following and keeps the remaining points.

## For the implementer

### Design notes
- Owner decision 2026-11-12: a new spotlight stays two seconds long. Do not change the default region length.
- Continue from the last followed box rather than re-running from the first tap; the T16220 job takes any start frame and box. Backwards following is the same job on a reversed frame range; confirm the stock predictor's `reverse=True` path before building anything custom.
- The prototype's `common.py` has `TRACK_SECONDS`; raise it and re-extract frames to measure 6 to 10 seconds. Ground truth past two seconds is agreement between trackers plus eye checks, as in the prototype.
- Region resize is an existing gesture (the region levers); the follow request hangs off the release of that gesture. See `T5649` for how detections are re-sliced on resize today.

### Related Tasks
T16220, T16230, T16240, T16250, T5649 (region lever re-slices detections), T730 (missing end detection point).

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/overlay/hooks/useHighlightRegions.js`
- `src/frontend/src/modes/overlay/OverlayTimeline.jsx`
- `src/frontend/src/modes/overlay/layers/HighlightLayer.jsx`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/backend/app/routers/detection.py`
- `src/backend/app/modal_functions/video_processing.py`
