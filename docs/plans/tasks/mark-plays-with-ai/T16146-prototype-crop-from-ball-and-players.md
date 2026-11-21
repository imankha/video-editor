# T16146: Prototype: find the ball and the players, crop to the play, then ask

## In plain words

AI Coach (the paid option that has a video model mark the plays in a game) is on hold behind one question: can it find a child's highlights? On 2026-11-20 every model we tried failed that on the full camera picture, where a player is about 30 pixels tall. Then one test worked: when the picture is cropped to the play and enlarged, Gemini saw both of the owner's five-star dribbles and named the right team, where it had found one of them never in 14 tries on the full picture. The crop in that test was placed by hand. The one automatic way we tried (asking Gemini, on a still frame every second, where the ball carrier is) worked but costs about $40 a game on its own. The owner's direction: we already made progress on finding players and the ball in earlier research, so bring that back, see whether players and ball can be found reliably, and build the crop from the ball and the players around it. This task is that prototype. It decides whether AI Coach is built or shelved. Done when, on the seven slices parents marked by hand, we know how many five-star marks come back as highlights with the right team from an automatic crop, what it costs per game, and how long it takes, and the owner has ruled go or no-go.

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Tier:** M (prototype scripts and a report; no app code)
**Created:** 2026-11-20

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Runs before T16150; it carries the epic's go or no-go gate together with T16145 step 9. Owner request 2026-11-20.

**Read first:** [.claude/knowledge/ai-coach-video-analysis.md](../../../../.claude/knowledge/ai-coach-video-analysis.md). It holds every result so far, what failed and why, the business bar, where the files are, and the traps. Do not repeat a test recorded there.

## Problem

What we know (details and numbers in the knowledge doc):

- On the full picture, Gemini usually finds the passage a parent marked but rates fewer than half of the five-star marks as highlights (9 of 23 across seven slices, for both Hydrogen and Argon), calls only about half the marked goals a goal, and never credits the right child.
- Cropped by hand to the play and enlarged 2x, Argon at high resolution found both five-star dribbles in every try with the right team, and the goal as a goal by the right team.
- Finding the crop is the gap. Gemini on a still every second works and costs about $36 to $44 a game. A local person detector taking the densest cluster of people drifted to players on other pitches and missed the first dribble.
- Nobody can read the jersey number at this size, the owner included. The analysis must find the moment and the team; the parent says which child (T16200).

## Solution

A prototype, in four steps. Stop and report after each; a failed step is a result.

1. **Bring back the detection work.** Collect what exists and write down what each can do, before running anything new:
   - `C:/Users/imank/projects/player-tracking` (outside this repo) and its write-up [docs/research/click-once-following-2026-11.md](../../research/click-once-following-2026-11.md): ten trackers compared on 54 highlights, SAM 2.1 base+ chosen for following from one tap.
   - The Player Moments epic ([player-moments/EPIC.md](../player-moments/EPIC.md), T14295 candidate registry, T14320 click-seeded tracking bake-off).
   - The app's own person detection on Modal (`src/backend/app/modal_functions/video_processing.py`, YOLOv8x) and the known fault that stored detection boxes sit beside the players (T16220 note 5).
   - The 2026-11-20 tests in the T16145 checkout: `gemini_analysis_test/tracking/` (YOLO11s + BoT-SORT held a player a median of 3.6 seconds; Gemini boxes on stills are tight), `crop/` (hand crops, Gemini-stills cropper, YOLO densest-cluster cropper, contact sheets).
