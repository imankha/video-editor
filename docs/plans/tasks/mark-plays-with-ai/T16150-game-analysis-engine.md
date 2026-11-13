# T16150: Game analysis engine

## In plain words

Today the app has no way to send a game (the uploaded match video) to a video model; the analysis only exists as a prototype script on the owner's machine. This task builds the part nobody sees: a server job that sends a stored game to the model in five-minute pieces, all at once, checks that every piece was fully watched, joins the answers into one list of plays for both teams, and keeps it. The result is stored against the video itself, not against the parent, so when a second parent uploads the same game the stored result is used and nothing is computed again. The job records real progress, such as 11 of 18 sections watched, so the screens built later can tell the truth. Done when a 90-minute game on staging produces a complete stored analysis, a second request for the same video makes no new model calls, and a job interrupted by a server restart picks up where it stopped.

**Status:** TODO
**Impact:** 9
**Complexity:** 7
**Tier:** L (new service, shared-database tables, external API; Architect design gate; Migration agent)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 2 of 7. See EPIC.md for the owner decisions and the measured numbers.

## Problem

The prototype proves the calls work. It does not solve what production needs: calls that stop early without an error, plays that straddle two windows, each call choosing its own team colours, empty answers, a file that must travel from our storage to Google, restarts in the middle of a job, and two parents asking for the same game at the same moment.

## Solution

A backend analysis service with no user interface and no credits (T16160 adds the charge). It exposes one internal call, "make sure this video has an analysis for this sport", and a status read.

1. **One analysis per video.** Keyed on the video's fingerprint, the sport and the prompt version. Asking for one that is ready returns it. Asking for one that is running joins it. Otherwise a new job starts.
2. **Send the video.** Stream the stored file to Gemini's Files API and wait until it is ready. Files expire there after 48 hours, which is fine: the result is ours.
3. **Watch in windows.** First window alone, to learn the two kit colours; then all remaining 5-minute windows in parallel, each told in words "team_0 is X, team_1 is Y". Windows overlap by 10 seconds. The prompt also says that every timestamp is on the whole video's clock, not counted from the start of the window. The job always analyses both teams.
4. **Trust nothing.** After each window: valid against the schema, not empty, timestamps on the video's clock (an answer that counts from zero in a later window is detected and shifted), and the last play ends near the window's end; otherwise request the uncovered remainder, up to a retry limit. Timeouts on every call. Retry 503 and 403 SERVICE_DISABLED with backoff; never retry 429.
5. **Merge.** Join the windows in time order, merge plays that overlap by half or more across a boundary, convert MM:SS to seconds, and store one result with one colour name per team, taken from the first window. A team is identified by its slot (team_0 or team_1) everywhere; the colour text in later answers is ignored because it drifts ("white", "white and black").
6. **Record truth.** Per window: status, attempts, tokens. Per analysis: stage, windows done out of total, tokens, dollars, timings, failure reason. These feed the progress screens (T16170) and the margin read-out (T16160).
7. **Survive.** A job is resumable from its window rows after a restart; finished windows are not paid for twice.
8. **Say what each action demonstrates.** For every player's part in a play the model also returns one to three qualities from the sport's fixed list and one plain sentence saying what the action shows about the player, written for a college coach. A quality is what the play shows about the athlete (pace, vision, composure); a tag is what happened (Goal, Tackle). Routine actions get an empty list and an empty sentence. The prompt is worked backwards from what coaches look for (owner, 2026-11-13): its description of a player highlight is built from the quality list and each quality's visible signs, so the model hunts for scoutable moments by name instead of for a general idea of a good play. It hunts just as hard for a second kind (owner, 2026-11-13): moments that are impressive for social media, which would make someone who knows nothing about the athlete stop and watch, such as a spectacular goal, a skill move or a big save. For each player's part it records whether the action is social-worthy and one sentence saying why. Either kind makes the play a 4 or 5 for that player's team, and a play can be both. These plays are what parents pay to turn into highlights, so missing one is the worst mistake the analysis can make: the model includes a moment when unsure and makes a second pass through each window looking only for missed ones. The AI reel builder planned after the reel builder reads these, and they must be in the first prompt version: a result is stored once per video, so adding them later would mean paying to analyse every stored game again.
9. **Guard.** Kill switch, daily spend cap, maximum video length, sport allow-list (soccer only at launch). The prompt takes its tag list from the sport.

