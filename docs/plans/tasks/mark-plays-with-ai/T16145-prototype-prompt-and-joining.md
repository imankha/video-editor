# T16145: Prototype the prompt and the joining

## In plain words

Today the analysis exists as a prototype on the owner's machine that watches one five-minute piece of a game (the full match video) at a time. Seven changes to what we ask the model and what it answers are planned, and none of them has ever been run. The prototype also has two known weaknesses: a play (a moment worth keeping) that crosses the line between two pieces gets cut in half, and different pieces sometimes disagree about which team is which. We will make every change in the prototype first, run it on test video, and put the output files in front of the owner, who changes the wording and the format until the answers look right. Only then is the server version built, as a copy of what the owner approved. An analysis is stored once per video and never redone, so a mistake found after launch would mean paying to analyse every stored game again. Done when the owner has read the latest output files and approved one version of the prompt, the answer format and the joining.

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Tier:** M (scripts in the prototype folder; no app code)
**Created:** 2026-11-14
**Updated:** 2026-11-14

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 2 of 10. Run in an interactive session with the owner, not as a headless group: the owner's reading of the output is the work.

## Problem

The prototype has measured cost and coverage for one piece of video. It has not run any of the following, and the server job (T16150) would otherwise be the first place they meet real video:

- the qualities, the "what this shows" sentence and the social-media flag for each player's action;
- the box around each player;
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

A suspect piece is watched again once, with a second, narrower question written for this job (owner, 2026-11-14). The first question asks the model to find and describe every play; this one asks only who is who, and is given everything that helps: the two kit colours in words, which way each team attacks in the pieces before and after, the plays from the two overlaps with the team each neighbour credited, and the suspect piece's own list of plays with their times and one-line descriptions. The answer says, for each listed play, which team did it, or that it cannot tell. A play the answer gives to the other team is turned over to that team's side (the stored result describes every play for both teams, which is what the "Wrong team" button in T16190 uses). A play it cannot tell is marked, so the app can treat it as doubtful. The owner reads this second question and its answers in the output files like the first, and it has its own version number.

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
  - per player: `qualities`, `shows`, `social`, `social_reason`, `box` (`time`, `box_2d`), exactly as specified in T16150's technical notes.
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
