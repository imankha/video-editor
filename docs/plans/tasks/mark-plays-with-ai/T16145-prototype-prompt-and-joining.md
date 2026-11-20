# T16145: Prototype the prompt and the joining

## In plain words

Today the analysis exists as a prototype on the owner's machine that watches one five-minute piece of a game (the full match video) at a time. Seven changes to what we ask the model and what it answers are planned, and none of them has ever been run. The prototype also has two known weaknesses: a play (a moment worth keeping) that crosses the line between two pieces gets cut in half, and different pieces sometimes disagree about which team is which. We will make every change in the prototype first, run it on test video, and put the output files in front of the owner, who changes the wording and the format until the answers look right. Only then is the server version built, as a copy of what the owner approved. An analysis is stored once per video and never redone, so a mistake found after launch would mean paying to analyse every stored game again. Done when the owner has read the latest output files and approved one version of the prompt, the answer format and the joining.

**Status:** WIP
**Impact:** 9
**Complexity:** 4
**Tier:** M (scripts in the prototype folder; no app code)
**Created:** 2026-11-14
**Updated:** 2026-11-14

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 2 of 10. Run in an interactive session with the owner, not as a headless group: the owner's reading of the output is the work.

## Problem

The prototype has measured cost and coverage for one piece of video. It has not run any of the following, and the server job (T16150) would otherwise be the first place they meet real video:

- the qualities, the "what this shows" sentence and the social-media flag for each player's action;
- where each player is on screen (tried in the prototype and removed from this epic on 2026-11-20, see step 6);
- the sentence telling the model that every time is on the whole video's clock;
- telling later pieces the two kit colours in words;
- overlapping pieces and joining them;
- which way each team is attacking.

Two faults were seen in the prototype's own answers. A play that is still going when a piece ends is written as a short stub, and the next piece writes its second half as another stub, so neither is usable. And in one of three calls the model gave one team's corners and attacks to the other team.

## Solution

### 1. The standing rule

From now on, any change to the prompt or to the answer format is made in the prototype first. The prototype is run, and the owner is shown the latest output files before anything else is built on the change. This holds after launch too. A test in the app fails when the server's prompt or format differs from the prototype's approved copy, so the rule cannot be skipped by accident.

### 2. Pieces that overlap by 30 seconds

Each piece still starts every five minutes, but runs 30 seconds into the next one: five and a half minutes of video per piece. Every moment near a line between two pieces is therefore watched twice. A play is cut in both pieces only if it is longer than 30 seconds and sits right across the overlap, which is rare for a highlight and is handled by stitching (below). The extra video adds about 11 cents to a 90-minute game: about $2.95 instead of $2.84. Allowing the same 15% for pieces watched again, the most a game should cost moves from $3.27 to $3.39, which still leaves a margin on every credit pack (13% on the cheapest credits).

### 3. Joining the pieces

The joining turns the pieces' answers into one list of plays. It is ordinary code, not a model call. For each line between two pieces it looks at the plays from both pieces that fall in the 30 seconds watched twice.

1. **Find cut-off plays.** A play is cut off at its end when it stops within two seconds of the end of its piece, and cut off at its start when it begins within two seconds of the start of its piece. The model is also asked to say, for each play, whether it was already under way when the piece began or still going when it ended. The prototype will show whether the model's own flag is reliable enough to use; the two-second rule decides until then.
2. **Find twins.** Two plays from different pieces are the same moment when they share at least half of their combined time, or when one sits at least 70% inside the other. The second test catches a cut-off stub lying inside the complete play.
3. **Choose between twins.**
   - A complete play beats a cut-off one.
   - When both are complete, the one rated higher for either team wins, because a missed highlight is the worst mistake the analysis can make. If still tied, the one naming more players wins, then the earlier piece.
   - When both are cut off (a play longer than the overlap), they are stitched into one play: the start from the earlier piece, the end from the later, and the description from whichever is rated higher.
4. **Plays with no twin.** A complete one is kept. A cut-off one is kept when it is rated 4 or 5 for either team, so a possible highlight is never thrown away; otherwise it is dropped only when the kept plays already cover most of its time.
5. **Write down every decision.** For each line between pieces, a report lists both versions of each play, which was kept, dropped or stitched, and why. The owner reads this report; later the server keeps it beside the stored result so a bad join can be traced.