The complete analysis either finishes or fails; there is no partial result offered to parents.

## Why this and not something else

Storing results per parent was ruled out by the owner (analyse once). Cutting the file into pieces ourselves was ruled out by the prototype: offsets on one uploaded file are billed only for the window and keep the file's own clock. Longer windows would be cheaper but the prototype showed a call silently stops after about five minutes of video.

Asking the model for one team only, fixed by a picture of its kit that the parent taps before the analysis, was tested on 2026-11-12 with ten calls and ruled out. A 90-minute game would cost about $2.48 instead of $2.84, of which only about 22 cents is a reliable saving. The model wrote 9 or 10 plays a window instead of 19, and the requested team got no more strong plays than before. It would also mean a second analysis, paid again, for the other team's parents and for anyone who picked the wrong team. Both teams in one stored result stays.

## For the implementer

Read `gemini_analysis_test/HANDOFF_PROMPT.md` (API facts, prompt, schema, and the list of problems the prototype did not solve) first, and start from `run_interactions.py`, the closest thing to production code. The owner ruled on 2026-11-12 that no separate recall check runs before building, so this task is the first time a full game is analysed: the coverage check, the fixed team colours, the window overlap and the retry rules in steps 3 to 5 are new work, not lifted code, and the first staging run's cost and timings must be written into the task's progress log and EPIC.md.

Also read `gemini_analysis_test/TEAM_ONLY_RESULTS.md` (2026-11-12). Besides ruling out one-team analysis, its ten calls found four things this task must handle:

- **Timestamp clock.** 8 of 10 answers counted MM:SS from the start of the window instead of the file's clock. Every one of those calls had a picture attached; the one earlier call without a picture used the file's clock. The prompt sentence in step 3 is untested, so the code check in step 4 is required, not optional.
- **Teams swapped inside an answer.** In 1 of 3 both-teams calls the team label was right but one team was credited with the other's corners and attacks. A correct label does not prove correct attribution.
- **Goals that did not happen.** 3 of 10 answers reported a goal the frames do not show, and repeat runs of the same window disagreed.
- **Scores move between repeats.** The same window gave 4 strong plays in one run and 7 in another.

Naming the two colours in words to later windows (step 3) is the handoff's proposal and has not been run. A kit picture did pin the team in 10 of 10 calls and is the fallback for games where both kits would be described the same way; it adds about 1,140 input tokens a call. Do not build the fallback unless the staging run shows words are not enough.

### Proposed tables (Postgres, shared; Architect confirms)

`game_analyses`

| Column | Type | Source |
|---|---|---|
| id | bigserial PK | |
| blake3_hash | text | `game_videos.blake3_hash` of the video |
| sport | text | profile sport at request time |
| prompt_version | int | constant bumped when prompt or schema changes |
| model | text | config, `gemini-4-hydrogen` |
| status | text | queued, sending, preparing, watching, merging, ready, failed |
| windows_total, windows_done | int | from the window rows |
| team_0_color, team_1_color | text | first window's answer |
| duration_seconds | real | from the video |
| result_key | text | R2 key of the merged JSON, `analyses/{hash}/{sport}-v{prompt_version}.json` |
| input_tokens, output_tokens, thought_tokens | bigint | summed usage |
| cost_usd_micros | bigint | tokens times configured prices |
| failure_reason | text null | |
| created_at, started_at, finished_at | timestamptz | |

Unique on (blake3_hash, sport, prompt_version).

`game_analysis_windows`: analysis_id, idx, start_s, end_s, status, attempts, covered_until_s, input_tokens, output_tokens, thought_tokens, updated_at. Unique on (analysis_id, idx).

### Relevant Files (REQUIRED)
- `src/backend/app/services/game_analysis.py` (new: orchestration), `services/gemini_client.py` (new: thin wrapper, `api_version="v1beta"`)
- `src/backend/app/analysis_prompts.py` (new: prompt and schema lifted from `gemini_analysis_test/prompts.py`, tag list built from the sport)
- `src/backend/app/services/pg.py` (`_SCHEMA_DDL`) and `app/migrations/postgres/v{next}_game_analyses.py`
- `src/backend/app/routers/analysis.py` (new: status read; start is wired by T16160)
- `src/backend/app/services/storage.py` (`generate_presigned_url_global`, `presigned_r2_http_client`)
- `src/backend/app/services/export_worker.py` (pattern for recovery at startup: `recover_orphaned_jobs`)
- `src/backend/app/modal_functions/` if the byte transfer runs on Modal
- `.claude/knowledge/backend-services.md` (new section)

