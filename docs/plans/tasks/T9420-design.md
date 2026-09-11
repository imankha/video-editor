# T9420 + T9430 design note (NARROW) - upload fails at ~15%, then succeeds on retry; honest upload-state UI

Scope note: this is the narrow technical note the kickoff calls for, not a from-scratch design.
No new schema, no new persistence pattern - it reuses the EXISTING idempotency + CAS/durable_sync
machinery. Therefore no user approval gate (per kickoff: "do not stop for user approval unless a
genuinely new schema/pattern is needed").

## Diagnosis (established by code-expert, not guessed)

The progress bar (`uploadStore.progressToPercent`) maps HASHING 0-15, PREPARING = exactly 15,
UPLOADING 15-98, FINALIZING 98, COMPLETE 100. A bar frozen at "~15%" is precisely the
PREPARING -> first-UPLOADING boundary.

The literal string "Failed to fetch" is Chromium's message for a REJECTED `fetch()` promise (a
request that never received an HTTP response). It therefore CANNOT originate from the R2 part
uploads: those use XMLHttpRequest (`uploadManager.uploadPart`) and emit our own strings
("Part N network error", "Part N upload failed: <status>") AND retry 3x with backoff. It can only
come from an `apiFetch`/`fetch` call. Cross-referenced with the 15% localization, the failing leg is:

1. (strongest) `POST /api/games/prepare-upload` - the call whose success moves the bar to exactly 15.
2. `POST /api/games` (createGame) - fires just before 15.

Mechanism: a transient connection-level reject (DNS/reset/Fly edge hiccup/cold-start reroute), not a
backend fault and not CORS (an R2 CORS failure would be an XHR error, not "Failed to fetch"; there is
no R2 bucket CORS config in this repo). It "succeeds on retry" because both legs are idempotent.

NOT a survivor of the upload-integrity family:
- T8150 (durable_sync on activate_game) is a POST-activation durability fix; a ~15% failure is
  PRE-activation (activate never ran, no charge yet).
- T8160 (R2 UploadId instability) manifests as every part PUT 404'ing - an XHR "Part N ... 404",
  deterministic, not "succeeds on retry" - and the keeper post-check already guards it.

Observability gap that explains "no server evidence for the incident": `sendUploadFailureBeacon`
only fires inside the `!res.ok` branch, so a pre-response `fetch()` reject throws BEFORE any beacon.

## Retry-idempotency proof (reusing existing mechanism - one game, one charge, one R2 object)

- ONE GAME: `create_game` (games.py) reuses an existing `pending`/`upload_failed` game with the same
  `blake3_hash` instead of creating a duplicate. A retry re-hashes the same file -> same `game_id`.
- ONE CHARGE: the credit debit exists ONLY in `activate_game` (games.py:~1186),
  `source="game_upload", reference_id=str(game_id)`; `deduct_credits` is idempotent via
  `ON CONFLICT (user_id, idempotency_key) DO NOTHING` with key `game_upload:{game_id}`. A ~15%
  failure is upstream of activate, so the failed attempt charges nothing; retry charges exactly once.
- ONE R2 OBJECT: global dedup by `games/{hash}.mp4`; `prepare_upload` HEAD-checks EXISTS and resumes a
  valid pending multipart.

Conclusion: the existing machinery ALREADY covers idempotency cleanly. No backend change, no expert
escalation, no migration. Backend work in T9420 is characterization/regression TESTS that pin this
guarantee, not new logic.

## The fix (T9420) - client-side resilience + observability, where the actual cause lives

`src/frontend/src/services/uploadManager.js`:
1. Wrap the two idempotent front-half API legs (`createGame` POST /api/games and the
   `prepare-upload` POST) in a small retry-with-backoff that retries ONLY on a thrown network reject
   (fetch rejected / TypeError "Failed to fetch") - NOT on an HTTP error response (those keep their
   existing explicit handling). Safe because both legs are idempotent (proved above). This converts
   the reported "fails at 15%, succeeds on manual retry" into silent auto-recovery.
2. Close the beacon gap: on a thrown network reject for either leg, fire
   `sendUploadFailureBeacon({phase, reason:'fetch_rejected'})` before the final surface, so the next
   incident leaves server-side evidence.
3. "Saved only after server ack" is ALREADY correct - COMPLETE (bar 100) fires only after
   `activate_game` returns (durable_sync, T8150). Keep and assert it.

## The UI (T9430) - honest four-state surfacing next to the local preview

Reuses the existing phase machine (no new state store). Mapping helper (pure, unit-tested):
- Preparing  <- HASHING | PREPARING
- Uploading  <- UPLOADING | FINALIZING
- Saved      <- COMPLETE (server ack; the success toast + the real GameTile appearing ARE the Saved
                signal, driven by the upload gesture's own promise resolution in
                `uploadStore.onEntryComplete` - NEVER a useEffect watching state)
- Upload failed <- ERROR (entry retained with file+metadata in `retryContext`; Retry already wired)

Copy constants go in `src/frontend/src/config/displayNames.js` (single source, T8555/T8380 precedent):
`UPLOAD_STATE` = { PREPARING, UPLOADING, SAVED, FAILED, LOCAL_PREVIEW_NOTICE
("Local preview - not saved online yet"), RETRY_UPLOAD ("Retry upload"),
CHOOSE_ANOTHER ("Choose another file") }.

Surfaces:
- AnnotateScreen: an honest status banner above the preview (annotate-during-upload) for the current
  game - "Local preview - not saved online yet" while preparing/uploading; "Upload failed" with
  Retry + Choose another file on error. This is the exact surface the bug names (video playing while
  told it did not upload). Reads store state; writes nothing.
- UploadProgressIndicator: relabel the active/failed rows to the four explicit states via the helper,
  keep Retry, add a "Choose another file" escape on failure.
- Duplicate submission block: `uploadStore.startUpload` already rejects a same-file re-drop by
  `fileKey` (visible toast) and `GameDetailsModal` already disables submit while `isSubmitting`. Keep;
  add a test pinning it.

N37 vocabulary ("Preparing video / Uploading / Rendering") is owned by T9540 - this task keeps its
own labels independent of that rename (per both task files).

## Risks
- Auto-retry must fire ONLY on a network reject, never on an HTTP error body (avoid retrying a real
  4xx/5xx). Bounded (<=2 retries, short backoff) so a genuinely-down backend still surfaces failure.
- No reactive persistence: the banner and indicator READ store state; "Saved" is the gesture promise
  resolving. eslint `local/no-persistence-in-effects` must stay at 0 hits.