### 4. Which way each team is attacking

A single piece from the second half cannot see the first half, so the model is not asked about the first half directly. Each piece reports, for each team, which way that team is attacking in that piece as seen from the camera: left, right, or unclear. The joining then works out which way each team attacked in the first period and writes that at the top of the result, next to the kit colour, with the time the teams changed ends.

This gives three separate ways to notice that a piece has the two teams the wrong way round:

- **Colour.** Later pieces are told the two kit colours in words (already planned).
- **Direction.** Within one period, every piece should report the same direction for the same team. A piece that disagrees with the others around it is suspect. This does not assume the teams change ends at half time, so it still works when the camera moves to the other side of the field.
- **The overlap.** The same 30 seconds are described by two pieces. If the earlier piece credits an attack to one team and the later piece credits the same attack to the other, one of them is flipped.

A suspect piece is watched again once, with a second, narrower question written for this job (owner, 2026-11-14). The first question asks the model to find and describe every play; this one asks only who is who, and is given everything that helps: the two kit colours in words, which way each team attacks in the pieces before and after, the plays from the two overlaps with the team each neighbour credited, and the suspect piece's own list of plays with their times and one-line descriptions. The answer says, for each listed play, which team did it, or that it cannot tell. A play the answer gives to the other team is turned over to that team's side (the stored result describes every play for both teams, which is what the "Wrong team" button in T16190 uses). A play it cannot tell is marked and counted in the team check. The owner ruled on 2026-11-14 that the app gets no screen for such a play until one has been seen, so the count from these runs is what decides whether more is needed. The owner reads this second question and its answers in the output files like the first, and it has its own version number.

The prototype tries two wordings and the owner picks one from the outputs. In the first, the piece is told only the colours and reports the direction it sees. In the second, the piece is also told which way each team attacked in the first period and that teams change ends between periods. The first keeps the direction as an independent check; the second may help the model keep the teams straight. Each is run on the same pieces, twice, and the number of pieces and plays with the teams mixed up is counted for both.

The wording is sport-neutral ("the first period", "change ends"); soccer's words ("first half") come from the sport's own strings.

### 5. What the owner is shown after every run

Each run writes one folder, and the session shows the owner these files:

- the raw answer for each piece;
- the joined result, in the format the server will store;
- the joining report from step 3;
- a team check: for each piece, the colours and directions it reported, what the neighbouring pieces said, and whether the overlap twins agreed; for a suspect piece, the second question as sent, its answer, and which plays were turned over or marked;
- six candidate example plays for the offer dialog (T16170), each with its still frame, tags, rating and coaching note, for the owner to choose from;
- a cost table: tokens and dollars per piece, and the projected cost of a 90-minute game;
- a list of what changed in the prompt and format since the previous run, with the owner's comments on that run.

The owner comments, the prompt or format is changed, and the run is repeated until the owner approves a version. The approved version gets a number, and that number is the prompt version the server stores with each analysis.

### 6. Where each player is: removed from this epic (owner, 2026-11-20)

The plan was for the analysis to say where each player is on screen. The prototype tried it three ways the same day. Boxes asked for inside the video call were not on the players. Boxes asked for on still frames were tight, but four boxes for every noted player cost $4.53 for a 90-minute game in the cheapest form, more than the analysis itself, and in about half the cases the player was not in the picture in a play's first two seconds. The owner removed boxes from AI Coach. The analysis returns no box, and nothing in this epic stores or draws one. What was learned is kept for the Click-once Spotlight milestone, which may or may not use it: [click-once-spotlight/RESEARCH-gemini-boxes-2026-11-20.md](../click-once-spotlight/RESEARCH-gemini-boxes-2026-11-20.md).

### 7. Proving the joining on real boundaries (owner, 2026-11-20)

The first real run doubled one attack at the line between its two pieces. Prompt version 3 then made stoppages their own entries and told the model to cut plays only at real events, and on the same clip the two pieces cut the shared 30 seconds at 05:17 and 05:18: the double went away with no change to the joining code. The owner then watched 4:18 to 5:56 and wrote down what happened. Two things follow from that account:

