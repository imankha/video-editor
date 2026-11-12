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
3. **Watch in windows.** First window alone, to fix the two kit colours; then all remaining 5-minute windows in parallel with those colours named in the prompt. Windows overlap by 10 seconds.
4. **Trust nothing.** After each window: valid against the schema, not empty, and the last play ends near the window's end; otherwise request the uncovered remainder, up to a retry limit. Timeouts on every call. Retry 503 and 403 SERVICE_DISABLED with backoff; never retry 429.
5. **Merge.** Join the windows in time order, merge plays that overlap by half or more across a boundary, convert MM:SS to seconds, and store one result with the two team colours.
6. **Record truth.** Per window: status, attempts, tokens. Per analysis: stage, windows done out of total, tokens, dollars, timings, failure reason. These feed the progress screens (T16170) and the margin read-out (T16160).
7. **Survive.** A job is resumable from its window rows after a restart; finished windows are not paid for twice.
8. **Guard.** Kill switch, daily spend cap, maximum video length, sport allow-list (soccer only at launch). The prompt takes its tag list from the sport.

The complete analysis either finishes or fails; there is no partial result offered to parents.

## Why this and not something else

Storing results per parent was ruled out by the owner (analyse once). Cutting the file into pieces ourselves was ruled out by the prototype: offsets on one uploaded file are billed only for the window and keep the file's own clock. Longer windows would be cheaper but the prototype showed a call silently stops after about five minutes of video.

## For the implementer

Read `gemini_analysis_test/HANDOFF_PROMPT.md` (API facts, prompt, schema, and the list of problems the prototype did not solve) first, and start from `run_interactions.py`, the closest thing to production code. The owner ruled on 2026-11-12 that no separate recall check runs before building, so this task is the first time a full game is analysed: the coverage check, the fixed team colours, the window overlap and the retry rules in steps 3 to 5 are new work, not lifted code, and the first staging run's cost and timings must be written into the task's progress log and EPIC.md.

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
- Postgres track migrates only by `POST /api/admin/migrate-postgres` after deploy.

### Related Tasks
- Depends on: nothing in the epic; needs a paid Gemini key (owner). Blocks: T16160, T16170, T16190.

## Acceptance Criteria

- [ ] On staging, a 90-minute soccer game produces a stored analysis whose windows all report full coverage, with both kit colours and plays in seconds on the video's own clock.
- [ ] Requesting the same video, sport and prompt version again returns the stored result and makes no model calls (asserted in a test with a fake client).
- [ ] Two requests arriving together produce one job; the second joins it.
- [ ] A window that returns a short or empty answer is requested again; a job that cannot be completed ends as failed with a reason.
- [ ] Killing the backend mid-job and restarting completes the job without re-running finished windows.
- [ ] The first full-game staging run's measured dollars, upload time, preparation time and analysis time are recorded in the progress log and in EPIC.md beside the prototype's estimates.
- [ ] Windows done out of total, tokens and dollars are stored and match the fake client's totals in tests.
- [ ] Kill switch, daily spend cap, maximum length and sport allow-list each refuse with a distinct reason, covered by tests.
