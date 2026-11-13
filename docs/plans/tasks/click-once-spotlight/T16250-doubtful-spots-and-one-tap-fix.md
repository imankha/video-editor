# T16250: Doubtful spots and one-tap fix

## In plain words

Following an athlete from one tap works on most highlights but not all. In the prototype it went wrong on 3 of 54 clips, and every time for the same reason: a player of similar build crossed or ran beside the athlete and the circle moved to them. The follower does not know it has done this; the circle looks just as confident on the wrong child. This task makes the app notice the risky moments and say so. Where the follower is unsure, the timeline shows a mark and the guide says "Check this spot". The parent looks, and if the circle is on the wrong player they tap the right one there; following restarts from that tap and the earlier part is kept. Done when the three known failures are each flagged, and one tap at the flagged spot fixes each.

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Click-once Spotlight (see [EPIC.md](EPIC.md)). Task 4 of 6. Needs a design review of the mark and the prompt before it is built.

## How we got here

Spotlight is the step that draws a circle that follows the athlete through a highlight (a finished short clip). The prototype's failures on real footage were a backlit clip where players are dark outlines, a fast swing of the phone, and an athlete running beside an opponent. In two of the three, a second, simpler tracker that links detected people from frame to frame stayed on the right athlete while the main model switched.

## The problem

A spotlight on the wrong child is the worst outcome this feature can produce: the parent may not notice until after they share it. One tap is only safe if the app owns up to the moments it might be wrong.

## What we will do

1. Decide a spot is doubtful from three signs: the model's own confidence drops, the box changes size or jumps more than an athlete can move, or a second cheap tracker run alongside ends up on a different person.
2. Show each doubtful stretch as a mark on the Spotlight timeline, and have the guide take the parent to the first one with "Check this spot".
3. At that spot the detected people are shown as boxes, as on the first frame. A tap on the right one restarts following from there to the end; everything before the tap stays. "Looks right" clears the mark.
4. A parent can do the same at any moment without a mark: open a frame, tap a different person, and following restarts from there.
5. Tune the signs on the 54-clip set so that the three failures are flagged and good clips are rarely flagged.

## Why this and not something else

Asking the parent to confirm every spotlight would bring back the taps we are removing. Hiding uncertainty would ship wrong circles. Running a larger model does not help: the largest one tested was no more accurate.

## How we will know it worked

- [ ] Each of the three clips the prototype lost shows a mark at or before the moment the circle leaves the athlete.
- [ ] On each of those three, one tap on the athlete at the mark gives a correct spotlight to the end.
- [ ] Of the clips the follower got right, no more than one in ten shows a mark; the exact count is reported.
- [ ] A tap on a different person on any frame restarts following from that frame and keeps the earlier path.
- [ ] "Looks right" clears a mark and it does not come back after saving and reopening.
- [ ] The second tracker adds no more than a stated share to the wait and cost measured in T16220; the figure is reported.

## For the implementer

### Design notes
- The second tracker in the prototype is `botsort_reid_11m` (YOLO11m + BoT-SORT with re-id, `trackers/impl.py` class `YoloMOT`, config `trackers/botsort_reid.yaml`). Production bakes `yolov8x.pt`; decide in a short note whether to run detection on every frame or every few frames, and report the cost.
- Agreement test to reuse: prototype `common.py` `same_player`.
- Known clips: `9fa7-wv11` (switch at about 0.7 s), `9fa7-wv15` (box shrinks to a fragment during a pan), `9fa7-wv48` (switch near 3 s). `compare.py` renders them.
- Restart is a second call to the T16220 job with a new start frame and box; merging the two paths belongs with the thinning code from T16230.
- The cleared state of a mark is saved by the "Looks right" tap, a named gesture.

### Related Tasks
T16220 (confidence and doubtful stretches), T16230 (carries them, merges restarted paths), T16240 (the one-tap flow this extends), T2160 (the older re-acquisition idea this supersedes for Spotlight).

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py`
- `src/backend/app/routers/detection.py`
- `src/frontend/src/modes/overlay/OverlayTimeline.jsx`
- `src/frontend/src/modes/overlay/layers/DetectionMarkerLayer.jsx`
- `src/frontend/src/modes/overlay/hooks/useGuidedAthletePick.js`
- `src/frontend/src/modes/overlay/components/SpotlightPickGuide.jsx`
- `docs/plans/research/click-once-following-2026-11.md`