- **When the ball is dead, the model is right.** Version 3's stoppages match the owner's within about two seconds (4:21-4:48 against 4:23-4:47; 5:17 or 5:18 against 5:19; play resuming 5:40 against 5:42).
- **What happened is often wrong, in every model.** Version 2 reported a saved shot in one piece and a cross forcing a corner in the other; Argon reported a low cross blocked by the keeper; version 3 calls the restart a Navy goal kick. The owner saw a White throw-in, a hurried forward pass controlled by Navy, and a bad keeper pass going out. No shot, no cross, no corner.

So the joining is decided this way, accuracy first and cost second (owner, 2026-11-20):

1. **Truth.** The owner corrects the Argon output for the whole 10-minute clip on the review page (`outputs/golden/argon-s1-10min/review.html`). The corrected file is the truth; the owner's written account of 4:18 to 5:56 is its first part and is kept in `outputs/golden/owner-truth-0418-0556.md`.
2. **Real boundaries.** The same clip is run again with the piece start times shifted so the lines fall in about ten different places. Every line gives a real pair of overlapping answers. No answer is invented by a model.
3. **Score the candidates offline, at no model cost,** against the truth: today's joining; cutting at a stoppage both pieces report inside the overlap; one cut per line (the design in `T16145-dedup-design.md`); and stoppage first with one cut per line as the fallback. Counted per line: plays told twice, plays lost, seconds told by neither piece, strong plays dropped.
4. **A longer overlap** (60 seconds against 30) is run once on the same lines: dead ball came every 30 to 60 seconds in the owner's account, so a longer overlap should nearly always hold a stoppage to cut at. Its extra cost is measured.
5. **A second look at the video** for one line is tried only on the lines the best candidate still gets wrong, and is kept only if it is right more often than it is wrong on those lines. A call that reads only the two descriptions is not tried: at the one line we have, the two descriptions of the same passage did not describe the same event.

### 7a. Dead time is product data (owner, 2026-11-20)

The stoppage entries are no longer only a help for joining: the app will let a parent skip them when watching (T16206). So the approved run also reports, against the owner's truth, how far each stoppage's start and end are from the real ones, any stoppage that covers live play, and the share of the clip marked dead. That error sets the safety margin T16206 uses.

### 7b. The notation for a dead-time range (owner, 2026-11-20)

Until now a stoppage was written as an ordinary play with both ratings at zero, and the joined result dropped the mark that said it was a stoppage. Dead time gets its own notation, in the model's answer and in the stored result:

- **In each piece's answer**, every entry carries `kind`: `play` or `dead_time`. A `dead_time` entry has only `start`, `end` and `reason`, one of a short sport-neutral list: `out_of_play`, `restart_setup`, `official_stoppage`, `injury`, `substitution`, `break_between_periods`, `other`. It has no team sections, no players and no ratings, so the model cannot rate or describe dead time and spends no output on it.
- **In the joined result**, dead time is its own list beside the plays: `dead_time: [{start_s, end_s, reason}]`, in order, never overlapping each other or a play. `plays` holds only real plays. The joining reads `dead_time` entries from both pieces to find the shared stoppage it cuts at, and writes each range once.
- **In reports**, a dead-time range is written `[dead 04:23-04:47 out_of_play]`, so a reader can tell it from a play at a glance.
- **On the timeline in the app**, a dead-time range is drawn as a quiet gap (T16206).

### 7c. Nothing in the prompt belongs to one sport (owner, 2026-11-20)

The app supports many sports (the tag lists in `src/frontend/src/modes/annotate/constants/` cover soccer, basketball, football, flag football, baseball, softball, hockey, lacrosse, rugby, tennis and volleyball). The prototype's prompt was written against soccer video and names soccer things in its own text: goals and assists, goalkeepers, wingers, corners, through balls. The prompt is split in two:

