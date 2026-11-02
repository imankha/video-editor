# T14370: Mark play silently does nothing (prod, Android, shared game)

**Status:** STAGING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-01
**Updated:** 2026-11-02

## Problem

User report 2026-11-01: on prod, gsarah@gmail.com (user `f6c7242e-6f55-4d5f-bf98-3e1b2fd469e7`,
flagged test account) tapped **Mark play** on an Android phone and nothing happened. The game was
shared with her ("Vs Rangers Aug 29", her game id 3, single video, 5223.65s, 1920x1080, storage
`active`, not plays-only, materialized 2026-11-01 22:14 UTC). The reporter's own Android, on a game
they uploaded, works.

Evidence gathered (prod admin API, `user_action_log`):
- `add_clip_opened` at 2026-11-02 00:15:40, 00:17:22, 00:17:32 UTC: the tap reached
  `handleAddClipFromButton` (the achievement is recorded inside the `requireAuth` action).
- NO `clip_save_attempted` for any of them (recorded on the first line of `POST /api/clips/raw/save`),
  and game 3 has 0 clips. On 2026-09-30 her taps were each followed by `clip_save_attempted`.
- So each tap died between `recordAchievement` and the save handler. Server logs had rolled off
  (Fly keeps ~100 lines), and the client logs died with the page.
- Ruled out: expired source, plays-only, missing duration/dims on the game row. Nothing in the
  Mark play chain is share-aware: a materialized share is an ordinary game row.
- Not reproduced: prod, impersonated as her, Chromium with Pixel 7 emulation, writes intercepted.
  Mark play opened the editor and sent a valid `raw/save` on first open AND after leave + reopen.

The real defect is that this whole path can fail **with zero trace**: no UI, no log the user
can send us, nothing on the server. We could not tell which of the candidate failures hit her.

## Solution

User direction (2026-11-01): the answer is not "catch errors and toast". First make each failure
**impossible** where it can be; for what remains, log heavily to the console, and show a toast that
asks the user to file a problem report. That report must carry every relevant log line.

### 1. Make the silent failures impossible (fix the source, not the symptom)

Each remaining candidate failure point after `recordAchievement` in the Mark play chain
(the `useAnnotate` duration desync is already fixed, see Progress Log)
(`AnnotateModeView.handleAddClipWithSportPrompt` -> `AnnotateContainer.handleAddClipFromButton` ->
`handleFullscreenCreateClip` -> `useAnnotate.addClipRegion` -> write queue `__create` ->
`useRawClipSave.saveClip`):

- **`requireAuth(async ...)` is not awaited and the handler has `try/finally` with no catch**
  (`authStore.js:70`, `AnnotateContainer.jsx:1918-1945`): any throw becomes an unhandled rejection
  with no UI. Find what can throw and make it impossible. The rejection itself must still be
  logged with context (step 2), never swallowed.
- **A non-finite playhead** (`effectiveCurrentTime` NaN on a mobile video element) serializes as
  `null` -> pydantic 422 BEFORE the handler (matches "no `clip_save_attempted`"). Establish where
  the playhead comes from and guarantee a finite number at the source. Do not clamp it to 0 at the
  call site.
- **`saveClip` swallows every non-OK response except 503 `sync_failed` and 404**
  (`useRawClipSave.js:178-206`: throw -> console.error -> return null, no UI). A 400/409/422/5xx
  on a create means our client sent something the server refuses, or the server broke. Both are
  bugs to surface (step 2).

### 2. What remains: heavy logging + "please report this" toast

- Every early return / failure in the Mark play chain logs ONE `console.error` line with full
  context: tag `[MarkPlay]`, step name, game id, playhead, the duration source values, selection
  state, region count, response status + body for HTTP failures, and `navigator.userAgent`.
- The toast says the play was not saved and asks the user to report the problem, with an action
  that OPENS the existing Report a problem form (`components/ReportProblemButton.jsx`). Today the
  form opens only from its own button, so it needs a programmatic open (store flag or event).
  Respect `ENABLE_PROBLEM_REPORT`. Dedup the toast per gesture.

### 3. The problem report must carry all the logs

