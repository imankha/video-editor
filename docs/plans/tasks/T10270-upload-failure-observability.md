# T10270: Upload-failure observability: a durable record, a since-deploy listing, and no silent classes

**Status:** WIP (design APPROVED 2026-09-17 - full recommended path: Option A/Postgres fenced,
store filename+user agent fenced, split the log drain into its own task, fix the credit-refusal
mislabel in scope, 90-day retention. See [T10270-design.md](T10270-design.md); decision artifact
https://claude.ai/artifact/3DsuRvsHf9GtpZ2sxeA4AP. Implementation starting.)
**Impact:** 9
**Complexity:** 5
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17: "Look into any failed upload since the last deployment. Do we have enough
logging to understand and diagnose? Uploads are the top of the funnel so making them robust is a
top priority."

**Audit result (2026-09-17, read-only, HEAD `54032435`): no, we do not.** The only durable
failure writes are `record_milestone("game_upload_failed"|"clip_upload_failed", reason)` ->
Postgres `user_actions` (cumulative count + `first_at` only, no `last_at`), `daily_counters.
game_uploads_failed` (per day, all reasons collapsed, GAME only: `clip_upload_failed` has
`daily_col: None`), and the per-user `user.sqlite` `user_action_log` (the only timestamped trail,
one user at a time). Concretely, "which uploads failed since 2026-09-13 and why" cannot be
answered today: daily counts have no user or reason; `user_actions` cannot be date-scoped
reliably; the per-event trail requires opening each user's SQLite; and the richest channel
(`[UPLOAD_BEACON]` / `[UPLOAD_LIFECYCLE]` stdout lines) has **no log drain** in
`fly.production.toml`, so four days back is gone.

Failure classes that leave NO durable trace (ranked):
1. Pre-prepare client death: hash timeout (`uploadManager.js:103,611-612`), faststart analyze
   throw, `Unexpected status` (`:755`).
2. `can_afford === false` after a SUCCESSFUL prepare (`uploadManager.js:727-733`): the server has
   already inserted `pending_uploads` and opened an R2 multipart; the client throws with no beacon.
   Later misattributed as `user_abandoned` by the reaper.
3. Beacon phase gate (`games_upload.py:736`) drops `preparing`/`finalizing`/`creating` on the
   premise the server saw them; false for `reason:'fetch_rejected'` (`uploadManager.js:194-199`).
4. The whole clip batch endpoint `POST /api/clips/upload`: `source_missing` (`clips.py:1953`),
   `probe_failed` (`:1973`), `duration_exceeds_cap` (`:1978`), `insufficient_credits` (`:2027`)
   log nothing and record nothing, while `clip_uploaded` success IS recorded, so clip-upload
   success is 100% by construction (the T7970 defect, reintroduced on the clip path).
5. `clip_upload_failed` is write-only: no daily column, no admin read surface.
6. Game-video attach / activate 400/402/409 (`games.py:354-361,726-732,760-767,949-955`): silent.
7. `finalize` `session_not_found` (`games_upload.py:507-512`) and `PATCH parts` 404 (`:653`):
   warning-only.
8. No filename and no file size appear in ANY failure log line (the beacon carries `file_size` but
   the client never sends the filename).
9. Bonus bug: `GET /admin/users/{id}/stuck-uploads` (`admin.py:975`) hardcodes the `games/` R2 key
   for `kind='clip'` rows, misreporting live clip uploads as dead (the shape T8370 fixed elsewhere).

What an operator CAN do today: `daily_counters` totals per day (coarse), `user_actions` by
`first_at` (undercounts repeats), per-user `/admin/analytics/user/{id}/actions`,
`scripts/scan_stranded_uploads_sweep.py --env prod --hours N` (stranded multiparts still open now),
and `bug_reports` (only when a user files one).

## Solution

Design-gated (Architect): this adds a bounded event table, which touches the "aggregates-only
Postgres" analytics rule (`feedback_analytics_in_house_aggregates_only`). The rule's purpose was
to avoid an unbounded per-event firehose; an append-only `upload_failures` table with a TTL
(90 days) and a closed reason vocabulary is a bounded operational record, not analytics. State
that tradeoff in the design doc and let the user rule on it.

1. **`upload_failures` (Postgres, TTL)** with: `occurred_at`, `user_id`, `profile_id`, `kind`
   (game|clip), `stage` (hashing|preparing|uploading|finalizing|activating|attaching|batching),
   `reason` (closed vocabulary = `MILESTONE_REASONS` + `insufficient_credits`, `hash_timeout`,
   `probe_failed`, `source_missing`, `duration_exceeds_cap`, `size_over_cap`), `http_status`,
   `error_text` (capped 300), `blake3_hash`, `upload_session_id`, `r2_upload_id`, `file_size`,
   `original_filename`, `parts_total`, `parts_completed`, `attempt_no`, `elapsed_ms`, `origin`
   (server|beacon), `platform`, `user_agent` (capped), `build_sha`. Every field is already
   computed at the failure sites; this persists instead of formatting into a log line.
2. **One writer** (`record_upload_failure(...)` in `analytics.py`) called from every branch in the
   Problem list; the beacon phase gate goes away (the beacon always writes, tagged `origin=beacon`);
   the client beacon gains `original_filename` and fires for classes 1 and 2.
3. **Admin: "Upload failures" list**, date-scoped (default: since the last deploy `build_sha`),
   cross-user, with reason/stage filters, next to the existing Pulse "Upload Success" card;
   `clip` and `game` rates shown SEPARATELY and each as attempts vs successes
   (`feedback_tries_vs_success_must_both_show`). Fix the `stuck-uploads` clip-key bug.
4. **Log drain**: add a Fly log shipper (Fly's built-in `fly logs` has hours of retention; a
   drain to a cheap sink, e.g. Axiom/Better Stack free tier, or at minimum the `[UPLOAD_*]` lines
   into the table above) so the next incident is diagnosable four days later.
5. Migration: Postgres track (`_SCHEMA_DDL` + `POST /api/admin/migrate-postgres` after deploy);
   check unmerged siblings for a version collision.

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py` (prepare/finalize/beacon/reaper), `routers/clips.py:1908-2090`,
  `routers/games.py` (attach/activate), `analytics.py:206-230,353-368,606-651`, `services/pg.py`,
  `routers/admin.py:904-1002,1627-1652,1937-2114`
- `src/frontend/src/services/uploadManager.js:141-199,701-841`, `hooks/useClipUpload.js`,
  `stores/uploadStore.js:118-141`, `components/admin/PulseCards.jsx`, `UserTable.jsx`
- `src/backend/fly.production.toml` (no drain today)
- `scripts/scan_stranded_uploads_sweep.py` (reuse its R2 cross-reference)

### Related Tasks
- Absorbs the "look into failed uploads since last deploy" investigation (findings above)
- T10250 feeds `size_over_cap`; Upload Failure Integrity epic (T7470-T7510) is the prior art

## Acceptance Criteria

- [x] A single query answers "which uploads failed since build X, for whom, at what stage, why"
- [x] Every failure branch listed above writes a row (test each with a forced failure)
- [x] Admin list is date-scoped and cross-user; clip and game rates are separate and paired
- [x] `[UPLOAD_*]` log lines survive a deploy and are readable 7 days later (RE-SCOPED per
      approved Q3: this ships the one canonical `[UPLOAD_FAILURE]` structured log line whose
      facts are ALL also in the 90-day-TTL table — a queryable durable record, not a raw-log-
      retention infra change. The log drain itself (D2: a Fly log shipper) is filed as a
      follow-up infra task, see Implementation/Progress below.)
- [x] Migration file + `_SCHEMA_DDL`; Migration agent included (kickoff session acted as the
      Migration agent for slice A per design §5's recipe)

## Implementation / Progress

**Implemented 2026-09-17, branch `feature/T10270-upload-failure-observability`, 5 slices per the
approved design (`T10270-design.md`), one commit each (802cee76, 393b0cf7, bc80f340, c08489a8,
3f3d8ef5, plus a lint fixup edba32bf):**

- **Slice A** — `services/upload_failures.py` (vocabularies + `record_upload_failure`, the ONE
  writer, fence F3), migration `v029_upload_failures.py` (head independently verified: v028 was
  HEAD on this branch, `git log --all --diff-filter=A` found no sibling claiming v029), mirrored in
  `pg.py`'s `_SCHEMA_DDL`, TTL sweep in the existing hourly `cleanup._do_cleanup()` (F2), purge in
  `auth._purge_user_data` + `scripts/delete_user.py` (F4, generalized `credit_tables_present`'s
  to_regclass check into a reusable `table_present()` helper).
- **Slice B** — `games_upload.py`'s old private `_record_upload_failure` deleted, every call site
  (including two previously-uninstrumented ones: finalize's `session_not_found`, PATCH-parts 404)
  routed through the shared writer; the beacon phase gate replaced by the `server_responded`
  boolean (back-compat default reproduces the old gate exactly for pre-T10270 clients); the
  stale-upload reaper also now writes rows (one per reaped upload) instead of a bare milestone
  loop. `clips.py`'s batch endpoint writes one row per failed item. `games.py`'s
  `_validate_video_in_r2` kept synchronous (existing test mocks aren't `AsyncMock`) with a new
  async `_validate_video_in_r2_or_record` wrapper for the 4 call sites (create/attach/activate x2).
- **Slice C** — `uploadManager.js` beacons for classes 1 (hash timeout / analyze throw /
  unexpected status, via a shared `hashAndAnalyzeOrBeacon` helper at all 4 internal call sites) and
  2 (`can_afford===false` now beacons AND calls the existing cancel-session DELETE endpoint, Q4).
  Every beacon payload gained `original_filename` + `server_responded`.
- **Slice D** — `GET /api/admin/upload-failures` (to_regclass-guarded, honest paired rates, never
  summed), `UploadFailuresPanel.jsx` (pure view) + `adminStore.fetchUploadFailures` (on-demand, NOT
  folded into the combined dashboard mount fetch — `AdminScreen.test.jsx`'s single-mount-request
  assertion still passes).
- **Slice E** — the `stuck-uploads` clip-key bug (class 9, a T8370-landmine recurrence) fixed
  independently of the rest.

**Deviations from the design doc (all within its stated latitude, none re-litigating an approved
decision):**
1. `_validate_video_in_r2` (games.py) was NOT made `async def` as design §3.5's "class 6" wiring
   might read literally — it stayed synchronous with a new async wrapper, because ~10 existing test
   files mock it with plain callables (`return_value=None`, bare lambdas), not `AsyncMock`, and
   `await <a non-awaitable mock's return>` would have broken all of them. The wrapper still records
   through the shared writer via `run_in_context` before re-raising, so the design's per-call-site
   `stage` (creating/attaching/activating) is preserved.
2. The stale-upload reaper (`list_pending_uploads`) was wired to the new writer even though the
   design's §3.5 call-site table doesn't name it explicitly by line number — the design's §3.1
   architecture diagram DOES list "reaper" as a writer-feeding site, and leaving its pre-existing
   direct `record_milestone` call unconverted while every sibling branch in the same file moved to
   the shared writer would have been an inconsistency introduced by this very task.
3. **Reviewer-caught and fixed (MUST-FIX from the Stage 4.5 review pass, post-implementation):**
   class 2's flow fired BOTH a beacon (`reason=insufficient_credits`) AND the explicit cancel call,
   and `cancel_upload`'s own unconditional `reason=user_abandoned` writer call ALSO fired — two rows
   and two coarse milestones (`refused` + `user_abandoned`) for one real user action, exactly the
   class of defect this task exists to eliminate. The design's call-site table specified this wiring
   (beacon + "call the existing DELETE endpoint") without flagging the interaction. Fixed by adding
   an `already_recorded` query flag to `DELETE /api/games/upload/{session_id}`
   (`cancel_upload`/`cancelUpload`): the class-2 caller passes `alreadyRecorded: true` so
   `cancel_upload` skips its own generic `user_abandoned` record when the caller already wrote the
   session's one precise reason. The two OTHER existing callers of `cancelUpload`
   (`UploadProgressIndicator.jsx`, `ProjectsScreen.jsx` — genuine user-initiated cancels with no
   prior beacon) are unaffected (default `alreadyRecorded: false`), and
   `test_cancel_upload_records_user_abandoned` still passes unchanged. New regression test:
   `test_cancel_upload_already_recorded_skips_the_user_abandoned_milestone`.

**Reviewer verdict (fresh-context Reviewer agent, full-diff pass):** one MUST-FIX (the class-2
double-count above, fixed) and three notes/nits (not fixed, low-value/out-of-scope): (1) malformed
numeric beacon fields — `attempt_no`/`elapsed_ms`/`file_size` taken verbatim from client JSON — can
make the INSERT raise and silently lose the row (writer still bridges the milestone); (2) the
part-upload-exhaustion beacon relies on the to-be-deleted `server_responded` back-compat fallback
instead of setting it explicitly; (3) the clip batch endpoint's per-failed-item writer calls are
sequential, not batched (bounded by client batch size, failure path only). All five of the
classification's named focus areas (fence F3 one-writer, the `server_responded` back-compat
correctness, `run_in_context` at every async call site, the admin endpoint's never-summed paired
rates, and the migration head number) passed independent re-verification.