- **The template** is the same for every sport and names none: what a play is, what dead time is, how to cut, how to rate, how to describe a player, the jersey-number rule, the clock rule, the joining notation. It says "score", "official", "restart", "period", "position", never a sport's word.
- **The sport block** is filled in from that sport's own data: the sport's name, its tag names with one line each (from the sport's tag file, the single source), a few example positions, what counts as a highlight in that sport, and its words for restarts and periods. Soccer is the only block written and tested now; adding a sport means adding a block, not editing the template.

A test fails if a word from any sport's tag file or a listed sport-specific term appears in the template. A second sport's block (basketball) is rendered into the template and checked for validity without any model call, to prove the split is real; it is not run on video in this task.

### 8. Is the description true (owner, 2026-11-20)

A parent shown "angled shot saved by the keeper" for a pass that went out of play will stop trusting the notes, and a rating of 4 on a routine passage sends them to the wrong clip. From the corrected truth we count, for prompt version 3: plays whose described event did not happen (a shot, save, cross, corner or goal that is not in the truth), restarts named wrongly, and plays rated 4 or 5 that the owner rates 3 or lower. Then one change at a time is tried on a single piece and counted the same way: more frames a second; higher resolution; and a prompt rule that a shot, save, cross into the box, corner or goal is written only when it is clearly seen, with the rating tied to that outcome. The owner sees the counts before any version is approved.

### 9. Go or no-go: does it find the child's highlights (owner, 2026-11-20)

The owner set the business test for the whole epic. No parent pays anything unless the analysis finds their own child's highlights; coaching notes are a nice extra. If it does that very well, price decides how many parents try it: at $50 for a 90-minute game there is still a parent who pays, at $2 most do. So accuracy decides whether the feature exists, and cost decides how big it is. An analysis that misses highlights, or states something false about the game (a corner called a goal, a goal called a save), is not shippable at any price. If no configuration reaches the bar, AI Coach is shelved until the models improve.

This changes how the prototype is judged:

- **The measure is highlight finding**, against plays parents marked by hand for their own children (seven ten-minute slices from six games, three parents, 61 marks, 22 of them five-star; more as they become available). A parent's marks are one child's view, not every highlight in the game, so they measure what is missed, not what is wrongly added.
- **For each configuration tried** (model, prompt, settings, number of passes): the share of five-star marks and of four-star marks that come back as a moment of about the right length; whether that moment is credited to the right player where the player is known; every stated fact that is false (goal, save, corner, restart); how many moments a parent would have to look through; cost for a 90-minute game; and time to a finished analysis.
- **Cost is no longer capped at $3.39.** That figure came from the planned price. A configuration that finds the highlights at a higher cost is reported with its cost, and the price follows from it (T16160's rate is one line in the pricing file).
- **More than one model is tried.** Gemini first (Hydrogen, Argon, two passes, an athlete-focused pass, higher frame rates, combined runs), then the same tests on Twelve Labs, so the choice rests on accuracy, cost and time measured the same way.
- **The owner decides** go or no-go from that table. Nothing after this task in the epic starts before a go.

## Why this and not something else

Building these changes straight into the server job was the earlier plan. It was dropped because the first full-game result would then be the first time anyone saw the new fields, and a stored analysis is never recomputed.

A longer overlap would catch longer plays whole, but costs more on every piece and pushes each call past the five minutes after which the prototype saw calls stop early. Thirty seconds covers a highlight, which is short by design, and stitching covers the rest.

Asking the model to join the pieces was ruled out: it costs another call, and it cannot be tested with fixed inputs.

Asking each piece "which way did this team attack in the first half" was ruled out because a second-half piece cannot know.

## How we will know it worked

- The owner has approved a numbered version after reading its output files.
- On the test video, no play in the joined result stops within two seconds of a line between pieces unless it was stitched, and no moment in an overlap appears twice.
- The count of pieces and plays with the teams mixed up is recorded for both wordings, and the owner has chosen one.

## Ruling

Ruled on 2026-11-14, before the first run: a cut-off play with no whole version is kept only when it is rated 4 or 5; both direction wordings are run on the same video and the owner picks from the counts; a suspect piece gets the second question described above.

Ruled on 2026-11-20: player boxes are removed from AI Coach. Boxes asked for inside the video call were not on the players; boxes from still frames were tight but cost more than the analysis and were often "not visible" at a play's start. The research is kept with the Click-once Spotlight milestone. Calls stay separate until separate calls have shown everything they can do.

Ruled on 2026-11-20, after the version 3 run and the owner's own account of 4:18 to 5:56: prompt version 3's segmentation (stoppages as their own entries, cuts only at real events) is the working prompt; the joining is chosen by scoring candidates on real shifted boundaries against the owner's corrected truth, accuracy first and cost second (step 7); a call that reads only the descriptions is not used for joining; how often a description is false is counted before any version is approved (step 8).

Ruled on 2026-11-20: dead time has its own notation (`kind: dead_time` with a reason, a separate `dead_time` list in the joined result) and is product data for skipping in playback (T16206); the prompt is a sport-neutral template plus a block per sport, soccer first.

Ruled on 2026-11-20 (the business test): no parent pays unless the analysis finds their child's highlights, and coaching notes are secondary; a missed highlight or a false statement about the game (a corner called a goal) is not acceptable at any price; cost is no longer capped at $3.39, the price follows from what works; Gemini configurations and Twelve Labs are compared on accuracy, cost and time; if nothing reaches the bar the epic is shelved until models improve (step 9).

(Still to record when the owner approves a version: the version numbers of both questions, the chosen direction wording, whether the model's own cut-off flag is used, the example plays chosen for the offer, and the date.)

## For the implementer

### Relevant Files (REQUIRED)
- `gemini_analysis_test/HANDOFF_PROMPT.md`, `TEAM_ONLY_RESULTS.md` (read first)
- `gemini_analysis_test/prompts.py` (`PLAY_BY_PLAY`, `PLAY_BY_PLAY_SCHEMA`, `_PLAYER`): the single source for prompt and schema; add `PROMPT_VERSION`
- `gemini_analysis_test/run_interactions.py` (one window; start here), `run_analysis.py` (upload, retry, save helpers)
- `gemini_analysis_test/run_windows.py` (new: upload once, all windows of a file with overlap, in parallel)
- `gemini_analysis_test/merge_windows.py` (new: pure functions, no API calls) and `test_merge_windows.py` (new: table-driven)
- `gemini_analysis_test/report_run.py` (new: writes the files in step 5)
- `gemini_analysis_test/PROMPT_CHANGES.md` (new: one entry per version: what changed, the run folder, the owner's comments)
- `src/frontend/src/modes/annotate/constants/soccerTags.js`, `generalQualities.js` (quality names and signs from T16320)
- `scripts/ci_policy.py`: the folder is untracked today; committing it needs a routing rule naming the job that runs `test_merge_windows.py`, or the `changes` job fails with `UnclassifiedPath`

### Technical Notes
- Windows: `start = 300 * i`, `end = min(start + 330, duration)`. Constants `WINDOW_STEP_S = 300`, `OVERLAP_S = 30`, `EDGE_S = 2`.
- Schema changes made here, all at once so a run costs one set of calls:
  - `teams.team_N.attacking`: enum `left`, `right`, `unclear`; description says "as seen from the camera, in the video sent".
  - `plays[].cut_off`: enum `none`, `start`, `end`, `both`.
  - per player: `qualities`, `shows`, `social`, `social_reason`. No `box` field: it was tried and removed (owner, 2026-11-20, step 6).
- Joined result gains `teams.team_N.attacks_first_period` (`left`, `right`, `unknown`), `ends_changed_at_s` (number or null), `windows[]` (`idx`, `start_s`, `end_s`, `attacking` per team, `teams_suspect`), and per play `source_window`, `stitched`, `teams_suspect`.
- Twin matching runs after times are converted to seconds on the video's clock and after the from-zero shift (T16150 step 4). Use intersection over union at 0.5 and containment at 0.7 as named constants.
- Slot agreement between overlap twins: compare which slot holds the higher relevance and the tag sets per slot; mirrored means both the relevance order and the tag sets match better when one side's slots are swapped. Log the score; do not auto-swap a piece on this alone before the owner has seen how often it fires.
- Settle call (`SETTLE_TEAMS` and `SETTLE_TEAMS_SCHEMA` in `prompts.py`, own `SETTLE_VERSION`): same file and window offsets as the suspect piece; input text carries colours, neighbours' `attacking`, the overlap plays with their credited slot, and the piece's plays as `{index, start, end, summary}`. Output per play: `team` (`team_0`, `team_1`, `cannot_tell`). Joined result gains per play `settled_by` (`none`, `settle_call`) and keeps `teams_doubtful` for `cannot_tell`. To test it without waiting for a real mix-up, swap the slots of one recorded piece by hand and run the settle call on it. Record its cost per call in the cost table.
- Direction check is a majority vote among the pieces between two changes of ends; `unclear` does not vote. Fewer than three voting pieces in a period means no verdict.
- Test video: `videos/breakers-20min.mp4` has no change of ends. Cut a second 20-minute file across half time from a full game under `formal annotations/` (the free key takes files up to 2 GB), so the direction logic sees a real change.
- The owner turned on billing for the Google key on 2026-11-14, so the free tier's limit of 20 requests a day no longer applies. One run of a 20-minute file is 4 calls; the two-wording comparison run twice is 16. Confirm the first run is billed (no daily-limit error) before planning a full-game run.
- `test_merge_windows.py` cases, from recorded answers and hand-made ones: complete beats cut-off; both complete, higher rating wins; both cut off, stitched; cut-off fragment rated 4 kept; cut-off routine fragment dropped; three-way split (one play in A, two in B); mirrored twins flagged; from-zero clock in the later piece.
- Keep `.env`, `videos/` and large `outputs/` out of git; commit one small approved run folder as the reference.

### Related Tasks
- Depends on: the quality list from the recruiting reel research ([T16320](../ai-reel-builder/T16320-recruiting-reel-research.md)). Blocks: T16150.

## Acceptance Criteria

- [ ] The owner has been shown the output files of the latest run and has approved a numbered version; the approval is recorded under Ruling.
- [ ] A run on a 20-minute file writes the raw answers, the joined result, the joining report, the team check, the cost table and the change list.
- [ ] `test_merge_windows.py` passes every case listed in the technical notes.
- [ ] In the approved run, no joined play ends within two seconds of a line between pieces unless marked stitched, and no two joined plays share more than half their time.
- [ ] The joined result names each team's kit colour and the direction it attacked in the first period, and on the file cut across half time it records when the teams changed ends.
- [ ] The second question was run on at least one piece with its teams swapped by hand and one real suspect piece if any occurred; its answers and cost are in the output files, and the owner has approved its wording.
- [ ] Six candidate example plays with still frames were shown to the owner, and the chosen ones are recorded under Ruling.
- [ ] Both direction wordings were run twice on the same pieces; the counts of pieces and plays with the teams mixed up are in the change list, and the owner's choice is recorded.
- [ ] A person compared every overlap in the approved run with the video and listed any play that was cut, doubled or wrongly stitched.
- [ ] The projected cost of a 90-minute game from the approved run is recorded; if it is above $3.39, the owner has been told before the version is approved.
- [ ] The prototype folder is committed without the key, the videos or the large outputs, and Branch CI passes.
- [ ] The approved prompt and answer format contain no box field, and no output file or joined result carries one.
- [ ] At least ten real lines between pieces on the test clip were scored against the owner's corrected truth for each joining candidate (plays told twice, plays lost, seconds told by neither, strong plays dropped); the table is in the change list and the owner has chosen the joining.
- [ ] For the approved prompt version, the count of plays whose described event did not happen, of restarts named wrongly, and of plays rated 4 or 5 that the owner rates 3 or lower is recorded against the corrected truth, and the owner has seen it before approving.
- [ ] Every entry in a piece's answer is marked `play` or `dead_time`; a dead-time entry has a start, an end and a reason and no ratings or players; the joined result lists dead time separately from the plays, with no range overlapping another range or a play.
- [ ] The prompt template contains no word that belongs to one sport (a test checks it against every sport's tag file and a list of sport terms); soccer's words come only from the soccer block, and a basketball block renders into the same template without a model call.
- [ ] One table ranks every configuration tried (model, prompt, settings, passes) on five-star and four-star marks found, credit to the right player, false statements about the game, moments to look through, cost for a 90-minute game and time to finish, across at least the seven marked slices; the owner has recorded go or no-go for the epic under Ruling.
