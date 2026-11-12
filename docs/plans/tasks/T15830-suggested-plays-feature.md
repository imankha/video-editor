# T15830: Suggested plays feature

## In plain words

If the proof passes, every uploaded game gets a list of suggested plays for the parent to review, in the same one-tap list the Veo import already uses, so there is no new screen to learn. The model runs after the upload finishes and the parent gets a suggested-plays-are-ready message. The first three games on an account are free; after that a game costs a small number of credits set from the measured cost, charged when the job starts and refunded if it fails. The model name and the price live in configuration because the hosted prices change in January. Done when a new game shows its suggestions within fifteen minutes on phone and desktop, the free-then-paid rule holds, and the Journey shows more game uploaders reaching their first play.


**Status:** REMOVED (2026-11-12, replaced by the Mark plays with AI epic, tasks/mark-plays-with-ai/EPIC.md)
**Impact:** 9
**Complexity:** 6
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Roadmap 3, Suggested plays by AI (see PLAN.md). BLOCKED on T15820 GO.

## The problem

Parents who upload a whole game then face 90 minutes of scrubbing; 193 users got footage in, 109
marked a play, and game uploaders convert to a paid highlight at 19% against 45% for clip users. The
Veo import proved the "suggested plays, one-tap accept" shape works but only for Veo owners.

## What we will do

Reuse the Veo import end to end; the only new piece is the generator.

1. **Job.** On `game_upload_succeeded` (and on demand from the game tile for existing games), a
   background job in the Live Queue pattern: Modal or Fly transcodes the game to 720p low-bitrate,
   splits into 15-minute chunks, calls the model chosen by T15820, merges overlapping windows, writes
   rows into `play_suggestions` with a `source` of `ai` (check whether the v059 table carries a source
   column; a Migration agent adds one only if not). Progress and failure surface like an export job.
2. **UI.** The existing suggestions list in Annotate (T13220): tap a rating to keep, dismiss the rest;
   a "Suggested plays are ready" toast and email (the upload-complete email T7670 gains one line).
   Copy: "plays we think we saw", never "all your plays". Candidates are ordered by confidence.
3. **Price.** First three games per account free (a `suggested_plays_trial` counter in the credit
   ledger's own terms, no new table if the ledger can carry a zero-amount row with a source); then a
   flat per-game credit price set from the measured cost (about 15 to 20 credits at Flash-Lite
   prices covers cost with margin; owner sets the number). Charged at job start, refunded on failure,
   never charged for a re-run of the same source hash.
4. **Measurement.** `suggestions_ready`, `suggestion_accepted` milestones with sport in context
   (T14940 pattern); the Journey's Footage landed to First play edge is the gate, read by cohort
   (T15230).
5. **Cost control.** Per-account daily cap, per-game size cap, and a kill switch env var; the model
   name and price are config, not code, because Gemini 3.8 Flash doubles in price on 2027-01-01.

## How we will know it worked

- [ ] A newly uploaded 90-minute game produces a suggestions list in Annotate within 15 minutes, with confidence order and one-tap accept, on phone and desktop.
- [ ] The first three games on an account are free; the fourth shows the credit price before the job starts and refunds on failure (ledger tests).
- [ ] Recall and candidate count on the T15820 games match the proof within 10 points when run through the production job.
- [ ] `suggestions_ready` and `suggestion_accepted` appear in the admin Journey inspector with instrumented-at dates; the by-sport table counts them.
- [ ] Kill switch and daily cap covered by tests; model and price read from config.

## For the implementer

### Related Tasks
T15820 (proof), T13210, T13220, T13240 (Veo import), T7670 (upload-complete email), T14940 / T14950
(sport tagging), T15230, T14295 to T14340 (per-player tier later), T7230 to T7260 (emails).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/suggestions.py`
- `src/backend/app/migrations/profile_db/v059_play_suggestions.py`
- `src/backend/app/modal_functions/video_processing.py` (transcode job)
- `src/backend/app/services/storage_credits.py`, `src/backend/app/pricing.json` (price copy only)
- `src/backend/app/analytics.py`
- `src/frontend/src/screens/AnnotateScreen.jsx`
- `src/frontend/src/components/ProjectManager.jsx` (game tile action)
