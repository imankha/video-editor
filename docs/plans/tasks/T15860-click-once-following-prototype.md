# T15860: Click-once following prototype: SAM 2.1 with SAMURAI memory on 20 real clips

## In plain words

Today the parent drags a crop box keyframe by keyframe in Frame and places the Spotlight circle by hand; 69 parents placed about 19 crop points each. New open models can follow one clicked object through a video for a few cents per clip, but they are weakest on exactly our case: small fast players who blur and cross each other. We will test them on twenty real highlights against the parents' own crop paths and count how often a parent would have to click again. Go if 15 of 20 clips need at most one extra click and the box stays on the athlete. The history note (T15900) tells us which failure cases to try first.


**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 5, Click-once following (see PLAN.md). Gated on T15900.

## How we got here

AI-vectors research 2026-11-09: SAM 2.1 (Apache-2) with SAMURAI or DAM4SAM memory tracks one object
from a single click at 17 to 23 fps on an L4, about $0.004 to $0.02 per 10-second clip self-hosted
(hosted SAM 3 about $0.09 per clip). Tiny fast targets are the hardest case: FMOX benchmark mean mIoU
0.505 for DAM4SAM, 0.488 SAMURAI, 0.461 SAM 2, with 1 to 3 frame dropouts under blur; a football SAM
study found 50% recovery in crowded boxes and 8.7% once the player leaves frame for more than 15
frames. Prod: 69 users placed 1,287 framing points by hand (about 19 each); Spotlight completion is the
strongest return and payment signal we have (T15800).

## The problem

Frame asks the parent to keyframe a crop box by hand and Spotlight asks them to place and correct an
ellipse; both steps are where phones stall. A click-once follower would make both nearly automatic,
but nobody has measured drift, re-click rate or cost on our footage.

## What we will do

A Modal prototype, no app code.

1. Clip set: 20 real highlights from the dev fixture and owner accounts across phone, Veo wide shot
   and DJI, portrait and landscape, with the parent's manual crop keyframes and ellipse as ground
   truth.
2. Run SAM 2.1 small and large with SAMURAI memory, and DAM4SAM, seeded by one click on the athlete in
   frame 0, on Modal L4 and A100; a Kalman-smoothed box from the mask.
3. Measure per clip: mean IoU of the smoothed box against the manual crop path, frames lost, number of
   re-clicks a parent would need (a loss longer than 15 frames or a swap to another player), GPU
   seconds and cost, cold start.
4. Write `docs/plans/research/click-once-following-2026-11.md` with the table and GO / NO-GO for
   T15870: GO if 15 of 20 clips need at most one re-click and the smoothed box IoU is at least 0.6
   against the manual path.

## How we will know it worked

- [ ] `scripts/prototypes/click_following/` runs one clip end to end on Modal from a clean checkout.
- [ ] The research note has IoU, frames lost, re-clicks, cost per clip and cold start for 20 clips on two model variants and two GPUs.
- [ ] GO / NO-GO against the stated rule, and the two failure modes T15900 named are reported explicitly.

## For the implementer

### Related Tasks
T15900 (history, gate), T15870 (productize), T15800 (Spotlight step), T5600 (detection store),
T14295 to T14340 (Player Moments share the detector and tracker slots).

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` (Modal app, image, GPU patterns)
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` (what the UI stores today)
- `src/frontend/src/screens/FocusScreen.jsx` (crop keyframes model)
- `scripts/prototypes/` (new folder; T14310 to T14330 will share it)