### Technical Notes
- Design gate questions: where the 2 to 3 GB transfer from R2 to Gemini runs (a Modal function that streams and returns the file URI is the proposal; the 18 light API calls can run in the backend), and how progress reaches the browser (status endpoint plus the existing WebSocket pattern, see frontend CLAUDE.md "WebSockets over polling").
- The fingerprint is a sampled hash (five 1 MB samples plus file size). Also compare duration before reusing a stored result.
- A game can hold several videos; each video is its own analysis.
- `gemini_analysis_test/` is untracked today: commit its code and `HANDOFF_PROMPT.md` with this task, keeping `.env`, `videos/` and large `outputs/` out of git.
- Secrets: `GEMINI_API_KEY` as a Fly secret on a paid Google project (the prototype key is free tier: 20 requests a day and 2 GB per file, which cannot take a full game). Model name and token prices in config.
- The tag enum in the schema must equal the sport's stored tag names exactly (`soccerTags.js`; the app displays `Save` as "Keeper Save"). Add a cross-language guard test like the one for curated combos.
- Qualities (owner, 2026-11-13; design in [ai-reel-builder/EPIC.md](../ai-reel-builder/EPIC.md)): each player object in the schema gains `qualities` (array, 0 to 3, enum of the sport's stored quality names) and `shows` (string, one sentence, may be empty). The existing `note` keeps its meaning (the lesson, or the famous-player comparison). The quality list comes from T16320 and is stored beside the sport's tags (`soccerTags.js` export `qualities`); the prompt builds its quality list from the sport exactly as it builds the tag list, with the same cross-language guard test. The prototype prompt's paragraph listing what a player highlight is (goal, assist, key pass and so on) is replaced by one generated from the sport's qualities and their signs; it is followed by a second paragraph for social-worthy moments, built from the signs the research writes for those. Each player object also gains `social` (boolean) and `social_reason` (string, one sentence, empty when `social` is false). The instruction to include a moment when unsure stays and applies to both kinds: the owner ruled that finding as many as possible matters most, because Brilliant plays are what parents pay for. The first staging run records how many plays per team are scoutable, social-worthy, and both. The added output tokens are part of the first staging run's measured cost; if they move the cost of a 90-minute game above $3.27, stop and report before changing the price.
- Postgres track migrates only by `POST /api/admin/migrate-postgres` after deploy.

### Related Tasks
- Depends on: nothing in the epic; needs a paid Gemini key (owner) and the soccer quality list from T16320. Blocks: T16160, T16170, T16190.

## Acceptance Criteria

- [ ] On staging, a 90-minute soccer game produces a stored analysis whose windows all report full coverage, with both kit colours and plays in seconds on the video's own clock.
- [ ] Requesting the same video, sport and prompt version again returns the stored result and makes no model calls (asserted in a test with a fake client).
- [ ] Two requests arriving together produce one job; the second joins it.
- [ ] A window that returns a short or empty answer is requested again; a job that cannot be completed ends as failed with a reason.
- [ ] Killing the backend mid-job and restarting completes the job without re-running finished windows.
- [ ] No play in the stored result has a time outside its window; a fake answer that counts from zero in a later window is shifted to the video's clock (test).
- [ ] Every window after the first reports the same two teams in the same slots as the first window; the stored colour names come from the first window only.
- [ ] In the stored result, every quality is a name from the sport's list (guard test), and on the staging game at least nine in ten player entries in plays rated 4 or 5 carry at least one quality and a sentence.
- [ ] In the same six windows of the human check below, the person also lists every scoutable or social-worthy moment they see in the video; the number the analysis missed is recorded, and the owner has seen it before the feature is switched on.
- [ ] Human check on the staging game, recorded in the progress log: for six windows spread across the game, a person compares the answer with the video and counts plays credited to the wrong team and goals that did not happen. The feature flag stays off until the owner has seen these counts.
- [ ] The first full-game staging run's measured dollars, upload time, preparation time and analysis time are recorded in the progress log and in EPIC.md beside the prototype's estimates.
- [ ] Windows done out of total, tokens and dollars are stored and match the fake client's totals in tests.
- [ ] Kill switch, daily spend cap, maximum length and sport allow-list each refuse with a distinct reason, covered by tests.
