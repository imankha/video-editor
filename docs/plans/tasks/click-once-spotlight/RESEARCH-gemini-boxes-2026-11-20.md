# Research note: finding a player with Gemini (2026-11-20)

## In plain words

While prototyping AI Coach (the paid option that has a video model mark the plays in a game) we tested whether the same model, Gemini Hydrogen, can say where a player is on screen. The owner then removed player boxes from AI Coach because of their cost, and asked for what we learned to be kept here, with the Click-once Spotlight work, which may or may not use it. Nothing in this note is a decision or a task. All of it was measured on one 10-minute clip of one game from a sideline Veo camera, with answer keys labelled by an AI and spot-checked only in part, so treat every number as an early signal.

## What we found

1. **Boxes asked for inside a video call are not on the players.** Drawn on the frames they sit near the action but on empty grass. No time shift (4 seconds either way) and no rescaling fixes them. Google documents boxes for images only.
2. **Boxes asked for on one full-size still frame are tight.** The model boxed every person on the field (17 to 21 people in each of three frames), small far players included. About $0.04 a frame at default thinking and about $0.007 at low thinking, where most of the cost is thinking, not the image.
3. **Following one player through a video call does not work.** Asked for a box every 2 seconds for navy #6: found in 0 of 12 frames where he was clearly visible.
4. **Re-finding a player from one reference picture works when he is clear.** One crop of the player plus one later frame: 14 of 14 frames where his number was readable, and 5 of 5 moments where he came back into the picture, at about $0.007 and 5.5 seconds a frame at low thinking. Default thinking cost 3.3 times more and was no more accurate on those frames.
5. **It cannot say "he is not here".** On frames where he was probably absent it named somebody in 6 of 7 at low thinking (at least three wore a readable different number) and in 3 of 7 at default thinking.
6. **A free local tracker (YOLO11s with BoT-SORT) holds a player for seconds, then forgets him.** Median track 3.6 seconds; navy #6 got 10 different ids across 10 appearances; alone it re-found him 0 of 5 times. Letting Gemini confirm each new track kept him in 14 of 14 frames but also said yes to look-alikes (a #12 and another blond navy player).
7. **Four boxes over a play's first two seconds** (at 0, 2/3, 1 1/3 and 2 seconds), on 10 plays and 17 player-plays:

| How | Cost per player per play | 90-minute game, every noted player | Plays rated 4 or 5 only | Per play a parent opens |
|---|---|---|---|---|
| One call per frame per player | $0.032 | $11.85 | $7.62 | $0.05 |
| One call per play: four frames, every noted player | $0.011 | $4.53 | $2.10 | $0.02 |
| First frame, then re-find from a crop | $0.016 | $12.83 | $8.25 | $0.05 |

   The one-call-per-play form was cheapest and had the fewest boxes on the wrong person by the worker's own eye (1, against 3 for each of the others). The player was "not visible" in all four frames in 8 to 11 of 17 cases: wide shots where players are about 30 pixels tall, and plays where the player acts well after the play starts. Taking the frames from the moment of the player's action instead was not tested.
8. **Following a player for a whole 90-minute game** from one picture, projected: about $19 at a frame every 2 seconds, about $3.80 at every 10 seconds with interpolation.
9. **One readable jersey number, then every frame** (analysis only, not run): a number read in one frame labels only its own short track. Linking tracks across gaps needs appearance matching, and teammates wear the same kit, so hair and build are the only cues. Untested: an appearance-matching model for linking tracks, how often a player's back faces the camera, and a real "absent" test with a player known to be off the field.

## How it could serve Click-once Spotlight

These are possibilities, not plans.

- **A starting point for the tap.** For a play that came from AI Coach, one call on four frames (about 2 cents) could propose where the athlete is at the start of the highlight, so the Spotlight step opens with a suggestion the parent confirms. The following engine (T16220) would still do the following.
- **A second opinion for doubtful spots (T16250).** Re-finding from a reference crop at about $0.007 a frame could check a spot where the following engine is unsure, but only when the athlete is clearly in the picture; it will name somebody even when he is not.
- **Not a replacement for the following engine.** The model cannot follow inside a video call, and frame-by-frame calls cost dollars per game.

## Where the work is

All under the T16145 prototype checkout (`C:/work/tasks/g-t16130-2/gemini_analysis_test/`, branch `feature/T16130-T16145-sport-chooser-where-tags`); the folders are untracked or prototype-only, so copy what is wanted before that container is cleared.

- `tracking/`: the one-player test. Answer key and contact sheets, scripts for each method, the spend ledger, and `t4_spotlight.mp4` (a 22-second clip with a spotlight drawn from boxes every 2 seconds).
- `outputs/runs/B-stills-boxes-v1/`: the four-box test. `boxes.md` (contact sheets per play and variant), `findings.md`, `cost.md`, `boxes.json`.
- `outputs/runs/S1-s1-10min-colors-v2/boxes/`: the in-video boxes drawn on their frames.
- `stills_boxes.py`, and `cost_model.py` (predicts the cost of a call before it is sent and records what it cost).

Gemini spend on this research: $0.12 (first still test), $1.73 (tracking), $0.86 (four boxes).