`utils/clientLogger.js` (the ring buffer the report sends) has gaps that would have lost this exact bug:
- It captures `console.error/warn/info` only. **`console.log` is not captured**, and the Mark play
  path's diagnostics (`[CreateClip] ...`, `[useAnnotate] Auto-initializing ...`) are console.log.
  Capture `console.log` too (and debug if cheap), or move these diagnostics to captured levels.
  Decide with the size cap in mind.
- `MAX_ENTRIES = 200`: routine `[VIDEO] Suspend` / `[SLOW FETCH]` warnings fill it fast on a long
  game, so the lines that matter get evicted. Size it for a real session (or byte-cap it), and make
  sure errors are never evicted by routine noise (e.g. a separate errors ring).
- Uncaught errors / unhandled rejections are already captured (T7560). Keep that.
- Verify end to end: the report row on the server (`/api/admin/bugs/{id}`) contains the
  `[MarkPlay]` error line and the preceding console.log context.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/AnnotateContainer.jsx` - `handleAddClipFromButton` (~L1906), `handleFullscreenCreateClip` (~L1762), `effectiveCurrentTime` (L473)
- `src/frontend/src/hooks/useRawClipSave.js` - `saveClip` error handling (L178-206)
- `src/frontend/src/stores/authStore.js` - `requireAuth` (L68)
- `src/frontend/src/utils/clientLogger.js` - ring buffer levels + cap
- `src/frontend/src/components/ReportProblemButton.jsx` - needs a programmatic open
- `src/frontend/src/modes/AnnotateModeView.jsx` - `handleAddClipWithSportPrompt` (L481)

### Knowledge Docs
- `.claude/knowledge/annotate.md` (Mark play create-at-tap D2, `markPlayInFlightRef`, T11040)

### Related Tasks
- T4060 (same duration-desync class; fully fixed by this task's shipped part), T11040 (in-flight guard latch), T7560 (uncaught errors into the ring buffer)

### Technical Notes
- Repro harness used for the investigation: Playwright with Pixel 7 emulation against prod as an
  impersonated user, with every non-GET API request intercepted (fulfilled 418) so nothing was
  written. Worth reusing on staging for live verification.
- Do NOT add a generic fallback (e.g. `duration ?? Infinity`, `t || 0`). Remove the possibility.

## Implementation

### Steps
1. [x] Audit the rest of the chain for throws / non-finite playhead and make them impossible at the source
2. [x] `[MarkPlay]` console.error context logging at every remaining failure exit, including saveClip non-OK responses
3. [x] Toast with "Report a problem" action that opens the report form
4. [x] clientLogger: capture console.log, resize/split the buffer so errors survive noise
5. [x] Live-verify on a phone viewport + confirm a report row carries the logs (staging after PR #699: `e2e/T14370-mark-play-during-load.spec.js` passes; a forced-422 run opened Report a problem from the toast and filed staging bug row #25 whose logs hold `[CreateClip]` context before `[MarkPlay] saveClip {status, body, payload}`; the row is an automated test artifact, safe to ignore)

### Progress Log

**2026-11-01**: Filed from the prod investigation (evidence in Problem). Root cause on her device
not proven; the fix targets every silent exit in the chain plus the report pipeline that would
have captured it.

**2026-11-02**: Duration desync fixed and shipped (`ca9d67242`): `useAnnotate` derives duration
from `videoMetadata`, regression test `useAnnotate.markPlayDuration.test.jsx`. Remaining work is
the steps above.

**2026-11-02 (later) - ROOT CAUSE reproduced on staging** (Playwright, Pixel 7 emulation,
e2e@test.local, zero-play game 6 "varC", build 665aea327 which includes `ca9d67242`):
- A: first open, tap after the game loaded: `raw/save` 200, editor opens. Passed 3x.
- B: `/load` held back 6s, tap while in flight with the video element already loaded: a play
  with NO game id ("Could not save this play" toast), then a WHITE-SCREEN crash when `/load`
  landed (`Cannot read properties of null (reading 'rating')`: `applyGameData` reset the
  regions under the open editor; EDITING is immune to deselect, so `existingClip` went null).
- C: Home, reopen the same game, tap 3s after the card appeared (`/load` took 5.6s): the exact
  user symptom. `add_clip_opened` sent, `[useAnnotate] Cannot add clip region - no duration
  set`, no `raw/save`, nothing on screen. Reproduced twice; passes when the tap waits for `/load`.
So the window is "Mark play is live before `/load` lands", easy to hit on a phone with an 87 min
shared game. `ca9d67242` fixed a different way to lose the duration and stays valid.

Fix (this branch): `AnnotateContainer.isGameDataLoading` gates Mark play (card disabled in
`AnnotateModeView` via `isLoadingGameData`; `handleAddClipFromButton` refuses loudly before the
quest records the tap); `applyGameData`/`clearAnnotateState` reset the selection machine with
the regions; `utils/markPlayFailure.reportMarkPlayFailure` is the single exit for every failure
(`[MarkPlay] <step>` console.error with context + UA, toast with a Report a problem action
through `stores/problemReportStore`); `saveClip` surfaces every non-OK create except the
503/404 cases that have their own UX; `clientLogger` captures console.log and keeps a separate
error ring (backend `format_log_text` slice raised to 400 to match). The T5350 test that
asserted "a 500 shows no toast" now asserts "not the sync_failed toast, but the not-saved one".
Tests (red-to-green): `AnnotateContainer.markPlayDuringLoad.test.jsx` (4),
`AnnotateModeView.markPlayLoading.test.jsx` (2), `useRawClipSave.createFailure.test.js` (1),
`clientLogger.test.js` (3), `ReportProblemButton.programmaticOpen.test.jsx` (1).

Follow-up after review + proof verification (same day): `saveClip` takes `{ step, toast }` so the
load-time backfill and the bulk import (not Mark play gestures; the import has its own
IMPORT_FAILED toast) log the `[MarkPlay]` line without the not-saved toast (reviewer MAJOR).
Criterion 3 is now proven end to end: `ReportProblemButton.logsInReport.test.jsx` drives the
REAL clientLogger through Send and asserts the POST body holds the `[CreateClip]` context line
before the `[MarkPlay]` error after 400 routine warnings (red against the base clientLogger:
200 entries, no `log` entry); backend `tests/test_t14370_format_log_text.py` asserts the
formatter keeps entry 0 of 400 (red against the base 200 slice). Design note: the routine ring
is shared by log/info/warn, so context lines compete with routine noise; the chain logs its
context in the same tick as the failure, which is what the test models.

Staging live check after the deploy of `9fe995583` (Pixel 7, e2e@test.local, game 6): the committed
spec PASSES (card disabled while `/load` is delayed 6s, then `raw/save` 200, editor opens, no page
errors). Report path (scratch spec, `raw/save` forced to 422): the not-saved toast shows, its
action opens Report a problem, Send POSTs a report whose logs carry `[MarkPlay] saveClip
{status:422, body, payload}`; BUT the body had no `log`-level entries at all: **production
builds drop `console.log`** (`vite.config` `esbuild.pure`), so capturing it never helps a prod
report. Follow-up: the chain's `[CreateClip]` lines are `console.info` (pinned in
`markPlayDuringLoad.test.jsx`, red against the console.log version), landmine recorded in
`annotate.md` and `clientLogger.js`.

Landed: PR #697 merged as `9fe995583` (reviewer APPROVE, proof verifier VERIFIED, Branch CI green
on the exact head `c5393eb59`). Staging auto-deploys; step 5 (live verify on staging with
`e2e/T14370-mark-play-during-load.spec.js`, then a hand-filed report) follows the deploy.

## Acceptance Criteria

- [x] No exit from the Mark play chain is silent: each logs a `[MarkPlay]` console.error with context and shows a toast whose action opens Report a problem
- [x] A non-OK `raw/save` create response (e.g. 422) produces that log + toast (unit + staging bug row #25)
- [x] The submitted problem report includes the `[MarkPlay]` line AND prior context (console.info, since prod builds drop console.log), and errors survive a full buffer of routine warnings
- [x] Relevant frontend tests pass; explicit lint clean (Branch CI green on both PRs)
