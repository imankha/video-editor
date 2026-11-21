# AI Coach video analysis: what has been tried and what it showed

Domain: the AI Coach epic (`docs/plans/tasks/mark-plays-with-ai/`), the prototype that sends game video to a video model. This doc is the record of the 2026-11-20 prototype work, so nobody repeats a test. It is research, not shipped code: nothing here is in the app.

updated: 2026-11-20 (first version; one day of tests, mostly one run per setting)

## Where things stand

- **The epic is gated.** Go or no-go rests on one question: does the analysis find a child's highlights with no false statement about the game? (EPIC "Go or no-go gate", T16145 step 9.) Nothing after T16146 starts before the owner says go.
- **Verdict so far: not yet.** On the full camera picture no model or setting reached the bar. One direction works in a hand-built test: crop to the play and enlarge it. Finding that crop automatically and cheaply is the open problem, and is task T16146.
- **What is solid:** cutting the game into pieces, dead time as its own entries, joining pieces with no doubles, the sport-neutral prompt split, the cost model. See "Works" below.

## The business bar (owner, 2026-11-20)

- No parent pays unless the analysis finds their own child's highlights. Coaching notes are a nice extra.
- Zero tolerance for a missed highlight or a false statement about the game (a corner called a goal, a goal called a save), at any price.
- Cost decides how many parents try it, not whether it ships: at $50 a game there is a buyer, at $2 most parents buy. The earlier $3.39 cost ceiling is lifted.
- Working target used in the tests: at least 80% of five-star marks returned as a moment rated 4 or 5, no false goal or save, few enough moments to review a game in a couple of minutes.
- If nothing reaches the bar the epic is shelved until models improve.

## Test data

Seven ten-minute slices (1920x1080, wide auto-follow sideline camera, players about 30 px tall), cut read-only from stored games, each with the plays a parent marked by hand in the app:

| Slice | Game | Marks | Five-star |
|---|---|---|---|
| `sporting-77m` | owner, at Sporting Mar 21, minutes 77-87 | 14 | 4 |
| `sporting-90m` | owner, same game, minutes 90-100 | 9 | 5 |
| `rangers-10m` | owner, Vs Rangers Aug 29 | 4 | 4 |
| `carlsbad-11m` | owner, Vs Carlsbad SC Dec 6 | 7 | 4 |
| `girls-soccer-53m` | second parent (permission given), girls' soccer | 4 | 2 |
| `u9-legends-21m` | third parent, a partner (permission given), U9 | 9 | 3 |
| `u9-fram-21m` | third parent, U9 | 14 | 1 |

61 marks, 23 five-star, 29 four-star. All soccer: the one flag football game we had permission for is no longer in storage.

- **The marks are one child's view**, not every highlight in the game. They measure what is missed. A moment with no mark is not known to be wrong. Whether a goal was scored is a fact.
- **Scoring rule used everywhere:** a moment matches a mark when they share at least half of the shorter of the two.
- **`sporting-77m` facts:** the owner's child is Navy blue number 30 (the number cannot be read at normal size, by the owner either). A Navy goal at about 260-271 s. Two five-star dribbles at about 11-21 s and 317-327 s; the owner confirmed both are plainly visible to a person.
- Also `s1-10min.mp4` (first ten minutes of the Breakers game) with the owner's hand-written account of 4:18-5:56 (`outputs/golden/owner-truth-0418-0556.md`), used for joining and stoppage accuracy.

## Results on the full picture

Seven slices, prompt version 5, one run each:

| Model | Five-star rated 4-5 | Five-star matched at any rating | Four-star rated 4-5 (of 29) | Marked goals called a goal (of 9) | Cost per 90-minute game |
|---|---|---|---|---|---|
| Gemini 4 Hydrogen, default thinking | 9 of 23 | 20 | 10 | 4 | about $3.16 |
| Gemini 4 Argon, in pieces | 9 of 23 | 17 | 9 | 5 | about $2.23 (doubles 2026-12-01) |

The pattern: the passage is usually found, the child's moment is rated too low, and it is never credited to the right child. No run ever named number 30; numbered credits on the owner's marks were other children.

On `sporting-77m` (four five-star marks), everything tried:

