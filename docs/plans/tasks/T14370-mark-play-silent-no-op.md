# T14370: Mark play silently does nothing (prod, Android, shared game)

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-01
**Updated:** 2026-11-01

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

Each candidate failure point after `recordAchievement` in the Mark play chain
(`AnnotateModeView.handleAddClipWithSportPrompt` -> `AnnotateContainer.handleAddClipFromButton` ->
`handleFullscreenCreateClip` -> `useAnnotate.addClipRegion` -> write queue `__create` ->
`useRawClipSave.saveClip`):

- **`addClipRegion` returns null when `useAnnotate`'s `duration` state is null**
  (`useAnnotate.js:407`, console.warn only; caller returns at `AnnotateContainer.jsx:1804`).
  `duration` is a SECOND copy of `annotateVideoMetadata.duration`, synced by an effect keyed on
  `videoMetadata?.duration` and nulled by `reset()`. When reset runs and the metadata duration
  value does not change, the effect does not re-fire. The same bug class was patched once already
  (T4060, comment at `useAnnotate.js:723`, only for games WITH annotations via `importAnnotations`'
  override; a zero-play game never takes that path). Fix: remove the redundant state and derive
  duration from the metadata passed in, so it cannot desync (coding-standards: no redundant state).
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
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` - `duration` state (L283), sync effect (L297), `reset` (L355), `addClipRegion` (L406)
- `src/frontend/src/hooks/useRawClipSave.js` - `saveClip` error handling (L178-206)
- `src/frontend/src/stores/authStore.js` - `requireAuth` (L68)
- `src/frontend/src/utils/clientLogger.js` - ring buffer levels + cap
- `src/frontend/src/components/ReportProblemButton.jsx` - needs a programmatic open
- `src/frontend/src/modes/AnnotateModeView.jsx` - `handleAddClipWithSportPrompt` (L481)

### Knowledge Docs
- `.claude/knowledge/annotate.md` (Mark play create-at-tap D2, `markPlayInFlightRef`, T11040)

### Related Tasks
- T4060 (same duration-desync class, partial fix), T11040 (in-flight guard latch), T7560 (uncaught errors into the ring buffer)

### Technical Notes
- Repro harness used for the investigation: Playwright with Pixel 7 emulation against prod as an
  impersonated user, with every non-GET API request intercepted (fulfilled 418) so nothing was
  written. Worth reusing on staging for live verification.
- Do NOT add a generic fallback (e.g. `duration ?? Infinity`, `t || 0`). Remove the possibility.

## Implementation

### Steps
1. [ ] Failing tests: duration desync (reset with unchanged metadata duration, zero-play game) -> Mark play creates nothing
2. [ ] Derive `useAnnotate` duration from metadata (drop the redundant state)
3. [ ] Audit the rest of the chain for throws / non-finite playhead and make them impossible at the source
4. [ ] `[MarkPlay]` console.error context logging at every remaining failure exit, including saveClip non-OK responses
5. [ ] Toast with "Report a problem" action that opens the report form
6. [ ] clientLogger: capture console.log, resize/split the buffer so errors survive noise
7. [ ] Live-verify on a phone viewport + confirm a report row carries the logs

### Progress Log

**2026-11-01**: Filed from the prod investigation (evidence in Problem). Root cause on her device
not proven; the fix targets every silent exit in the chain plus the report pipeline that would
have captured it.

## Acceptance Criteria

- [ ] Reset + unchanged metadata duration can no longer leave Mark play dead (regression test red before, green after)
- [ ] No exit from the Mark play chain is silent: each logs a `[MarkPlay]` console.error with context and shows a toast whose action opens Report a problem
- [ ] A non-OK `raw/save` create response (e.g. 422) produces that log + toast
- [ ] The submitted problem report includes the `[MarkPlay]` line AND prior console.log context, and errors survive a full buffer of routine warnings
- [ ] Relevant frontend tests pass; explicit lint clean
