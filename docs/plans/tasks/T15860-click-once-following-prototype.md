# T15860: Following in Frame: proof

## In plain words

Frame is the step where the parent crops around their athlete and pays to sharpen the result. Today they drag the crop box point by point; 69 parents placed about 19 points each. A prototype on 2026-11-12 showed that one tap can follow an athlete through a finished highlight, but Frame works on the raw game video, where the athlete is far smaller and the play runs 10 to 30 seconds, and nobody has measured following there. We will run the same model on twenty raw plays, including wide-angle Veo and DJI footage, against the parents' own crop paths, and count how often a parent would have to tap again. Go if 15 of 20 plays need at most one extra tap and the box stays on the athlete.

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-12
**Milestone:** Roadmap 5, Click-once following for Frame (see PLAN.md).

## How we got here

The history note (T15900) found that the app never followed anyone: a tracker existed on the server for one day in December 2025 and was never connected to a screen. The prototype that followed it ran ten trackers on 54 of the owner's finished highlights and SAM 2.1 base+ held the athlete for four seconds on 46 of 47 cleanly scored clips ([click-once-following-2026-11.md](../research/click-once-following-2026-11.md)). That result is being built for Spotlight, the step that draws a circle that follows the athlete ([click-once-spotlight/EPIC.md](click-once-spotlight/EPIC.md)).

## The problem

The Spotlight result does not carry over to Frame without proof. In a finished highlight the athlete is 90 to 340 pixels tall and the stretch is a few seconds. In a raw game video from a wide camera the athlete can be 30 to 80 pixels tall, the play is much longer, and the athlete may leave the picture and return. Published tests of these models report their weakest results on exactly such small, fast targets.

## What we will do

No app code. The work reuses the prototype project and the following engine built for Spotlight (T16220).

1. Twenty raw plays from the dev fixture and owner accounts across phone, Veo and DJI, portrait and landscape, with the parent's hand-placed crop points as the truth.
2. Run SAM 2.1 base+ from one tap on the athlete in the first frame, for the whole play, and smooth the resulting box.
3. Measure for each play: how closely the smoothed box matches the parent's crop path, frames lost, how many extra taps a parent would need (a loss longer than half a second, or a switch to another player), and the wait and cost.
4. Add the table and a go or no-go for Frame to the research write-up.

## Why this and not something else

Building Frame following straight from the Spotlight result would risk shipping a follower that fails on the footage Frame actually sees. Twenty plays is enough to see whether small athletes and long plays break it.

## How we will know it worked

- [ ] The write-up has, for 20 raw plays, the match against the parent's crop path, frames lost, extra taps, wait and cost.
- [ ] At least five of the plays are Veo or DJI wide shots, and at least three include the athlete leaving the picture.
- [ ] Go or no-go for T15870 is stated against the rule: 15 of 20 plays need at most one extra tap and the smoothed box overlaps the parent's path well (0.6 on the usual overlap measure).

## For the implementer

### Related Tasks
T15900 (history, done), T16220 (the engine to reuse), T15870 (Frame, gated on this), T14295 to T14340 (Player Moments share the detector and tracker slots).

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` (Modal app, image, GPU patterns)
- `src/frontend/src/screens/FocusScreen.jsx` (crop keyframes model)
- `docs/plans/research/click-once-following-2026-11.md`
- Prototype project, outside this repo: `C:/Users/imank/projects/player-tracking` (`bench.py`, `common.py`, `trackers/impl.py`)
