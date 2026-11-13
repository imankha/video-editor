# T16220: Following engine

## In plain words

Today the model that follows an athlete from one tap exists only as a script on the owner's laptop, where it kept the circle on the right player for four seconds on 46 of 47 real highlights (finished short clips). This builds the server job: given a highlight, the frame the parent tapped and the box they tapped, it returns the athlete's box on every frame and marks any stretch where it is unsure. It also measures what the laptop could not: the tap on a real detected box, the wait and cost on the rented graphics cards the app uses, and small athletes in wide-angle footage. Done when the job on staging matches the laptop result on the same 54 clips and we know the wait and the cost of a two-second and a four-second spotlight.

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Click-once Spotlight (see [EPIC.md](EPIC.md)). Task 1 of 6.

## How we got here

Spotlight is the step that draws a circle that follows the athlete. Nothing in the app follows anyone today. A prototype on 2026-11-12 compared ten trackers on 54 of the owner's highlights and the owner chose SAM 2.1 base+ (see the epic for the numbers). The prototype ran on a laptop, from the parent's stored circle, on portrait phone footage only.

## The problem

The app cannot call a laptop script. And four things that decide whether this is worth shipping are unmeasured: the real tap, the wait, the cost, and footage where athletes are small.

## What we will do

1. A server job on a rented graphics card that loads SAM 2.1 base+ once, takes a highlight, a start frame, an end frame and one box, and returns one box per frame, a confidence for each, and the stretches it considers doubtful (no box, or confidence below a set level).
2. A plain way for the app's backend to start it and read real progress (frames done out of frames asked for).
3. A repeatable test: the 54-clip set, with the tap taken as the detected person box that best matches the parent's first pick, scored the same way the prototype scored it.
4. A short measurement note added to the research write-up: clips held for four seconds, wait and cost for two and four seconds on each card type tried, time when the job starts cold, and results on at least five Veo or DJI highlights.
5. A check of the stored detection boxes: on the test clips they sit beside the players rather than on them. Find out whether that is old data only or a live fault, and file a bug if it is live.

## Why this and not something else

SAM 2.1 base+ is the owner's choice and the best on the parent's own picks. The lighter EdgeTAM stays as a documented fallback if the measured wait is too long; nothing else is evaluated. Running in the browser was ruled out: the model needs a graphics card.

## How we will know it worked

- [ ] The staging job, given a highlight and one box, returns a box for every frame of a four-second stretch.
- [ ] On the 54-clip set with the tap on a detected box, at least 45 clips hold the athlete for four seconds; the two clips the prototype lost to an unclear first pick are reported one by one.
- [ ] The note states the wait and the cost for a two-second and a four-second spotlight, warm and cold, on each card type tried.
- [ ] At least five Veo or DJI highlights are run and their outcome reported, pass or fail.
- [ ] A job that is interrupted or fails returns a clear failure the caller can act on, never a partial path presented as complete.
- [ ] The detection-box offset is explained, with a bug filed if it affects new highlights.

## For the implementer

### Design notes
- Prototype reference: `C:/Users/imank/projects/player-tracking/trackers/impl.py`, class `Sam2` (stock `sam2==1.1.0`, `build_sam2_video_predictor`, `add_new_points_or_box` on frame 0, `propagate_in_video`, box from mask). `mask_to_box` drops masks under 20 pixels.
- The stock predictor loads every frame up front (about 8 s for 151 frames at 808 x 1440 on the laptop). Decode only the asked range; consider the frame-by-frame pattern in the prototype's DAM4SAM wrapper if load time dominates.
- New Modal image with torch and `sam2`, checkpoint baked in like `yolov8x.pt` in `yolo_image`. Set `max_containers` per T14130; add the function to the capacity test.
- Generator function for progress, same pattern as `render_overlay`.
- Scoring code to reuse: prototype `common.py` (`same_player`), `bench.py`, `reference.py`.
- Local path when `MODAL_ENABLED=false`: return a clear "following unavailable" failure; do not build a CPU fallback.

### Related Tasks
T16230 (consumes the per-frame boxes), T16250 (consumes the doubtful stretches), T16270 (kill switch and spend cap wrap this job), T15900 (history), T14130 (capacity caps).

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` (images, `detect_players_modal`, generator pattern)
- `src/backend/app/services/modal_client.py`
- `src/backend/app/routers/detection.py`
- `src/backend/tests/test_t14130_modal_capacity.py`
- `.claude/knowledge/modal-gpu.md`
- `docs/plans/research/click-once-following-2026-11.md`