| Configuration | Five-star rated 4-5 | Notes |
|---|---|---|
| Argon, v5, two pieces | 2 | best on the full picture |
| Hydrogen, v5, default thinking | 1 | finds most passages, rates few |
| Hydrogen, low or medium thinking | 0-1 | medium called the goal a save; low rated 2 of 14 marks 4-5 |
| Argon, one call at 2 fps | 0 | worse than pieces; called the goal a save |
| Parent's-eye rating prompt (v6) | 1, then 0 | no gain |
| Athlete-only pass ("Navy blue 30") | 0 | Hydrogen found nothing; Argon's moments were inferred, none on a five-star mark |
| Re-watch each moment at 5 fps, high resolution | n/a | calls the goal; never names the athlete as the actor; about $14 a game |
| 3 fps on the pieces | 0 | $4.36 a game |
| Hydrogen + Argon combined | 1 rated, 3 matched | about $5 a game |
| Twelve Labs Pegasus 1.6 | 0 | missed the goal, described it as a counter-attack; invented player credit; dropped |
| Twelve Labs Marengo search | n/a | barely better than picking segments at random; dropped |
| Perceptron Mk1 | 1 | called the goal a save, invented a goal; said "dribble" on every clip; dropped |

## The dribble tests (`sporting-77m`)

- **Asking only "does a player dribble past an opponent" on the full picture:** Hydrogen never found the first dribble (0 of 14). It found the second 5 of 6 at high resolution but called the dribbler "white" each time. Frame rate (1, 5, 10) did not matter; resolution did.
- **Cropped by hand to the play, enlarged 2x** (640x360 of the frame): Argon at high resolution found both dribbles 3 of 3 at 1 fps and at 5 fps, right team every time. Hydrogen's best setting differs per dribble and its other settings scored 0 of 3 on one or the other. 3x was no better than 2x. The goal came back as a goal by Navy every time.
- **Finding the crop automatically:**
  - Gemini on one still a second, asked for the ball carrier: the window held both dribbles for their whole length; about $0.008 a frame, so $36-44 a game. One still every 2 s loses the first dribble. 30% of stills found no ball carrier.
  - Local person detector (YOLO11s), densest cluster: drifted to players on the next pitch; first dribble 0 of 3; about 6 s a frame on CPU.
  - Motion (pan-compensated frame differences): the dribbles and the goal ranked below the median second. Useless.
  - Sound: the slice has no audio track, and no audio was ever sent to any model.
- **One generic question on the crop** (all tags at once, no per-tag calls): the goal is right every time; dribbles are still found but with the wrong team or a different tag in some calls. About 20% dearer than the narrow question. One or two calls each: thin.
- **Whole pipeline as built** (stills crop + generic question): about $50 a game. On two minutes, Hydrogen found both dribbles with the right team at least once but also reported a "white" dribbler on the same play and 13 dribble candidates.

## Works

- **Pieces and joining.** Five-minute pieces, 30 s overlap. With stoppages as their own entries and plays cut only at real events (prompt v3 on), both pieces cut the overlap at the same stoppage. Joining strategy `stoppage_then_cut` (switch pieces at a shared stoppage, else one cut per line): 0 doubles, 0 lost, 0 strong plays dropped on 14 real lines. A 60 s overlap was worse. No model call is used for joining. Design: `docs/plans/tasks/mark-plays-with-ai/T16145-dedup-design.md`.
- **Dead time.** Model stoppage times were within about 2 s of the owner's on the stretch he timed. Notation: `kind: dead_time` with a reason; a `dead_time` list beside `plays` in the joined result. The two runs marked 27% and 44% of one clip as dead, so measure before trusting it for skipping (T16206).
- **Sport-neutral prompt.** A template with no sport's words plus a block per sport built from the sport's tag file; a test fails on any sport word in the template. Only soccer has been run on video.
- **Moments.** Each player's part of a play gets its own 3-12 s start and end, so a clip is cut from the moment (8-10 s) and not the passage (15-24 s). De-duplicated across the overlap.
- **Cost model.** `cost_model.py` predicts a call before it is sent, records what it cost, and refits. A guard reserves each call's worst case, added after one phase overspent its cap by $0.66.

## Does not work (do not retry without a new idea)