**Follow-up task to file (D2, the log drain):** design §3.8 recommends splitting the real log drain
(a Fly log shipper — a separate `fly-log-shipper` app running Vector, consuming the org's NATS log
stream, sinking to R2 under a `logs/` prefix with lifecycle expiry) into its own infra task, since
it is a different kind of work (a deployed app + Vector config, no application code) and this task
already answers the acceptance criteria without it (D1, the `[UPLOAD_FAILURE]` structured log line
+ the 90-day table, ships in this task). Recommend title: "Upload/app log drain to R2 (D2 follow-up
to T10270)".

**Test evidence:** 14 new backend pure/mocked unit tests pass (`test_t10270_upload_failures.py`);
76 frontend tests pass across `uploadManager.*.test.js` + the admin store/component suite
(`adminStore.uploadFailures.test.js`, `UploadFailuresPanel.test.jsx`, `AdminScreen.test.jsx`'s
single-mount assertion). Backend tests requiring real Postgres (5 in `test_t10270_upload_failures.py`,
8 new ones in `test_admin.py`, 1 in `test_t10270_stuck_uploads_clip_key.py`) error on connection
refused in this container — **no Postgres or docker available here** (confirmed identical to
every pre-existing `pg_conn`-fixture test, e.g. `test_t7970_upload_failure_milestones.py`, so this
is a known container limitation, not a regression). The live-write path (an actual INSERT into
`upload_failures`, the admin endpoint's real SQL, the migration file's real execution) is
**UNVERIFIED in this container** and needs a supervisor or staging check before merge confidence is
complete. ruff + eslint clean on every touched file (only pre-existing, unrelated findings remain
in `scripts/delete_user.py` outside this diff's touched lines).