2. **Can we find every player and the ball?** On the seven marked slices, measure, against frames a person has checked: the share of on-field players detected, and the share of frames where the ball is found within a player's width of the truth. Try the cheap things first: a general detector at full resolution and in tiles; a ball detector trained for soccer if one is freely usable; the ball's position carried between frames when it is hidden. Report which pitch the detections belong to: the earlier cropper failed by following people on the next pitch, so restrict to the pitch the camera is following.
3. **Build the crop from the ball and the players around it.** A window that follows the ball with the nearest players inside it, smoothed so it does not jump, at a size that keeps the players large (the working test used 640x360 or 960x540 of the 1920x1080 picture, enlarged 2x). Measure how often the window contains the marked action for its whole length on the 61 marks, and what it does when the ball is lost (fall back to the cluster of players nearest the last known ball, never to the whole picture without saying so).
4. **Ask the question on the automatic crops.** One generic question per window that names no single action ("list every moment worth keeping for that player's family": start, end, kit colour, what the player did, tags from the sport's list, a rating), so it scales to every sport without a call per tag. Models and settings to start from: Argon at 1 frame per second, high resolution; Hydrogen at 5 frames per second, default resolution. Score on all seven slices.

## How it is judged

The owner's bar (EPIC "Go or no-go gate"): no parent pays unless the analysis finds their own child's highlights; a missed highlight or a false statement about the game (a corner called a goal, a goal called a save) is not acceptable at any price; cost matters only after accuracy. Report, for the whole pipeline on the seven slices:

- five-star marks returned as a moment rated 4 or 5, with the right team (the bar we are aiming at is 80%; today 39% on the full picture);
- four-star marks the same way;
- every marked goal called a goal by the right team, and every false statement found;
- moments a parent would have to look through per ten minutes;
- cost for a 90-minute game, split into finding the crop and asking the question;
- time to a finished analysis for a 90-minute game.

## Why this and not something else

Asking a model where the ball is on every frame works but costs more than everything else put together. Cutting the picture into fixed tiles and asking on each was the other candidate; it needs no finder but multiplies the question cost by three or four and still asks on empty grass. A detector that runs on our own rented graphics card costs cents per game if it is reliable, and the earlier research already chose and measured tools for exactly this footage. Other video models were tried the same day and dropped: Twelve Labs missed the goal and invented player credit, Perceptron called the goal a save.

## For the implementer

### Relevant Files (REQUIRED)
- `.claude/knowledge/ai-coach-video-analysis.md` (read first)
- `docs/research/click-once-following-2026-11.md`, `C:/Users/imank/projects/player-tracking` (outside the repo; read only)
- `docs/plans/tasks/player-moments/EPIC.md`, `T14295-research-refresh-candidate-registry.md`, `T14320-click-seeded-tracking-bakeoff.md`
- `src/backend/app/modal_functions/video_processing.py` (the app's person detection; read only)
- Prototype checkout `C:/work/tasks/g-t16130-2/gemini_analysis_test/` on branch `feature/T16130-T16145-sport-chooser-where-tags`: `videos/` (the seven slices), `outputs/golden/owner-annotations-*.json` (the marks), `crop/`, `dribble/`, `tracking/`, `cost_model.py`, `prompts.py`, `sport_blocks.py`, `merge_windows.py`. Most of it is untracked: copy what you need before that container is cleared.
- New work goes in `gemini_analysis_test/autocrop/`.

### Technical Notes
- **Budget.** The owner approved $30 of Gemini spend to close out the prototype; $18.78 was spent by the end of 2026-11-20. Ask the owner for a figure before spending; give a plan and a cap per step, and stop at each cap. Every call's worst case is reserved before it is sent (one call that thought to its limit cost $0.52 and returned nothing).
- **Footage rules.** Only the seven ten-minute slices, or crops cut from them. Never a full game. Private upload only; nothing public. Two slices belong to other families who agreed to testing (see T18040 for the consent rule); delete uploads from any outside service when done.
- **The marks are one child's view.** They measure what is missed. A moment with no mark is not known to be wrong. Whether a goal was scored is a fact both sides must agree on.
- **Athlete.** In `sporting-77m` the owner's child is Navy blue number 30; the number cannot be read by a person at normal size. Do not score credit by jersey number.
- **Scoring rule** (keep it, so results line up with the table in the knowledge doc): a moment matches a mark when they share at least half of the shorter of the two.
- **No audio.** The slices we checked carry no audio track, and no audio was ever sent to a model.
- **Argon's price doubles on 2026-12-01.** State costs at both prices.
- **Local detector speed.** YOLO11s on this machine's CPU took about 6 seconds a frame at full resolution; plan for a rented graphics card (Modal is already set up for the app) and measure the per-game time there.
- Calls stay separate until separate calls have shown everything they can do (owner, 2026-11-20).

### Related Tasks
- Follows: T16145 (prompt, joining, dead time, the highlight tests). Blocks: T16150 and everything after it, through the epic's gate. Related: Click-once Spotlight (T16220 uses SAM 2.1 for following; shared detection work), [RESEARCH-gemini-boxes-2026-11-20.md](../click-once-spotlight/RESEARCH-gemini-boxes-2026-11-20.md).

## Acceptance Criteria

- [ ] A written inventory of the earlier detection and tracking work says what each tool measured, on what footage, and what it can be reused for here.
- [ ] On the seven slices, the share of on-field players detected and the share of frames with the ball found are reported against frames a person checked, for each detector tried.
- [ ] The automatic crop's share of the 61 marks contained for their whole length is reported, with what happens when the ball is lost.
- [ ] The whole pipeline (automatic crop, one generic question) is scored on all seven slices in the columns listed under "How it is judged", next to the full-picture numbers.
- [ ] Cost and time for a 90-minute game are reported, split by step, at Argon's current and December prices.
- [ ] The owner has recorded go or no-go for the epic, and `.claude/knowledge/ai-coach-video-analysis.md` is updated with the result.