- **Boxes asked for inside a video call** are not on the players; no offset or rescale fixes them. Boxes on a single full-resolution still are tight.
- **Following one player through a video call:** 0 of 12 frames.
- **Re-finding a player from one reference picture on stills** works when he is clear (14 of 14) but the model names somebody even when he is absent. A free local tracker held a player a median of 3.6 s. Whole-game following: $4-19 per child.
- **Low thinking.** Looked accurate on a stretch with no highlights; rated 2 of 14 real marks as highlights.
- **Reading jersey numbers** at this size. Player boxes and tracking were removed from AI Coach; the research is kept in `docs/plans/tasks/click-once-spotlight/RESEARCH-gemini-boxes-2026-11-20.md`.
- **A text-only model call to join pieces.** The two pieces described the same passage as a saved shot and as a cross forcing a corner; text alone would call them different events.

## Landmines

- **A run that thinks to its limit returns nothing and still costs.** $0.52 at 65,536 tokens. Always set an output limit; default thinking needs about 32,768 with the moments prompt (16,384 returned no answer twice).
- **Content is often wrong even when timing is right.** On the stretch the owner timed, every model invented a shot, a save or a corner that did not happen.
- **4 of 36 answers stopped early.** Production needs the "watch the rest again" check.
- **A parent's rating is not a neutral rating.** A clean pass by their child is a 4 to them and a 2 to the model. A rating threshold alone will hide what the parent came for.
- **Media resolution goes on the video content** (`"resolution": "high"`), not inside `processing`; the API rejects it there.
- **Hydrogen does not accept "minimal" thinking.**
- **Argon's price doubles on 2026-12-01.** Argon runs reported no thinking tokens; treat its cost figures with care.
- **Reddit and the Hugging Face Hub pages blocked automated reading**; the model scan is secondary-sourced.

## Where the files are

Prototype checkout: `C:/work/tasks/g-t16130-2/gemini_analysis_test/` (dotask group `g-t16130-2`, branch `feature/T16130-T16145-sport-chooser-where-tags`). Much of it is untracked and is lost when the container is cleared: copy before nuking.

| Path | What |
|---|---|
| `videos/`, `outputs/golden/owner-annotations-*.json` | the seven slices and their marks |
| `outputs/runs/S-slices-v5/`, `X-experiments/summary.md`, `A-argon-v5/`, `M-moments-v5/`, `H-highlights-v4/` | the full-picture runs and the ranked table |
| `outputs/runs/J-joining-v1/`, `P-v4/`, `S5-s1-10min-colors-v3/` | joining scores, thinking and accuracy settings, the v3 segmentation run |
| `dribble/`, `crop/` | the dribble-only test and the crop-and-enlarge test (ledgers, contact sheets) |
| `tracking/`, `outputs/runs/B-stills-boxes-v1/` | one-player tracking and four-box tests |
| `twelvelabs/`, `perceptron/` | the two dropped vendors (raw answers, notes, ledgers) |
| `outputs/golden/argon-s1-10min/review.html` | a page to correct a model's play list against the video |
| `prompts.py`, `sport_blocks.py`, `merge_windows.py`, `cost_model.py`, `run_windows.py` | prompt, sport blocks, joining, cost model, runner |

Earlier detection and tracking research (before this epic): `C:/Users/imank/projects/player-tracking` and `docs/research/click-once-following-2026-11.md` (SAM 2.1 base+ chosen for following from one tap), the Player Moments epic, and the app's YOLOv8x person detection on Modal.

## Spend (2026-11-20)

Gemini: $18.78 of the $30 the owner approved to close out the prototype, plus $3.62 before that and about $2.80 of separately approved side tests. Twelve Labs $5.98 (computed from list prices; everything deleted from the account). Perceptron $0.48 of $5 credit.

## Consent

Until existing users have been told about the 2026-11-20 privacy policy change and can opt out in the app (T18040), only footage from accounts whose owners agreed in person is used: the owner and the two parents above. Uploads to outside services are private and deleted afterwards.

## Active work

- T16146: find the ball and players, crop to the play, ask one generic question; score on all seven slices. Carries the go or no-go.
- T16145: the prompt and joining prototype; its remaining steps (team direction across half time, the who-is-who call, a numbered approved version) wait for the gate.
- Untested ideas, in rough order of promise: fixed overlapping tiles with no finder; a second model family voting on short clips (Qwen3-Omni or Qwen3-VL on a rented graphics card); sending audio; a soccer action spotter (T-DEED) fine-tuned on parent marks.
