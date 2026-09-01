---
domain: persistence-sync
updated: 2026-09-01 (T8190 + T5087: T8190 fixed the JIT seam's same-thread reentrancy deadlock
(a migration reaching `get_db_connection` from its own `up()` self-deadlocked the whole API
process, no timeout) with a same-thread pass-through + `SEAM_LOCK_TIMEOUT_S` acquire-with-timeout,
and fixed the two offending migrations (v017/v047) at the source. With JIT fully proven, T5087
then deleted the bulk sweep entirely (`run_all_migrations`/`_migrate_user`/`_migrate_user_db`/
`_migrate_profile_db`) -- the JIT seam is now the ONLY migration mechanism for `user_db`/
`profile_db`, with no backstop. See the "T5083" section below for the updated invariant and the
INV-P site-count correction (5 sites -> 4, the bulk primitive's own swap site is gone).)
updated: 2026-08-31 (T5085: **the JIT seam (T5083) now covers every non-login opener of a
profile.sqlite/user.sqlite, not just `ensure_database`/`ensure_user_database`.** A code-expert
audit + an Expert (Opus) validation pass found the seam living inside those two functions meant
every OTHER opener of a DB (share materialization, admin cross-user reads, cross-profile reel
moves, credit-reservation recovery, admin bulk backfills) bypassed it entirely — the exact hole
T5083's own frontmatter entry above flagged as future work. Two real bugs fixed, not just gaps
filled: (1) `materialization.ensure_profile_db_local`/`_open_profile_db` (the two raw non-login
openers underlying five call sites) never migrated at all — now both call the seam, extracted
into `migrations.run_profile_seam`/`run_user_seam` (verbatim body of the two `ensure_*` seam
blocks, which now just call these) so there is ONE seam implementation, not three. (2)
`user_db.ensure_user_database_fresh` ran the seam, then did its OWN restore-if-newer swap AFTER
it — a rolling-deploy peer machine's sync-newer/schema-older bytes could silently reintroduce a
below-head file with `_seam_verified` already set, permanently defeating the seam for that user in
that process. Fixed by re-running the seam (after clearing `_seam_verified` for that scope) any
time that swap actually downloads. **Structural fix for the bug CLASS, not just the two instances:**
`storage.sync_database_from_r2_if_newer`/`sync_user_db_from_r2_if_newer` — the low-level primitive
EVERY download-and-swap in the codebase goes through — now clears `_seam_verified` for the swapped
scope on every successful download, so a FUTURE caller that swaps a DB in place can't silently
reintroduce this same hazard without its own explicit fix (belt-and-suspenders: the two real fixes
above are still required for their own callers to actually re-enter the seam, but a missed future
caller now degrades to "re-verify once" instead of "silently below head forever"). `MigrationBlocked`
now needs handling at every non-login call site that can reach it: three previously-unguarded bulk
loops (`sweep_scheduler.do_sweep`, `poster.backfill_posters`, `auto_export.backfill_hiq_recaps`)
now catch it per-profile so one blocked profile can't abort an entire admin bulk pass; five
`analytics.py` writers (webhook/background-task/admin-read contexts with a documented "never
raises" contract) now log a CRITICAL `ANALYTICS_WRITE_DROPPED`/`ANALYTICS_READ_BLOCKED` marker
instead of silently swallowing it in a generic warning (EPIC decision 6 — no silent fallback);
`credit_ledger._has_live_export_job` catches it and stays on the conservative "treat as live" side
of its money-path contract. `poster.backfill_posters` was also re-pointed off the bulk-runner
primitive `_migrate_profile_db` (T5087 deletes it) onto `migrate_local_profile_db_at_seam` — kept,
not deleted, because the seam only runs under `R2_ENABLED` and `_migrate_profile_db` is still what
migrates a below-head profile in local/no-R2 dev mode. The ~40 `column_exists`/`_has_stage_columns`
request-path guards (T5630 pattern) are KEPT, re-justified as permanent rolling-deploy-skew defence
in depth (EPIC decision 8) rather than the now-closed "deploy->migrate window" — one shared
docstring rewrite (`database.py` `column_exists`) rather than touching all 40 sites. Full audit +
policy table: T5085 task file. Tests: see T5085 task file's test list.)
updated: 2026-08-31 (T5083 CI-escalation fix, same day as the section below: Branch CI caught 9 pre-existing tests broken by the initial seam commit — the expert agent root-caused two real bugs the 19-test seam suite never exercised because it stubs the migration runner. **FIX 1:** user.sqlite's seam ran AFTER schema creation, so a restored below-v002 DB got `user_activity` created in its full HEAD shape before the migration saw it, and v004's bare `ALTER TABLE ADD COLUMN` then crashed with "duplicate column name" on EVERY future request (a permanent brick) — fixed by moving the seam before schema creation, mirroring the profile seam. **FIX 4 (more serious):** the seam's fail-loud gate (`entered_restore_branch`) was only one request deep — `set_local_db_version` runs BEFORE the seam inside the SAME restore block, so a request that raised `MigrationBlocked` left `local_version` non-None, and request 2 silently skipped the seam and served the still-below-head DB. Fixed with a new `migrations._seam_verified` success cache, added only on a real "ok", decoupled from the restore branch's own gate. Also: runner exceptions now wrapped (FIX 3, no more raw 500s), test fixtures across 5 files stamp the real head version via a new `stamp_schema_head` conftest helper instead of an impossible-in-prod `user_version=0`/sentinel (FIX 2), and two new tests drive the REAL migration runner through the real seam — the class of gap that let both bugs ship. Full corrected mechanism + landmine writeup: see the "CORRECTED 2026-08-31" seam description and the CI-escalation landmine block in the T5083 section below.)
updated: 2026-08-31 (T5083: **migrations now run JIT at the per-user DB-load seam, not only via the admin-triggered bulk sweep.** `ensure_database` (profile.sqlite, `database.py`) and `ensure_user_database` (user.sqlite, `user_db.py`) each gained a migration call INSIDE their first-access restore branch, strictly AFTER the INV-P restore-then-clear sequence (`set_local_db_version`/`clear_sync_pending`) completes and BEFORE the DB is marked initialized — the hot path (warmed `local_version`) never re-enters this block, so at-head costs one `PRAGMA user_version` read and nothing on every later request. Two new leaner primitives (`migrations.migrate_local_profile_db_at_seam`/`migrate_local_user_db_at_seam`) operate on the file the seam's OWN restore just downloaded+swapped — no second R2 download, no T6410 keep-local tree (the seam already decided swap-vs-keep) — then run the SAME `PROFILE_DB_RUNNER`/`USER_DB_RUNNER`, `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit`, and (profile only) `_read_r2_profile_user_version` verify-at-head the bulk sweep uses, so a DB migrated by either path converges byte/version-identical (`test_sweep_and_seam_identical`). A dedicated per-(user_id, profile_id-or-`USER_DB_SCOPE`) `threading.Lock` (`migrations._get_migration_lock`, TOCTOU-guarded) serializes concurrent same-pair migrations — deliberately NOT the asyncio write lock (user-keyed, non-reentrant, never held on reads; reusing it would either skip protection on GETs or deadlock a WRITE request that already holds it). A CAS refusal on the migration path (`sync_failed`) is handled by `_seam_repull_and_retry_profile`/`_seam_repull_and_retry_user`: check `has_sync_pending_scope` FIRST (INV-P, now trustworthy per-scope since T5081) — nothing pending means a clean-copy race (another machine already carried the migration to R2), re-pull only, no retry; something pending means re-pull (via the low-level restore primitive DIRECTLY, `sync_database_from_r2_if_newer`/`sync_user_db_from_r2_if_newer` — NEVER by calling `ensure_database`/`ensure_user_database` again, which would recursively re-enter this same seam) plus exactly one retry, then raise if still failing (never loop past one retry). Any non-`ok` result (`wal_busy` after one clear+retry, `sync_failed` after the re-pull+retry, `not_at_head`, `missing`, or an exception) raises `MigrationBlocked(user_id, profile_id, reason)`, mapped by a `main.py` FastAPI exception handler to a retryable **HTTP 503** `{"code": "pending_migration"}` (the T5970/T6550 convention) — the DB is NEVER added to `_initialized_users`/`_initialized_user_dbs` on failure, so the client's retry re-enters the seam rather than serving a below-head DB. **Landmine avoided, not hit:** the profile seam is additionally gated on `db_path.exists()` (not just "entered the restore branch") — a genuinely NEW profile (R2 NOT_FOUND, no prior local file) has nothing to migrate yet; CREATE TABLE stamps it straight to head moments later, and without this guard the seam would see a "missing" file and 503 every brand-new signup forever. The out-of-band admin sweep (`_migrate_user`/`_migrate_profile_db`/`_migrate_user_db`/`run_all_migrations`) is UNCHANGED and still the bulk backstop (T5087 owns its deletion); `ensure_user_database_fresh` and `materialization.ensure_profile_db_local`/`_open_profile_db` (non-login writer paths) deliberately do NOT get the JIT trigger yet — T5085 owns that, and the sweep covers them until then. Read-triggers-write is a SANCTIONED exception to the gesture-based-persistence rule, not a violation: the post-migration R2 upload fires only when the runner actually `applied` something (a no-op at-head migration issues zero R2 writes), is idempotent/monotonic (gated by `PRAGMA user_version`, cannot re-fire against its own output — no feedback loop, the defining hazard of banned reactive persistence), and the admin sweep already performed this exact ungestured write; deferring the upload instead is strictly worse (recreates the 2026-08-04 T6402/T6340 stale-baseline CAS trap). Tests: `tests/test_t5083_jit_seam.py` (19 cases: at-head no-op, behind-head migrates, hot-path skip, concurrent-same-pair single-upload, wal_busy blocks both at the primitive and the call site, orphan/registry-thin migrate-then-serve, fail-loud for `not_at_head`/`missing`/exception, all three CAS re-pull-retry-once shapes, user.sqlite symmetric coverage, sweep/seam convergence, and a regression pinning the brand-new-profile guard). Live-verified (not just mocked): the REAL `PROFILE_DB_RUNNER` (unmocked) drove a genuine floor-v23 profile DB — built via the `test_t6030_migration_window_structural_guard.py` `POST_V023_COLUMNS`-drop technique — through the real `ensure_database()` seam to head v48, correct R2 `db-version` advance, all audited columns restored.)
updated: 2026-08-25 (T7520: **an unregistered X-Profile-ID no longer materializes a cross-tenant profile.sqlite.** The impersonation start/stop window let the OLD page fire a request carrying the NEW session's user + the STALE impersonated `X-Profile-ID`; the middleware only FORMAT-checked the 8-hex header (`db_sync.py` ~767), so `ensure_database()` created a profile.sqlite under the WRONG user's dir (then an R2 orphan via shutdown/sweep). FIX = an OWNERSHIP guard at the two CLIENT-INPUT boundaries, never inside the shared creation path: (A) `db_sync.py` header path — after the regex, reject (404 + `logger.critical [PROFILE_GUARD]`) unless `profile_id` is in the session user's registry; keyed on the resolved/impersonated `get_current_user_id()`, NOT the auth source (applies to the `X-User-ID` admin path too — no escape hatch); peek an in-process `session_init._profile_registry_cache` (dict, no I/O) and only offload the cache-MISS load via `run_in_context` (opening user.sqlite blocks / cold R2 download). (B) `session_init._init_slow_path` hint path — validate `hint_profile_id` against the registry BEFORE `_ensure_database_with_context`; unregistered hint creates nothing, resolves to the real selected profile (dropped the T3350 parallel user+profile download for the hint, cold-path only). **DO NOT put the guard inside `ensure_database`/`set_current_profile_id`/anything downstream** — profile-create (see landmine below), background workers, and share materialization (`ensure_profile_db_local`, user != profile-owner) legitimately call the creation path with cross-context ids. Registry cache mirrors `_init_cache` staleness (machine-pinned, invalidated on create/switch/delete via `invalidate_user_cache`, which now drops BOTH caches) — plus the new-user `create_profile` inside `_init_slow_path` pops `_profile_registry_cache` so the guard doesn't 404 the user's own just-created profile. Frontend `sessionInit.clearProfileHeader()` (nulls `_currentProfileId`/`_profileId` + removes `sessionStorage.rb_profile_id`) is called in `authStore` start/stopImpersonation + logout BEFORE navigation to close the emission window client-side. **Corrected landmine (the task file had it BACKWARDS): profile-create registers the profile LAST, not first.** `routers/profiles.py POST /api/profiles` (~209-227) does `set_current_profile_id(new_id)` -> `ensure_database()` -> R2 sync -> `db_create_profile()` LAST (T5310, deliberate: a mid-op crash leaves a benign R2 orphan, never a registered-but-missing profile) — so the guard MUST live at the request boundary, never inside the creation path it would break for every user. Tests: `tests/test_t7520_profile_ownership_guard.py` (foreign header 404 + no DB + no R2 upload; admin-route guard; unregistered hint resolves-to-selected + creates nothing; new-user-hint doesn't leave a stale registry cache). Cleanup of existing orphans: `scripts/cleanup_orphan_profiles.py` (fixed: prod->production prefix alias, local+R2 sequenced delete-then-verify, per-orphan row-count evidence). See T7520 section.)
updated: 2026-08-24 (T4360: **action-endpoint RMW atomicity is now enforced by SQLite's RESERVED lock, not by the absence of an `await`.** `framing_action` (clips.py) and `overlay_action` (overlay.py) each issue `conn.execute("BEGIN IMMEDIATE")` as the FIRST statement after opening the cursor, before the read -- a concurrent second writer's own `BEGIN IMMEDIATE` blocks on the RESERVED lock (up to `busy_timeout=30000`) until the first commits, instead of both reading stale state and the later commit silently clobbering the earlier one. Previously this was safe only because no `await` existed between read and commit inside one coroutine (a Python-scheduling accident this fix removes the dependency on). Mechanism works under Python 3.11's legacy `isolation_level=""`: issuing `BEGIN IMMEDIATE` before any DML sets `in_transaction=True`, so the module's own implicit `BEGIN DEFERRED` never fires -- no competing/stranded transaction. Lock-timeout overflow (`sqlite3.OperationalError: database is locked`) is caught and surfaced as a retryable `503 {"error": "database_locked"}`, never a silent 500. `games.py activate_game`'s bug26p multi-transaction/multi-connection ordering was deliberately NOT wrapped (would deadlock against `insert_game_storage_ref`'s nested connection) -- its invariants are pinned by tests only (restructure is T4640). Race detector + activation invariant tests: `tests/test_t4360_explicit_orderings.py`. See T4360 section.)
updated: 2026-08-10 (T6350: **the generic `DURABLE_SYNC_FAILED_RESPONSE` LIES for a MULTI-PHASE durable handler.** `move_reels_to_profile` copies+durably-syncs the TARGET profile (phase 1), locally commits the SOURCE-row delete (phase 2, `conn.commit()`), and deletes the SOURCE media (phase 3) BEFORE the middleware runs the SOURCE-side `durable_sync` (which happens AFTER the handler returns 200). When THAT source sync fails/conflicts the middleware discarded the 200 and returned the fixed "Your reel was not moved" body — FALSE: the target copy is already durable in R2, and the source rows/media are already gone locally. FIX: a per-route override, `set_durable_sync_failure_response(request, payload)` (db_sync.py, next to `DURABLE_SYNC_FAILED_RESPONSE`), stashes a truthful body on `request.state`; the middleware's 503 branch now returns `{**(request.state.durable_sync_failed_response or DURABLE_SYNC_FAILED_RESPONSE), "sync_state": sync_status}` (BUILD A NEW DICT — the module-level default must never be mutated). The move handler sets the override (`code=move_source_cleanup_failed`, `target_committed=True`, flat shape) ONLY after the phase-2 commit, so a phase-0/1 abort still serves the honest generic "nothing moved". Because re-running the MOVE gesture can't recover once phase 3 deleted the source media (phase 0 then 502s), the actual "idempotent retry" is a NEW endpoint `POST /api/downloads/move-to-profile/finish` that re-runs ONLY the source cleanup (`_delete_moved_source_rows`, extracted + shared), after proving each reel is present in the TARGET by `filename` (per-user hash; ids differ across profiles) — unproven -> 409, delete nothing. A phase-1 filename-existence guard (skip a target INSERT whose `filename` already exists; skipped rows NOT added to `inserted_target_ids`) makes a re-issued move idempotent. **KNOWN follow-up (NOT fixed here):** `POST /clips/raw/save`, `PUT/DELETE /clips/raw/{id}`, `POST /api/games/finalize-upload`, `POST /api/profiles` are single-phase today so the generic body is CORRECT for them — but any future multi-phase work on those must set an override too. See T6350 section.)
updated: 2026-08-03 (T6402: **a machine could CAS-conflict with its OWN write.** The version decision (baseline read -> HEAD -> refuse) ran entirely OUTSIDE the upload lock that serialises the PUT, so two concurrent syncs of the SAME db in ONE process interleaved: A reads baseline v2734; B reads v2734, HEADs v2734, takes the lock, PUTs v2735, advances the baseline; A's HEAD then sees v2735 > v2734 and refuses. Both upload the SAME file on disk, so A's "stale" copy already contained B's data -- a false conflict against ITSELF. Concurrency per user is BY DESIGN (`db_sync.py`: "fire-and-forget `_background_sync` tasks are not serialised per user"); T5870 round 2 gave the RE-DRAIN a non-blocking lock probe but the PRIMARY sync path never got the equivalent guard for its decision. Cost: false "edits aren't saving" banner + `schedule_profile_db_reheal` forcing a FULL profile.sqlite re-download on the next request (the "My Reels took forever to load" symptom), plus a narrow silent-loss window -- rows COMMITTED after the winner's PUT but before the loser's HEAD are refused and then DISCARDED by the re-heal (T6160 decision 2). FIX, two halves: (1) the decision + WAL checkpoint + PUT now all run INSIDE the upload lock (also closes the reverse interleave where both syncs HEAD the same version and PUT the same new_version = a version collision other machines' CAS relies on); (2) `_OWN_UPLOAD_VERSIONS` records the version THIS PROCESS last PUT per R2 key, written under the lock BEFORE releasing, and the refusal is skipped when `r2_version == our own recorded version`. EQUALITY, not a range -- a foreign writer always lands strictly ABOVE our own version and still refuses; an unconfirmed (None) baseline is never rescued; the BASELINE IS NEVER MUTATED so `new_version` arithmetic is unchanged for every caller (mutating it broke 11 existing tests -- that approach was rejected). The caller's `set_local_db_version` happens AFTER the primitive returns, i.e. OUTSIDE the lock, which is exactly why re-reading the baseline under the lock does NOT close this race and the own-upload record is required. Accepted trade-off: the lock is now held across the HEAD (~50-100ms) and the checkpoint (<=2s busy timeout), so the middleware's `lock_timeout=0.5s` deferral may fire slightly more often -- a deferral is benign (marks pending, healed by the re-drain), a false conflict was not. See T6402 section.)
updated: 2026-08-03 (T6390: the `.sync_conflict`/`.sync_failed` markers are now PER-SCOPE files (`.sync_{kind}.{scope}`, scope = `USER_DB_SCOPE="user"` or the profile_id) carrying a JSON DIAG payload, not per-USER files with a bare `str(time.time())`. Fixes a real defect: a success on ONE db (`clear_sync_conflict(user_id)`) silently ERASED a live conflict on ANOTHER — incl. `retry_pending_sync`'s deterministic SELF-STOMP (profile marks conflict, user-branch success cleared it → a non-retryable CAS conflict was blind-retried by `_redrain` to exhaustion and mislabelled `failed`). Now cleared PER SCOPE; `has_sync_conflict` = ANY scope; the T4310 post-gather reassertion is DELETED (scoping makes the race impossible). `retry_pending_sync` returns an aggregate `SyncResult` (not bool) and `_redrain_failed_sync` decides "stop, CAS conflict" from that RETURN VALUE, not a marker file. DIAGNOSTICS: markers carry `reason`(stale_baseline|unconfirmed_baseline|upload_failed|checkpoint_busy|legacy) + db/profile_id/loaded/r2/machine/req_id/method/path/writer/written_at; storage.py stamps `db-writer`(machine/req_id)+`db-written-at` on every upload and reads them from the conflict HEAD (get_db_version_from_r2 return_metadata=True — ZERO extra R2 calls); the `[SYNC_CONFLICT]` CRITICAL now names req_id/method/path/writer/reason (method/path via new `_current_method`/`_current_path` ContextVars set in dispatch); `read_sync_diag` renders the winning marker into the `X-Sync-Diag` header (ADDED to main.py:217 `expose_headers` — invisible cross-origin otherwise); client `checkSyncStatus` logs a console.error on the TRANSITION into conflict/failed (no spam) and `retrySyncToR2` logs all 3 outcomes. Reader/legacy tolerance: `has_/read_` never raise on a legacy bare float marker. CAS guard BYTE-IDENTICAL — diagnostics only. Readers TOLERATE the legacy format. See T6390 section.)
updated: 2026-08-02 (T6340: the profile_db MIGRATION RUNNER is now a baseline-establishing caller. `_migrate_profile_db` force-downloads the canonical R2 profile.sqlite and `shutil.move`s it over the local file; the R2 sync version lives in object metadata, NOT in the bytes, so the swapped-in file had NO db_version row → get_local_db_version()==None → CAS BLOCKING-2 refused the post-migration upload UNCONDITIONALLY → NO profile_db migration ever reached R2 on staging/prod (v030/v031 stuck). FIX: after the swap, record the DOWNLOADED copy's sync version as the confirmed baseline via set_local_db_version, atomically — `_download_profile_db` now fetches bytes+metadata in ONE get_object so no separate HEAD can observe a moved version (recording a moved version would force-push older bytes at a bumped version = clobber). CAS guard UNCHANGED (fix the caller, not the guard). r2_version now populated in error rows (was always null) via one HEAD on the FAILURE path only. `_migrate_user_db` (user.sqlite) does NOT share the defect — ensure_user_database's restore records the baseline from the same download. See T6340 section.)
updated: 2026-07-28 (T6160: a CAS conflict now SELF-HEALS — restore is first-access-only, so a running machine never noticed R2 moving ahead and every write refused forever (Retry futile until restart). On conflict the loaded-from version is now invalidated (profile: memory + persisted db_version file row + cooldown; user.sqlite: memory version + `_initialized_user_dbs` init flag + cooldown) so the NEXT request's first-access restore re-pulls R2's newer copy. CAS refusal UNCHANGED (baseline never advanced; a None baseline still refuses via BLOCKING-2). The refused in-flight edit is DISCARDED by the re-pull (decision 2, never merged/force-pushed). ensure_database/ensure_user_database first-access restore gained the T4315 WAL guard (before_download + clear_stale_wal_sidecars) since the re-pull can now fire on a running machine. See T6160 section.)
updated: 2026-07-27 (T6040: reader-vs-writer split on `conflict` — a no-write session now gets a quiet "newer version available" + Reload notice instead of total silence; `failed` stays silent for readers because the `conflict`/`failed` asymmetry (R2-ahead vs local-ahead) means only `conflict` readers are looking at stale data; frontend-only, backend untouched; see T5960/T6010/T6020/T6040 section)
updated: 2026-07-27 (T6020 follow-up: renamed the write-attempt gate's call-site marker `rbLifecycleWrite` -> `rbNonDataWrite` and marked 5 auth-gesture sites the original table missed (google/verify-otp/send-otp/logout/report-problem) — the old name misled at the auth boundary since login IS a gesture but still can't touch the profile SQLite; supervisor-audit-caught regression vs the T5960 baseline; see T5960/T6010/T6020 section)
updated: 2026-07-27 (T6020: the write-attempt gate's classification moved from a URL denylist to an explicit per-call-site marker — fixes `PATCH /api/projects/{id}/state` being both project-open bookkeeping and a mode-switch gesture at the identical pathname; see T5960/T6010/T6020 section)
updated: 2026-07-27 (T6010: the `failed` alarm is ALSO gated on write-attempt now, symmetric with `conflict` — generalized `ALARM_SYNC_STATES`; `pending` stays ungated; see T5960/T6010/T6020 section)
updated: 2026-07-27 (T5960: the sticky `.sync_conflict` alarm is GATED on write-attempt in the frontend — a read-only session that inherits another session's refusal stays silent; backend marker semantics UNCHANGED; see T5960/T6010/T6020 section)
updated: 2026-07-26 (T5870: split sync state into pending/failed/conflict — a deferred sync is no longer mislabelled "failed"; bounded re-drain heals transient failures in-band; Retry restored + restores-if-newer on conflict; see T5870 section)
updated: 2026-07-26 (T5920: WAL checkpoint-or-refuse guard in the R2 upload primitive — no under-checkpointed upload at a bumped version; see T5920 section)
updated: 2026-07-26 (T5840: credits moved OUT of user.sqlite/R2 into Fly Postgres — see backend-services.md "Credits (Postgres, T5840)". No longer part of the R2 sync/CAS story below; purge/reregister interaction now governed by a Postgres idempotency-key collision, not restore-from-R2.)
updated: 2026-07-25 (T4315: confirm_current_before_write restore-if-newer for write paths, WAL-safe sidecar cleanup; generalizes require_fresh/_refresh_target_user_db)
updated: 2026-07-25 (T4310: CAS re-enabled on async/worker/shutdown R2 uploads; SyncResult 3-state contract; conflict -> freeze/escalate/Retry)
---
# Persistence & R2 Sync — Domain Knowledge

## Scope
How user data gets written and how it survives: gesture-based persistence rules, per-user SQLite databases synced to Cloudflare R2, the sync middleware, version tracking, machine pinning, and durability. Auth/sharing/sessions live in Fly Postgres and are NOT synced to R2 (see backend-services.md).

## Entry points
- `src/backend/app/middleware/db_sync.py` — `RequestContextMiddleware` (single combined middleware: auth resolution + profile context + write tracking + R2 sync). Aliased as `DatabaseSyncMiddleware` (db_sync.py:885). Registered in `main.py:124`.
- `src/backend/app/database.py` — profile DB (`user_data/<user_id>/profiles/<profile_id>/profile.sqlite`): `ensure_database()` (database.py:479), `TrackedConnection` (database.py:199, write tracking), sync helpers `sync_db_to_r2_explicit` / `sync_user_db_to_r2_explicit` (database.py:1354/1438, return `SyncResult`), `.sync_pending` / `.sync_conflict` marker file helpers (database.py:58-110).
- `src/backend/app/storage.py` — R2 upload/download with version metadata: `sync_database_to_r2_with_version` (storage.py:829), `sync_user_db_to_r2_with_version` (storage.py:1084). R2 keys are env-prefixed: `{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite`.
  - **R2 MEDIA ARTIFACTS ARE PER-PROFILE, not per-user.** `r2_key(user_id, path)` (storage.py:266) embeds the CURRENT `profile_id` from the ContextVar: `{APP_ENV}/users/{user_id}/profiles/{profile_id}/{path}`. So `final_videos/`, `working_videos/`, `raw_clips/`, `intro/` (T5190 player-intro card images) objects all live under a specific profile prefix — a DIFFERENT profile of the SAME user cannot presign them. Any cross-profile op that references media (e.g. T4850 reel move) MUST relocate the object between profile prefixes; carrying only the DB row 404s on playback/download. (Global `games/{hash}.mp4` is the sole env-prefix-free, cross-profile namespace.) Cross-profile helpers: `profile_r2_key` / `copy_profile_object` / `delete_profile_object` / `profile_object_exists` (storage.py, T4850) build the key for an EXPLICIT profile id (no ContextVar).
  - **T8160 LANDMINE — R2 UploadIds are NOT stable identifiers across API responses.** Cloudflare R2 returns a DIFFERENT UploadId string for the same multipart upload in every response: CreateMultipartUpload and each ListMultipartUploads call all give distinct, equally-valid ALIASES (verified live 2026-08-31; any alias works in abort/list_parts/presign). **Never compare UploadIds across two responses** — `keep_upload_id` equality, stored-vs-listed anomaly detection, list-vs-list matching are all always-false on R2. Direct USE of a stored id in a later call is fine. This broke T7950's orphan reclaim (`r2_abort_orphan_multipart_uploads` aborted its own just-created keeper -> every fresh prod upload failed with part 404 NoSuchUpload from the ~2026-08-30 deploy until T8160; bug 47p). Post-T8160 rules: orphan reclaim spares by AGE (`ORPHAN_MULTIPART_MIN_AGE_SECONDS`, storage.py) never by id; prepare_upload verifies the keeper is still valid after any reclaim that aborted something (fails 500 + CRITICAL, never hands out presigned URLs for a dead upload); within ONE List response entry-vs-entry comparison is still sound (`_adopt_live_multipart_after_ack_loss`). Mocked tests with stable ids CANNOT catch regressions here, and staging re-uploads dedup to the EXISTS path (zero parts) — only a NOVEL random file against real R2 exercises the multipart path.
  - **T8190 — the JIT migration seam (T5083/T5085) self-deadlocks if a migration's `up()` writes
    through `get_db_connection`/`get_user_db_connection`.** Hit live on staging 2026-08-31 (the
    T5085 review's own LANDMINE comment, "not yet hit in prod"): `run_profile_seam` holds a
    per-(user, profile) lock while running pending migrations; `v047_backfill_game_storage_refs`
    (and `v017_backfill_missing_storage_refs`, found by the audit — same bug, unnoticed since
    2026-07) called `auth_db.insert_game_storage_ref`, whose SQLite half opens
    `get_db_connection()` -> `ensure_database()` -> `run_profile_seam` AGAIN for the SAME
    profile this thread already holds the lock for -> deadlock, no timeout, the whole process
    wedges (even `/api/health` stops responding once the thread pool exhausts behind it) until a
    machine restart. Fixed two ways together: (1) same-thread re-entrancy — `_seam_in_progress`
    tracks which thread is running the seam for a key; a nested call from that SAME thread
    returns immediately (the outer frame owns the migration), (2) genuine cross-thread
    contention acquires with `SEAM_LOCK_TIMEOUT_S=30` and raises `MigrationBlocked` (503) on
    timeout instead of hanging the requester forever. Root cause also fixed at the source:
    `insert_game_storage_ref` split into `upsert_game_storage_row(conn, ...)` (SQLite, using the
    CALLER's own connection) + `insert_game_storage_ref_pg_only(...)` (Postgres only, never
    touches SQLite/the seam) — migrations call these two instead of the combined function. **Any
    migration's `up(conn)` must use its OWN `conn` (or a Postgres-only helper) for all writes,
    never a request-path opener that re-runs `ensure_database`/`ensure_user_database`** — a
    static guard test (`test_t8190_seam_reentrancy_deadlock.py`, regex on real call syntax,
    ignores comments/docstrings and the `_pg_only` variant) fails any NEW migration that
    reintroduces this. Prod was dormant when this shipped (all accounts already at head, so JIT
    had nothing to apply) — the danger is specifically the NEXT migration that ships below-head
    accounts into the seam.
  - **T5190 — intro-card image upload + parental consent.** `POST /api/profiles/{profile_id}/intro/image` (`routers/profiles.py`, service `services/intro_media.py`) decode-verifies via cv2 (never extension/declared type; non-image → 400), re-encodes to a 1440px long edge preserving alpha (4-channel → PNG, else JPEG), and stores under the per-profile `intro/{uuid}.{ext}` prefix built from the URL `profile_id` via `profile_r2_key` + `upload_bytes_to_r2_global` (NOT the request ContextVar — so an upload for a non-current profile still lands correctly). `delete_intro_image(user_id, profile_id, key)` is a callable service (T5230 purge reuses it) that refuses a key outside this profile's `intro/` prefix.
    **Follow-up (2026-08-04): the photo key is owned at the PROFILE level, not a card row.** The
    original plan ("the key is written onto an `intro_cards` row by T5195") was a spec error —
    nothing ever persisted the returned key, so an uploaded photo did not survive a reload. Fixed
    the same way as consent below: `intro_photo_key.{profile_id}` in the **user.sqlite
    `user_settings` KV** (helpers `set/get/clear/get_all_intro_photo_key(s)` in `user_db.py`, no
    migration), exposed as `introPhotoKey` + a freshly presigned `introPhotoUrl` on both
    `GET /api/profiles` and `GET /api/bootstrap` — presigned at READ time, never stored presigned
    (they expire). Upload overwrites the key and deletes the previous R2 object; delete clears the
    key and deletes the object. A future card (T5195) may default its own image from this
    profile-level key instead of requiring a fresh upload per card.
    **Parental consent** is a per-profile timestamp in the **user.sqlite `user_settings` KV** keyed
    `intro_consent_at.{profile_id}` (helpers `set/get/clear/get_all_intro_consents` in
    `user_db.py`) — NOT a `profiles` column, so no user_db migration. It lives in user.sqlite
    (TrackedConnection → synced to R2) rather than profile.sqlite because it is exposed as
    `introConsentAt` on the profiles payload (both `GET /api/profiles` AND `/api/bootstrap` — miss
    the bootstrap one and the consent checkbox is wrong on first paint / after reload), which is
    built entirely from user.sqlite; profile.sqlite would force opening every profile DB per list.
    Consent gates intro attach (T5215 enforces).
- `src/backend/app/services/user_db.py` — `user.sqlite` (per-user: profiles list, quests, activity — **credits moved to Postgres, T5840**, see backend-services.md).
- `src/backend/app/main.py:232` — `_graceful_shutdown` (SIGTERM: WAL checkpoint + sync every profile.sqlite AND every user.sqlite — the user.sqlite loop was added in T4320; the prior "skips user.sqlite" gap is closed).
- `src/backend/app/middleware/fly_replay.py` — WebSocket-scope fly-replay (outermost middleware, main.py:130).

## Data flow
Request lifecycle (`db_sync.py:443 _dispatch_impl`):
1. **Machine pinning (T1190)**: `fly_machine_id` cookie; mismatched live machine → respond with `fly-replay: instance=<id>` header (db_sync.py:447-471). Stale/dead machine → handle locally, re-pin cookie.
2. **Auth**: `rb_session` cookie → Postgres `validate_session`; fallback `X-User-ID` header (dev/staging only, plus `/api/admin/` routes; db_sync.py:492-502). Unauthed + not allowlisted → 401.
3. **Profile context**: `X-Profile-ID` header (8-hex) or `user_session_init(user_id)` resolves it. ContextVars: `user_id`, `profile_id`, `req_id`.
4. **Per-user write lock (T1531)**: POST/PUT/PATCH/DELETE serialize per user (db_sync.py:195-229); reads take no lock (SQLite WAL).
5. Handler runs; every DB write through `TrackedConnection` flips a per-request "has writes" flag (separate flags for profile vs user DB).
6. **After handler, if writes**: `mark_sync_pending(user_id)` (crash-safe `.sync_pending` marker file, T930), then either:
   - **Fire-and-forget (default)**: `asyncio.create_task(_background_sync(...))` — response returns before R2 upload (T3250). Upload-lock contention defers after `_SYNC_LOCK_TIMEOUT = 0.5s` (db_sync.py:201) — this is a silent-loss window.
   - **Durable (T4050)**: routes with `Depends(durable_sync)` (db_sync.py:84) AWAIT the sync inside the write lock; failure → 503 `sync_failed` retryable payload, never a lying 200. Now on: publish/restore-project/overlay-export (T4050/T4110), framing/multi-clip export (T4200), AND the clip-creating/mutating gestures + profile-create (T4320): `POST /clips/raw/save`, `PUT /clips/raw/{id}`, `DELETE /clips/raw/{id}`, `POST /api/games/finalize-upload`, `POST /api/profiles`. Still fire-and-forget by design: working-clip `/actions` (framing_action) — high-frequency; making each keyframe drag block on an R2 upload would re-introduce the T2720 blocking-sync regression, so they stay async and are backstopped by T4310 (CAS) + T4330 (action client).
7. Failed syncs leave the marker; next WRITE request retries (`retry_pending_sync`, db_sync.py:255); `X-Sync-Status: failed` header surfaces persistent failure to the frontend (AND-gated with in-flight-sync set, db_sync.py:156).

Restore path: `ensure_database()` downloads from R2 **only on first access** of the process for that user+profile (local version cache `None`); no per-request HEAD (database.py:498-553). R2-not-found → fresh DB, version locked to 0. Transient R2 error → 30s cooldown, retry later. **T6160: a CAS conflict now re-arms this first-access path** — `schedule_profile_db_reheal`/`schedule_user_db_reheal` invalidate the loaded-from version on conflict so the next request re-pulls R2's newer copy (one HEAD only when a conflict happened, NOT per-request). The first-access download is now WAL-guarded (`before_download=not wal_sidecars_present` + `clear_stale_wal_sidecars`) because it can fire on a running machine — see T6160 section. **T7010 diagnostics:** when that re-heal download fires DURING a write request (`get_current_method()` in POST/PUT/PATCH/DELETE) and a conflict marker is still set (`has_sync_conflict`), `ensure_database` logs `[Restore] MID-WRITE HEAL` at CRITICAL naming the in-flight `METHOD path`/`req_id` whose local writes are discarded/re-run against the fresh copy; a plain cold first-access restore (no prior conflict) is NOT flagged.

Version model — two INDEPENDENT version systems, never conflate:
- **Sync version**: integer in R2 object metadata `db-version` (`x-amz-meta-db-version`, storage.py:735/931) mirrored in a local `db_version` table (id=1 row, database.py:353-366) + in-memory cache. Incremented on every successful upload.
- **Schema version**: `PRAGMA user_version`, set by the migration runner (see backend-services.md).

Blob encoding: binary columns (`crop_data`, `segments_data`, `highlights_data`, `tags`, `game_ids`, …) are **msgpack** via `encode_data`/`decode_data` in `src/backend/app/utils/encoding.py`. JSON over the wire, msgpack on disk (msgpack-over-HTTP was rejected).

## Invariants & rules
1. **Gesture-based, never reactive** (CLAUDE.md): every DB write traces to a named user gesture. Surgical actions POST only the changed field (`POST .../actions`; backend does read-modify-write on the blob). Full-state saves (`PUT /clips/{id}`, `saveCurrentClipState`) only on explicit export gesture. Reactive `useEffect`→API/store persistence is BANNED (caused T350 keyframe origin corruption; T4020 shadow-version loss). ~~Last surviving violation: game-duration PATCH (T4260)~~ → FIXED 2026-07-11: the `loadedmetadata` PATCH is deleted from `AnnotateContainer.jsx`; no reactive effect→API writes remain in the codebase. **Now MACHINE-ENFORCED (T4290):** custom ESLint rule `local/no-persistence-in-effects` (error, `src/frontend/eslint-rules/`) flags write-verb `apiFetch`/`fetch` (POST/PUT/PATCH/DELETE), `.setState()`, and `use*Store.getState().<mutator>()` when their nearest enclosing fn is the effect callback or a directly-invoked IIFE — 0 hits today; escape hatch is `// eslint-disable-next-line local/no-persistence-in-effects -- gesture: <name>`. Deferred/reconciliation writes (`.then`/timer/listener callbacks, named load helpers, cleanup returns, mount-once `[]` effects) are intentionally NOT flagged. Sibling rule `local/no-raw-editor-mode-literals` (bans raw `'framing'|'overlay'|'annotate'`) ships `off` — 56 baseline hits would breach the frozen `eslint src --max-warnings 998` gate (already at 998); flips to `warn` after EDITOR_MODES adoption (T4560) ratchets the baseline down.
2. Runtime fixups (keyframe normalization etc.) are memory-only, never persisted; restore is read-only; one write path per piece of data.
3. Writers must commit BEFORE the write lock releases (middleware relies on this for read-your-writes).
4. `SKIP_SYNC_PATHS` (db_sync.py:309) and `AUTH_ALLOWLIST_PREFIXES` (db_sync.py:322) are the only sync/auth bypasses — check them before assuming a route syncs.
5. Background workers (export_worker, sweep_scheduler etc.) must use the `*_explicit(user_id, profile_id)` sync functions — ContextVars are dead outside the request. **The `_explicit` sync functions now derive the R2 KEY from the ARG, not the ContextVar (T5340):** `sync_db_to_r2_explicit` passes `profile_id` through `sync_database_to_r2_with_version(..., profile_id=)`, which keys the upload via `profile_r2_key(user_id, profile_id, "profile.sqlite")` (arg) instead of `r2_key` (ContextVar). A missing `profile_id` now RAISES (no silent ContextVar fallback). `r2_key`/`get_database_path` (ContextVar) are **request-path only**. Pre-T5340 the key came from the ContextVar, so any `_explicit` caller whose ContextVar ≠ arg uploaded the right DB to the WRONG profile's key (confirmed on T4850 move-reels; also latent in `main.py:_graceful_shutdown`, which runs with NO request context → `r2_key` would raise/mis-key — now passes `profile_id=` from the globbed path). `retry_pending_sync` (db_sync.py) is likewise now genuinely ContextVar-free (uses `get_user_data_path_explicit` + `profile_id=`). `sync_user_db_to_r2_explicit` was NEVER affected — the user.sqlite key (`_user_db_r2_key`) has no profile segment and no ContextVar. **Sweep corollary**: after `expire_game_storage()` updates ≥1 row in a profile.sqlite during Phase 2 deletion, `sync_db_to_r2_explicit(user_id, profile_id)` MUST be called immediately. Skipping it means the expiry is lost on next cold-load from R2, resurrecting the game as 'active' (T4820).
6. **Action-endpoint RMW atomicity is DB-enforced (T4360), no longer a scheduling accident.** `framing_action` (clips.py:451) and `overlay_action` (overlay.py:639) each issue `conn.execute("BEGIN IMMEDIATE")` as the FIRST statement after `cursor = conn.cursor()`, before the read — taking SQLite's RESERVED lock immediately so a second concurrent writer's own `BEGIN IMMEDIATE` blocks (up to `busy_timeout=30000`) until the first commits, instead of both blindly reading-then-clobbering (lost update). Previously (audit B8) this was safe only because no `await` existed between read and commit inside one coroutine — a Python-scheduling accident, not a DB guarantee; the old rule "do not insert awaits into `POST /actions` handlers" is now OBSOLETE, superseded by the lock. `sqlite3.OperationalError` on lock-timeout overflow (message `"database is locked"`) is caught at both the `BEGIN IMMEDIATE` call and the commit call in each handler, surfaced as a retryable `503 {"error": "database_locked"}` — never silently swallowed or a generic 500. See T4360 section.
6b-T5810. **Cross-profile game references ride the SAME phase-1 target write (T5810).** `move_reels_to_profile` now materializes a metadata-only game REFERENCE in the TARGET profile (`materialization.ensure_game_reference`, see export-pipeline.md § Cross-profile game references) for each distinct game the moved reels attribute to, then remaps each reel's `game_ids`/`game_id` through it so grouping survives the move. The reference INSERT happens on the ALREADY-OPEN `target_conn` INSIDE the existing Phase-1 try block, so it is committed + checkpointed + synced by the SAME `sync_db_to_r2_explicit(user_id, target_profile_id)` call that already exists — **NO new sync call site** (invariant 6b unchanged), and a Phase-1 failure rolls the references back with the reels. It BUILDS ON the `require_fresh`/`ProfileDBRefreshFailed` guard (a5ff3e48): the reference is written into the target-resolution guard's confirmed-fresh copy, never a stale one. Orphan REFERENCES (only `source_profile_id IS NOT NULL` rows, never real games) are cleaned GESTURE-DRIVEN in move Phase 2 (source side) and in the reel-delete endpoint (`_delete_orphan_reference_games`) — never a reactive sweep (EPIC decision). A source game deleted after publish drops that id from the remap with a WARNING (honest-unattributed, not a silent fallback). New v030 reads on the SOURCE games row are `column_exists`-guarded (a pre-v030 source has no references, so NULL is correct).

6b. **Cross-profile durable write (T4850, `downloads.py:move_reels_to_profile`)**: when a gesture writes TWO profile DBs of the same user, `durable_sync` only covers the REQUEST profile. Write + explicitly `sync_db_to_r2_explicit(user_id, other_profile_id)` the OTHER DB inside the handler, and order it so the losing side is the request profile (target written+synced FIRST, source deleted+`durable_sync` SECOND) — a mid-op machine death then yields a recoverable DUPLICATE, never data loss. Open the other DB with materialization's `ensure_profile_db_local` + `_open_profile_db` (raw sqlite, NOT TrackedConnection → the middleware won't sync it, which is why the explicit sync is mandatory). **T5340: `sync_db_to_r2_explicit(user_id, target_profile_id)` here now keys R2 off the arg, so it correctly lands on the TARGET's key even though the request ContextVar is the SOURCE.** (Before T5340 it uploaded the target DB to the SOURCE key → corrupted the source copy and lost the move on cold-load.)
6c. **Public game-link claim (T5730, `materialization.claim_game_link`)** is a CLAIMANT-initiated gesture — NOT `pending_teammate_shares` (that table is recipient-email-keyed; a link claim has no targeted recipient). The deferred no-account path carries the token as the LAST segment of the `/claim/game/{token}` URL (survives the signup reload; T2915 link-snapshot class) and completes via the import dialog's explicit Confirm POST — nothing auto-materializes on auth (no reactive `useEffect`→claim). The write reuses `materialize_game_share`'s existing sync machinery (recipient checkpoint-before-upload + explicit `sync_db_to_r2_explicit` + refuse-to-mark-on-failure, T4315/T5920), so a 503 `sync_failed` is retryable and never a lying success. It confirms the CLAIMER (recipient) is current via `ensure_profile_db_local(require_fresh=True)` before writing, and read-only-pulls the SHARER's source DB via `ensure_profile_db_local(...)` (no require_fresh — source is never written back).
7. **Fire-and-forget persistence changes are deferred** until sessions are reliably pinned to a single machine (memory: blocked T1537). Machine pinning exists (T1190) but the constraint stands.
8. **All gesture action POSTs go through `src/frontend/src/api/actionClient.js` (T4330), never a raw `apiFetch` on an `/actions` endpoint.** `createActionClient({url, entityKey, tag, mapResult, onConflict})` owns three concerns transparently for both `focusActions.js` and `overlayActions.js`: (a) **per-entity FIFO** — a `Map<entityKey, Promise>` tail chain serializes same-entity actions in emission order (closes the wire-reorder race on whole-blob RMW; different entities never block each other); (b) **version threading** — tracks the last echoed version per entity, sends it as `expected_version` on the next action, omitted until the first response (no seed-from-GET), deleted on a 409; (c) **409 routing** — `onConflict` fires the shared `src/frontend/src/utils/actionConflictPrompt.js` refresh toast (full `window.location.reload()`, NEVER an auto-rebase/retry) instead of the retry queue. See T4330 section below.

## Landmines & history
- **Account deletion MUST purge R2 + local + in-process caches (bugs 33p/34p/35p, fix/bug-33-34-35-newuser-flow).** `user.sqlite`/`profile.sqlite` live in R2 under `{APP_ENV}/users/{user_id}/`. A delete that removes only the local folder leaves the R2 copy, which `ensure_user_database`/`ensure_database` restore on the next login (first-access-only restore) → the account is resurrected. Both delete endpoints now call `auth._purge_user_data`: local rmtree + `storage.delete_user_r2_data` (paginated whole-prefix, raises on error) + cache invalidation (`invalidate_user_cache`, `user_db.forget_user_db`, `database.forget_local_db_state`) + `invalidate_user_sessions`. Cache invalidation is required because `_initialized_user_dbs` / `_user_sqlite_versions` / `_user_db_versions` make `ensure_*` skip the R2 re-check on an already-seen user — a stale cache entry can skip restore or mask the delete. **Corollary:** `is_new_user` derives from the restored user.sqlite's `selected_profile`, so purging R2+caches makes a reregister genuinely new even without deleting the Postgres users row. Residual open race: a cross-machine re-sync between delete and reregister can still resurrect the R2 copy (would need a deletion tombstone to fully close). **Credits (T5840) are a separate purge concern** — they never lived in the R2-restored user.sqlite (so this race doesn't apply to them, and a reregister no longer "seeds credits" via the restored user.sqlite), but `_purge_user_data` must delete `credits`/`credit_transactions`/`credit_reservations` in Postgres or a purge-then-reregister under the same `user_id` collides with the old `signup:{user_id}` idempotency key (`ON CONFLICT DO NOTHING`) and silently grants no signup bonus — the delete must live in the shared `_purge_user_data` helper, not duplicated per caller.
- ~~`skip_version_check=True` at EVERY upload call site~~ FIXED T4310 (upload side) — see the T4310 section below. `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit` now default to `skip_version_check=False` (CAS on); the request-thread-synchronous exceptions (profile create) pass `skip_version_check=True` explicitly. **The restore side is PARTIALLY covered by T4315** (see the T4315 section below) — teammate-share materialization and move_reels confirm a real baseline via `confirm_current_before_write`/`get_user_db_connection`'s structural foreign-user guard before mutating. (T4315 ALSO covered the admin-credit-grant and payments (webhook + confirm/verify) write paths, but **T5840 moved credits into Postgres**, so those paths no longer touch user.sqlite/R2 — payments webhook is no longer a `skip_version_check=True` caller and the credit grants no longer participate in this CAS/restore dance at all.) A cold-cache BACKGROUND WORKER that never resolves through one of the surviving paths can still skip the CAS guard (`current_version is not None` still gates it) — this is a *miss*, not a *false positive*: T4315 additionally closed the sharper failure mode where `current_version is None` met REAL R2 content (storage.py's CAS now refuses that combination outright, upload-side, regardless of which caller triggered it — see T4315 section, BLOCKING-2).
- **Local dev**: DB changes made directly to a local profile.sqlite get overwritten by R2 restore/sync on reload — edit the R2 copy (`scripts/edit-user-db.py`) or use fallback paths (memory: dev state simulation).
- **T350**: reactive useEffect persistence compounded keyframe fixups into corruption — origin of the gesture-only rule.
- **T4020**: export's redundant post-render full-state save wrote an empty "shadow" working-clip version; bloat-cleanup then pruned the real one = permanent framing loss. Fixed frontend-side; backend-authoritative export (audit B4/T4400) is the structural fix.
- **T4110 → T4200 (DONE 2026-07-11)**: sync-then-announce extended to framing and multi-clip. ALL export paths now gate COMPLETE on sync success; DB-save failure is terminal. The `_export_sync_failed_data` helper lives in `export_helpers.py`.
- **0.5s defer window** (T2720): middleware sync gives up waiting for the R2 upload lock after 0.5s and defers — annotation sessions can revert wholesale if the machine dies before the next sync (T4320).
- ~~Shutdown sync (main.py:255-276) covers profile DBs only, not user.sqlite.~~ FIXED T4320: `_graceful_shutdown` now runs a second loop over `*/user.sqlite` (WAL checkpoint + `sync_user_db_to_r2_with_version`, mirroring the profile.sqlite loop).
- ~~`overlay_version` on working_videos is bumped by surgical overlay actions; the orphaned `PUT /overlay-data` (overlay.py:1383) does NOT bump it — deletion pending in T4210~~. FIXED T4210 (2026-07-11): `PUT /overlay-data` deleted; decode failure now returns 500 instead of silently returning `[]` and erasing all highlights.
- `segments_data` has two formats on disk (splits-only from gestures vs full-list from PUT); always `canonicalize_segments_data` before walking pairs — until T4340 canonicalizes at write time.
- **T7520 — X-Profile-ID is UNTRUSTED client input; guard OWNERSHIP at the request boundary only.** The `X-Profile-ID` header (and the `hint_profile_id` init fell back to) is client-supplied and was historically only 8-hex FORMAT-checked, so an impersonation start/stop window (new session cookie + stale impersonated profile header on the still-live old page) made `ensure_database()` create a profile.sqlite under the wrong user's dir → R2 orphan. The guard rejects a profile the resolved `get_current_user_id()` does not own, at (A) `db_sync.py`'s header path and (B) `session_init._init_slow_path`'s hint path — the ONLY two places client input first sets the profile context. **NEVER guard inside `ensure_database`/`set_current_profile_id` or anything downstream:** `POST /api/profiles` registers the profile LAST (after ensure_database+sync, T5310), background workers use R2-prefix listing, and `ensure_profile_db_local` runs with user != profile-owner for share materialization — all legitimately create/open a DB for a non-current-context profile. Ownership = membership in the user.sqlite `profiles` registry, cached per-process in `session_init._profile_registry_cache` (invalidated with `_init_cache` on every registry mutation). Frontend closes the emission window with `clearProfileHeader()` on impersonate/logout. See the T7520 frontmatter entry for the full mechanism + test list.

## Migration runner invariants (T4830) — HISTORICAL, mechanism deleted by T5087

`run_all_migrations`/`_migrate_profile_db`/`_migrate_user_db`/`_migrate_user` no longer exist
(T5087, 2026-09-01) — JIT (T5083/T5085, hardened by T8190) is the sole migration mechanism for
`user_db`/`profile_db` now, and its own invariants live in the "T5083 — JIT migrate-at-load-seam"
section below. This section is kept for the DESIGN RATIONALE behind still-live invariants the
bulk runner originated (the sync-baseline rules in particular carried forward into
`migrate_local_profile_db_at_seam`) — do not treat present-tense claims below as current code.

`run_all_migrations` (`app/migrations/__init__.py`) followed these rules:

1. **Registry is authoritative.** Only profiles listed in `user.sqlite.profiles` (`get_profiles`) are migrated. R2 profile dirs not in the registry are **orphans**: logged, collected in `results["users"]["orphans"]`, never migrated, never errored.
2. **Always migrate the canonical R2 copy — but gate the swap on the SYNC baseline, not the schema version (T6410).** `_migrate_profile_db` force-downloads the R2 profile.sqlite each run. Two keep-local guards precede the swap: (a) if the local **schema** is ahead (`user_version > R2 user_version`) the local copy is synced up first; (b) T6410: if the local copy is NOT provably behind R2 on the confirmed **sync baseline** (`get_local_db_version` — mirrors R2's `x-amz-meta-db-version`), keep it and migrate in place, letting the post-migration sync carry both the schema migration and any unsynced writes up together. R2 overwrites local ONLY when `downloaded_sync_version > local_baseline`; a `None` or `0` baseline counts as behind (swap — preserves T6340's guarantee for the unconfirmed case). Schema "at-or-behind" is NOT the same claim as data "at-or-behind": a local write never advances the sync baseline (only a successful upload/restore does), so `baseline == R2 version` means "R2's bytes plus whatever this machine hasn't uploaded yet", not "identical copies" — swapping there would discard writes CAS would otherwise accept.
3. **Fail loud on upload failure.** `sync_db_to_r2_explicit` return value is checked; False → `MigrateResult(status="sync_failed")` → errors[]. A profile that failed to sync is NOT counted as migrated.
4. **Always verify in R2.** After every run (whether or not migrations were applied), `_read_r2_profile_user_version` re-downloads from R2 and asserts `PRAGMA user_version == PROFILE_DB_RUNNER.latest_version`. Mismatch → `MigrateResult(status="not_at_head")` → errors[]. No opt-out flag.
5. **User-level migrated/skipped only when ALL registered profiles verify.** If any registered profile lands in errors[], the user's failing profiles are reported in errors[] and the user is NOT counted as migrated or skipped.
6. **Orphan cleanup is opt-in.** `scripts/cleanup_orphan_profiles.py` archives orphan R2 objects (copies to `orphans/` prefix, then deletes originals). Dry-run by default; `--apply` + manual confirmation required. Never auto-invoked by the runner.
7. **`MigrateResult` status values:** `"ok"` (profile verified at head), `"sync_failed"` (upload returned False), `"not_at_head"` (R2 user_version ≠ head after sync), `"missing"` (registered profile has no R2 object), `"download_failed"` (transient R2 download error).
8. **The swap MUST record a confirmed sync baseline (T6340), and MUST NOT run on a copy that isn't provably behind R2 (T6410).** `_migrate_profile_db` swaps the canonical R2 profile.sqlite in place, so it is a baseline-establishing caller like `ensure_database`'s restore — **any caller that swaps a profile.sqlite file in place must record the swapped-in copy's sync version as its confirmed baseline, atomically with the bytes, or refuse to write.** Precondition (T6410): **never swap a local copy that is NOT provably behind R2 on the sync baseline** — an equal-baseline file may hold committed-but-unuploaded writes, and swapping over it discards writes CAS would otherwise have accepted (post-T6340 that discard uploads at `r2_version+1` and becomes canonical). Keep-and-migrate-in-place instead; the existing post-migration sync ships both. See the T6340 and T6410 sections.

## T6340 — the migration runner must establish a sync baseline for the copy it swaps in

**The bug (staging + prod, every R2-enabled deploy):** `_migrate_profile_db`
(`app/migrations/__init__.py`) force-downloads the canonical R2 `profile.sqlite` and
`shutil.move`s it over the local file, bypassing `ensure_database`. The **sync** version lives in R2
object metadata (`x-amz-meta-db-version`), NOT inside the SQLite bytes, so the swapped-in file has
**no `db_version` row**. `get_local_db_version` then returns `None`, and storage.py's CAS guard
(`storage.py:~1197`, BLOCKING-2: `r2_version > 0 and (current_version is None or ...)`) refuses the
post-migration upload **unconditionally** (R2 always has content). T6160 re-heal then discards the
migrated local file on next access. Net: **no profile_db migration ever reached R2** — v030 (T5800)
and v031 (T5725) sat stuck while `run_all_migrations()` reported `sync_failed` on every profile, with
`r2_version: null` that made a CAS refusal read as an R2 outage. T4315 (never force-push an
unconfirmed DB) and T6160 (clear the baseline so the next access re-pulls) were BOTH behaving
correctly — the runner just never established a baseline for the copy it downloaded.

**The fix (fix the CALLER, guard is byte-identical):**
1. **Record the downloaded copy's sync version as the confirmed baseline after the swap** —
   `set_local_db_version(user_id, profile_id, downloaded_sync_version)` (one call does BOTH the
   in-memory cache and the persisted `db_version` row; there is NO `_persist_db_version`). The later
   `sync_db_to_r2_explicit` then sees `current_version == r2_version` → no conflict → uploads
   `r2_version + 1`.
2. **Atomicity — bytes and version from ONE `get_object`.** `_download_profile_db` now returns
   `(found, sync_version)` from a single `client.get_object` (Body + Metadata together), so the
   recorded baseline provably matches the bytes on disk. A separate HEAD after the download could
   observe a version R2 moved to mid-download; recording THAT would later force-push the OLDER bytes
   at a bumped version — a clobber, worse than the original bug. (`FakeR2.get_object` was extended to
   return `Metadata` for the tests.)
3. **Two refusal shapes, both correct, both now report the real `r2_version`.** The swap path's
   `current_version is None` refusal is the one the fix eliminates. The `local_version > r2_version`
   (local schema AHEAD) branch skips the swap and syncs local up directly; if THAT refuses it is a
   genuinely unconfirmed/stale local copy (`loaded=v2696 r2=v2697`) and refusing is correct — do NOT
   force-push there. Both non-OK paths now populate `MigrateResult.r2_version` via
   `_r2_version_or_none` (one HEAD, FAILURE path only; coerces the `R2VersionResult` enum to `None`
   so it never leaks into JSON as a version). `status` stays `"sync_failed"` (consumed by
   `test_migration_runner.py` scenario (d) and the admin endpoint).
4. **`_migrate_user_db` (user.sqlite) does NOT share the defect.** It uses `ensure_user_database`,
   whose first-access restore calls `sync_user_db_from_r2_if_newer` and records the baseline
   with `set_local_user_db_version(user_id, new_version)` from the SAME download that gated it — so
   the subsequent `sync_user_db_to_r2_explicit` has a confirmed baseline. No manual swap-without-
   baseline, so no fix needed there.
5. **WAL sidecar guard on the swap (review round, MAJOR).** `_migrate_profile_db` runs on a LIVE Fly
   machine serving requests and `shutil.move`s over a WAL-mode `profile.sqlite`. If a `-wal`/`-shm`
   sidecar is present (a live connection holds the file open, or a crash left it), a blind swap lets
   the next connection replay the OLD file's frames onto the swapped-in NEW file (cross-DB page
   mixing) — and the baseline fix (1) would then make that page-mixed result UPLOADABLE at
   `r2_version+1` (pre-baseline-fix, CAS refused the upload so the damage stayed local). So the swap
   now mirrors `database.py`'s first-access restore (`database.py:~727`): refuse with a new
   `MigrateResult.status == "wal_busy"` when `wal_sidecars_present(db_path)`, and call
   `clear_stale_wal_sidecars(db_path)` immediately after a move that proceeded (defense-in-depth for
   the check→move window). A live connection blocks only the swap; a later migrate run retries once
   the file is quiescent. **Invariant refinement:** the "swap in place → record baseline OR refuse"
   rule (list item 8 above) now has TWO refusal triggers — no confirmable sync version (leave baseline
   unset, CAS refuses) AND a live WAL sidecar (`wal_busy`, never swap a file another connection holds).

Also note: a normally-synced R2 object carries an INTERNAL `db_version` row equal to
`metadata_version - 1` (`sync_db_to_r2_explicit` persists the row into the file AFTER the upload at
`database.py:~1521`), so the swapped-in bytes' own row is NOT authoritative for sync — it is stale by
one. `set_local_db_version(downloaded_sync_version)` (INSERT OR REPLACE) overrides it. The
`db_version_row=None` case (never-synced object) is the minority shape; the dominant prod shape is the
stale-by-one row, and both are pinned by tests.

**Tests (HISTORICAL — T5087 deleted both files below along with the bulk primitive they tested):**
`tests/test_t6340_migration_sync_baseline.py` (real storage.py CAS against FakeR2) pinned the bug in
BOTH shapes (swap + re-heal with no persisted row, AND the dominant prod shape with a stale `N-1`
persisted row overridden by the recorded baseline → R2 reaches head, sync `N`→`N+1`), content
preserved, a genuinely stale non-None writer still refused with the real `r2_version`, NOT_FOUND/
ERROR/enum never fabricate a baseline or upload, a mid-download move refuses (never clobbers), a live
WAL sidecar refuses the swap+upload (`wal_busy`), and an end-to-end multi-profile `_migrate_user` that
converges and is idempotent on re-run; only the enum-coercion case (`_r2_version_or_none`, a kept
function) survives, in the same file. `test_migration_runner.py` (T4830) covered five equivalent
scenarios for the bulk primitive and is deleted in full. **The analogous invariants for the SURVIVING
seam primitive (`migrate_local_profile_db_at_seam`) have their OWN separate coverage in
`tests/test_t5083_jit_seam.py`** (wal_busy, CAS refusal, etc. — see the T5083 section below), so this
deletion is not a coverage gap for current code, only for the retired bulk path. **Out of the
container's reach (post-deploy):** staging reaching v031 in R2, and the
prod below-head audit.

## T6350 — the generic durable-sync 503 body lies for a multi-phase handler

**The bug (staging repro 2026-08-02, verified against R2 not just the API):** a "Move to
another profile" that returned `503 {"code":"sync_failed","detail":"...Your reel was not
moved..."}` had ALREADY put both reels in the target profile durably (target R2 `final_videos=2`),
while the source still listed them — the reel existed in BOTH profiles and the user was told it
did not move. `move_reels_to_profile` (`routers/downloads.py`) is 4 phases: phase 0 copies media
source→target prefix; phase 1 inserts target rows + `sync_db_to_r2_explicit(user, target)` (its
OWN durable sync, via the `app.routers.downloads` import); phase 2 deletes source rows +
`conn.commit()`; phase 3 deletes SOURCE-prefix media (best-effort). The SOURCE-side durable sync
is NOT in the handler — it runs in the middleware (`db_sync.py`) AFTER the 200, via
`Depends(durable_sync)`. When it fails/conflicts, the middleware discarded the handler response
and returned the module-level `DURABLE_SYNC_FAILED_RESPONSE` ("not moved") — false, because phases
1+2 already committed. Worse: phase 3 already deleted the source media, so a naive "retry the move"
502s at phase 0 ("Nothing was moved") — no existing gesture could recover the half-applied state.

**The fix (Option 3, report honestly + a completion endpoint).** Options 1 (compensate: delete
target) and 2 (roll-forward queue) were disqualified — the source delete is already `commit()`ed
before any sync result exists, so undoing the target leaves the reel worse off.

1. **Per-route override (`db_sync.py`).** `set_durable_sync_failure_response(request, payload)`
   stashes a truthful body on `request.state` (same ASGI scope as the middleware). The durable
   503 branch now returns `{**(override or DURABLE_SYNC_FAILED_RESPONSE), "sync_state":
   sync_status}`. **Landmine:** `DURABLE_SYNC_FAILED_RESPONSE` is a module-level dict — build a NEW
   dict, never mutate it, or the override leaks across requests. `sync_state` (`ok`/`failed`/
   `conflict`) is now appended to EVERY durable 503, override or not.
2. **Handler (`downloads.py`).** `move_reels_to_profile` gained a `request: Request` param and sets
   the override (`code=move_source_cleanup_failed`, `retryable=True`, `target_committed=True`,
   `moved_ids`, `target_profile_id`; FLAT — the middleware returns it via `content=`, and
   `useMoveReels.js` reads flat-or-nested-under-`detail`) ONLY after the phase-2 commit. A phase-0/1
   abort keeps the honest generic "nothing moved". The phase-2 delete body is extracted to
   `_delete_moved_source_rows(cursor, video_ids) -> int` (NULL project pointer → DELETE row →
   `_delete_orphan_reference_games`), shared verbatim with /finish.
3. **Idempotency guard (phase 1).** Before each target INSERT, skip a `video_id` whose `filename`
   already exists in the target (`SELECT id FROM final_videos WHERE filename = ?` — filename is a
   per-user hash, a sound natural key). A skipped row is NOT appended to `inserted_target_ids`, so
   the phase-1 rollback-on-failure never deletes a row a prior attempt committed.
4. **New endpoint `POST /api/downloads/move-to-profile/finish`** (`Depends(durable_sync)`) is the
   real "idempotent retry": re-runs ONLY the source cleanup. Validates the sibling profile, then
   for every requested id confirms a TARGET row matches the SOURCE row's `filename` (match by
   filename, not id — ids differ across profiles; a source row may be re-healed back from R2). The
   target read uses `ensure_profile_db_local(..., require_fresh=True)` — the presence proof is a
   DESTRUCTIVE gate, so a stale local cache must not stand in for R2; if R2 can't confirm the target
   is current (`ProfileDBRefreshFailed`) it refuses with a retryable 503 and deletes nothing (else a
   reverted-in-R2 target could pass against a stale local copy and lose the reel from BOTH profiles).
   Any id not provably in the target → 409 (`move_target_missing`), delete NOTHING. Otherwise
   `_delete_moved_source_rows` + commit + set the same override. Naturally idempotent: an
   already-deleted source row makes the DELETE a no-op, but the write is still tracked (writes are
   tracked on the SQL verb, not rowcount), so `durable_sync` re-attempts the source upload — the
   retry a prior /finish sync-failure needs.

**Frontend.** `useMoveReels.js` branches on `code === 'move_source_cleanup_failed'` BEFORE the
generic `sync_failed` branch, shows a sticky (`duration: 0`) `toast.error` with a "Finish removing"
action calling `finishMove(videoIds, targetProfileId)` → /finish, returns `{partial: true}`, and
fires a new `onPartial` cb WITHOUT `onMoved`. `DownloadsPanel.jsx`'s `onReelsMovePartial` does NOT
optimistically remove the reels (they still live here) — it re-fetches summary/count +
`notifyCollectionsChanged()` and clears the picker.

**Known follow-up (flagged, NOT in scope):** `POST /clips/raw/save`, `PUT/DELETE /clips/raw/{id}`,
`POST /api/games/finalize-upload`, `POST /api/profiles` still serve the generic body. They are
SINGLE-PHASE (the whole gesture is one commit), so "not moved / not saved" is currently TRUE for
them — no lie today. But the override mechanism now exists; any future multi-phase change on those
routes must set a truthful override, or it reintroduces this class of lie.

**Tests.** `tests/test_t6350_move_half_apply.py` drives the REAL ASGI app (httpx.ASGITransport) so
the middleware runs — the direct-call `_move()` helper in `test_t4850_move_reels.py` bypasses it and
can't reach phase 2. Seam: patch ONLY `app.middleware.db_sync.sync_db_to_r2_explicit` (phase-2
source) to FAILED/CONFLICT; phase 1 uses the `app.routers.downloads` import, left real, so the
target write is genuinely durable against FakeR2 (`MoveFakeR2` adds `copy_object`). Asserts: honest
`move_source_cleanup_failed`+`target_committed` with NO "not moved" text and the TARGET's R2 bytes
holding the reel (FAILED and CONFLICT differ only in `sync_state`); an unrelated durable route
(`DELETE /downloads/{id}`) still returns the generic body (no leak); phase-1 failure still returns
the generic + rolls back; idempotent re-move holds exactly one target row per filename; /finish
happy-path/409/no-op. `FORCE_R2_SYNC_FAILURE` is process-global and faults phase 1 FIRST — it
CANNOT isolate phase 2 (that's what `test_t4850`'s existing "nothing moved" test covers). No e2e
spec for the FAILURE path: the fault seam is at the ASGI-middleware layer, not reachable cleanly
from Playwright.

## T6402 — a process must not CAS-conflict with its own write

**Live staging incident 2026-08-03, root-caused in one pass from T6390's diag payload** (its
first real use — the `db-writer` stamp is what made it solvable):

```
[sync] state -> conflict  db=profile  reason=stale_baseline  loaded=2734  r2=2735
machine=d8933d5f417308  writer=d8933d5f417308/dcce51f3
```

`machine == writer machine`, and staging runs ONE machine (`min_machines_running = 0`,
`auto_stop_machines = "suspend"`), so a cross-machine race was structurally impossible.

**The race.** In `storage.py` the CAS decision ran entirely outside the lock that serialises
the PUT: caller reads the baseline (`database.py: sync_db_to_r2_explicit`) → HEAD → refuse →
*then* `get_upload_lock`. Two concurrent syncs of the same db in one process therefore
interleave, and **both upload the same file on disk**, so the loser's "stale" copy already
contains the winner's data. Per-user concurrency is by design — `_redrain_failed_sync`'s own
comment says fire-and-forget `_background_sync` tasks are not serialised per user. The trigger
was the "Move to My Reels" click: the durable publish sync plus
`recordAchievement('moved_to_my_reels')` (fire-and-forget), with an export-worker sync possibly
still draining.

**Why it was expensive, not cosmetic.** The refusal marks the conflict banner AND calls
`schedule_profile_db_reheal`, which nulls the local baseline so the next request performs a
first-access restore of the **entire** profile.sqlite from R2 (v2735 is not a small file) — the
reported "My Reels took forever to load". It also opens a narrow silent-loss window: rows
committed AFTER the winner's PUT but before the loser's HEAD are not in R2, the loser is
refused, and the re-heal then DISCARDS them (T6160 decision 2 — refused edits are dropped,
never merged). Here that was a quest achievement; on a keyframe `POST /actions` write it would
be a real user edit.

**The fix — two halves, guard never weakened.**
1. **The decision moved inside the lock.** `sync_database_to_r2_with_version` /
   `sync_user_db_to_r2_with_version` now acquire the upload lock first and run
   baseline-check → HEAD → refuse → WAL checkpoint → PUT inside it (extracted as
   `_sync_profile_db_locked` / `_sync_user_db_locked` purely so the locked region reads as one
   unit). This also closes the reverse interleave, where both syncs HEAD the same version and
   PUT the same `new_version` — a version collision that other machines' CAS relies on.
   The `lock_timeout` bail-out stays ORDERED BEFORE the HEAD, so a deferred sync still costs
   zero R2 calls.
2. **`_OWN_UPLOAD_VERSIONS`** — the version this process last PUT per R2 key, recorded under
   the lock BEFORE releasing it. The refusal is skipped when `r2_version` EQUALS our own
   recorded version. **Equality, not a range**: a foreign writer always lands strictly above our
   own version and still refuses; `_is_own_upload_version` never rescues an unconfirmed (None)
   baseline; and the **baseline is never mutated**, so `new_version` arithmetic is byte-identical
   for every caller.

**Landmine — why half 2 is not optional.** The caller's `set_local_db_version` runs AFTER the
primitive returns, i.e. OUTSIDE the lock. So a sync that waited on the lock still re-reads the
OLD baseline; re-reading `get_local_db_version` under the lock does NOT close the race. The
own-upload record is the only in-lock evidence that R2's current version is ours.
**Rejected approach (pinned by tests):** raising `current_version` to the process's high-water
mark. It changes `new_version` for every caller and broke 11 existing tests in
`test_version_conflict` / `test_t6160` / `test_t6340`.

**Accepted trade-off.** The lock is now held across the HEAD (~50-100ms) and the WAL checkpoint
(≤2s busy timeout), so the middleware's `lock_timeout = 0.5s` deferral may fire slightly more
often. A deferral is benign (marks `.sync_pending`, healed by the re-drain or the next write); a
false conflict was not. Checkpoint-then-PUT is now atomic w.r.t. other syncs, which is
independently correct.

**Known residual (pre-existing, NOT introduced here) — and the two assumptions that make it
unreachable today.** R2 has no compare-and-swap primitive, so two independent WRITERS can still
both compute `r2+1` and PUT the same version number. That collision predates T6402 and is
unchanged by it. It is currently UNREACHABLE, because both halves of "one writer" hold:

1. **One machine.** `flyctl machines list` 2026-08-03: prod = 1 (`843e15c2d26718`), staging = 1
   (`d8933d5f417308`). `min_machines_running` is 1 (prod) / 0 (staging) and nothing autoscales
   the machine COUNT.
2. **One process per machine.** `Dockerfile`: `CMD ["uvicorn", "app.main:app", ...]` — no
   `--workers`. The whole sync design already depends on this (the in-memory
   `_user_db_versions` / `_initialized_user_dbs` / `_db_versions` caches and machine pinning are
   all per-process and would be incoherent across workers).

**So `get_upload_lock` (a `threading.Lock`, per-PROCESS) covers every writer that exists.**
Decision + checkpoint + PUT are serialised for all of them, so no two writers can compute the
same `r2+1`. **Scaling to 2+ machines, OR adding `--workers` to uvicorn, makes this live again
immediately and silently** — same for `_OWN_UPLOAD_VERSIONS`, which is also per-process. Either
change needs a real distributed guard (conditional PUT / lease), not this lock. Decision
2026-08-03 (user): not worth tasking while single-machine holds.

**Tests:** `tests/test_t6402_cas_self_race.py` — the self-conflict reproduced RED-first
deterministically (no threads: pass the baseline the loser captured before the winner advanced
it), the post-winner-PUT row proven to reach R2, the wrapper path proven to return
`SyncResult.OK` with no `.sync_conflict` marker, plus the guard half: a foreign writer ahead
still refuses, a foreign writer ahead OF OUR OWN UPLOAD still refuses (the forgiveness is not a
blanket amnesty), an unconfirmed baseline still refuses, exactly one HEAD per sync, zero on
`skip_version_check`, and zero on the `lock_timeout` bail-out. Existing suites green:
t4310 / t4315 / t5340 / t5870 / t5920 / t6160 / t6340 / t6390 / version_conflict / upload_lock
(120 passed), plus background_sync / sync_pending / sync_retry / sync_status /
export_worker_sync / t4050_durable_sync / performance.
**Unrelated pre-existing bug fixed in passing:** `test_t6340_migration_sync_baseline.py`'s
`_r2_bytes_user_version` / `_r2_games_count` helpers left a sqlite connection open before
`p.unlink()`, which raises `PermissionError` on Windows (WinError 32) and failed 5 tests whose
assertions had already passed. Confirmed identical on clean master; Linux CI hid it.

## T6390 — per-DB marker scoping + sync-conflict diagnostics

**Two problems, one task.** A CAS-refusal banner hit staging and could not be root-caused (browser
console silent, the `[SYNC_CONFLICT]` CRITICAL already scrolled out of the ~90s `flyctl logs` window,
and even when read it lacked req_id/method/path and *who moved R2 ahead*). Scoping the fix surfaced a
real correctness defect: `.sync_conflict`/`.sync_failed` were per-USER files describing per-DB state.

**Part B — the defect (fixed by SCOPING, not more reassertions).** One user has `user.sqlite` plus a
`profile.sqlite` per profile, but a single `USER_DATA_BASE/{user_id}/.sync_conflict` spoke for all of
them, and every success path called `clear_sync_conflict(user_id)` unconditionally, so **a success on
one db erased a live conflict on another** (silent-stale-data, T6040 class). Three verified stomps: (a)
`retry_pending_sync`'s DETERMINISTIC self-stomp — the profile branch marks a conflict (`:375`), the
user branch's success clears it (`:393`) within one call → the function returned a bare `False` and
`_redrain`'s `has_sync_conflict` bail-out read the cleared marker, so a **CAS conflict (documented
not-blind-retryable) was blind-retried to exhaustion and reported as generic `failed`**; (b) a
`user.sqlite`-only `_background_sync` success wiped a live profile conflict; (c) `sync_db_to_r2_explicit`
success symmetric. The T4310 post-`gather` reassertion patched only the both-DBs-written path and
reasserted from *this request's* two statuses (still cross-DB).

**The scoping.** A marker is now a PER-SCOPE file `USER_DATA_BASE/{user_id}/.sync_{kind}.{scope}` where
`scope` = `USER_DB_SCOPE = "user"` (user.sqlite) or the `profile_id` (a profile DB). `mark_sync_conflict
(user_id, scope, diag)` / `clear_sync_conflict(user_id, scope)` touch only that scope; `scope=None`
clears ALL scopes + the legacy bare file and is RESERVED for genuine full-recovery callers
(`set_sync_failed(user_id, False)`, `/api/retry-sync` success) and legacy tolerance — NOT a single-DB
success. `has_sync_conflict(user_id)` = legacy-bare-file OR any `.sync_conflict.*` scope (header
priority `conflict > failed > pending` unchanged). **Separate files, NOT one shared JSON set**, because
profile+user sync in PARALLEL threads (`_background_sync`'s `gather`) — each thread writes only its own
scope, so the race the T4310 reassertion papered over is structurally impossible and **that reassertion
is DELETED**. Backward-compatible signatures (`scope=None` → legacy bare file on mark, clear-all on
clear) keep existing behaviour tests green; production call sites pass explicit scopes.

**`retry_pending_sync` returns an aggregate `SyncResult`** (CONFLICT if either db conflicted, else
FAILED, else OK; truthy only on OK so `if ok:` callers are unaffected). `_redrain_failed_sync` decides
"stop — CAS conflict, not blind-retryable" from that RETURN VALUE, not by re-reading the marker file the
self-stomp defeated. `set_sync_failed(user_id, failed, profile_id=None)` on the error path marks the
session's OWN scopes (user + request profile); the FAILED marker in `_background_sync` is written only
for the scope(s) whose status is actually `failed`.

**Part A — diagnostics.** Markers carry a JSON payload (`ts, reason, db, profile_id, loaded, r2,
machine, req_id, method, path, writer, written_at`); `reason ∈ {stale_baseline, unconfirmed_baseline,
upload_failed, checkpoint_busy, legacy}`. `unconfirmed_baseline` (loaded=None, the T6340/T4315 class) vs
`stale_baseline` (loaded=vN, the T6160 class) are the same banner but different bugs — now discriminated
on BOTH sides. **Writer identity:** `storage.py` stamps `db-writer` (`{machine}/{req_id}`) +
`db-written-at` (ISO) next to `db-version` on every upload (`_db_writer_metadata()`), and reads them on
a conflict from the SAME HEAD via `get_db_version_from_r2(..., return_metadata=True)` — **zero extra R2
calls** (T6160's constraint). Legacy R2 objects have no writer → `writer=None` (honest "unknown", NOT a
fabricated default). The two `[SYNC_CONFLICT]` CRITICALs now include `reason writer req_id method path`
(method/path via new `_current_method`/`_current_path` ContextVars set next to `req_id` in
`db_sync.dispatch`; they propagate into `_background_sync`'s `to_thread` children via the copied
context). **Return contract:** the two upload primitives take `with_diag=False` and append a third
`diag` element only when True (the `*_explicit` wrappers + `retry_pending_sync` pass it) — default
2-tuple preserves every other caller/test. **`X-Sync-Diag` header:** `read_sync_diag(user_id)` returns
the winning marker's payload (conflict > failed; tolerates the legacy float body → `reason=legacy`),
rendered `k=v;k=v` by `_render_sync_diag` and set alongside `X-Sync-Status` for conflict/failed only.
**LANDMINE (fixed):** it is ADDED to `main.py:217` `expose_headers` — a new response header is invisible
to cross-origin JS (staging/prod frontend is a different origin) otherwise; same-origin dev hides this.

**Client (`syncStore.js`).** `checkSyncStatus(response, input, init)` emits ONE `console.error` on the
TRANSITION into conflict/failed (gated on the state change → no console spam on repeat responses)
naming reason/db/loaded/r2/machine/writer/req_id (parsed from `X-Sync-Diag` via `parseSyncDiag`) +
method+URL + `hasAttemptedWrite`. A MISSING diag header logs a loud "check expose_headers/CORS" marker,
never a fake default. `retrySyncToR2` now logs all three outcomes (restored / success / failure) +
the catch, instead of `catch { return false }` swallowing everything.

**Success path stays silent** (verbose logging on FAILURE/CONFLICT + one line per state TRANSITION
only — protects T2880/T3380's hot path). **CAS guard BYTE-IDENTICAL** — no fallback, no auto-merge, no
blind-retry, no weakening (T4310/T4315). No schema migration (markers are ephemeral filesystem state).

**Tests:** `tests/test_t6390_marker_scoping.py` (the three stomps reproduced RED-first, legacy
tolerance, diag payload, unconfirmed-vs-stale reason); `tests/test_t6390_qa_evidence.py` (real ASGI app
+ FakeR2: the CRITICAL names req_id/method/path/writer/reason, unconfirmed≠stale, and `X-Sync-Diag` is
present AND in `access-control-expose-headers` cross-origin); `src/frontend/src/stores/syncStore.test.js`
(parseSyncDiag, transition logging + no-spam + unconfirmed≠stale + missing-header-loud, retry three
outcomes). Updated for the new contracts (with a note, never silently): `test_t4310`'s
`TestParallelSyncMarkerRaceFixed` (rewritten to drive REAL scoped markers since the reassertion is
gone), `test_sync_retry`/`test_export_worker_sync`/`test_version_conflict`/`test_performance`/`test_t6160`
(3-tuple primitive returns + SyncResult aggregate). **Out of the container's reach (needs a browser +
real R2 on staging):** the full live-drive banner screenshot per the QA phase.

## Overlay action failure visibility (T4900 / prod bug 31p)

**Root cause of 31p (2026-07-12, `feature/T4900`):** `CORSMiddleware` was the INNERMOST
HTTP middleware. Auth 401s and Fly machine-pinning Responses produced by
`RequestContextMiddleware` (outside CORS) carried NO `Access-Control-Allow-*` headers.
Cross-origin browsers blocked those responses and surfaced them as opaque `"TypeError:
Failed to fetch"` — exactly the 188 identical failures the reporter saw while video
streaming (same-origin) kept working. Overlay action POSTs hit a 5xx (backend restart,
machine migration) → preflight got no CORS → opaque network error in the browser.

**Fix (main.py):** `CORSMiddleware` moved to be the OUTERMOST HTTP middleware (added
LAST in main.py, after all other `add_middleware` calls). Every response — success, 4xx,
5xx, and preflight — now carries CORS headers before reaching the browser.

**Frontend failure visibility (overlayActionStore.js):** Before T4900 every failed
overlay action POST was swallowed with a bare `console.error`. Now:
- `dispatchOverlayAction(label, run)` wraps every surgical overlay action with bounded
  retry (2 retries, 400ms base backoff — still the same gesture, NOT reactive).
- On final failure: action queued in `failedActions[]`, persistent toast "Your edits
  aren't saving — Retry" (duration: 0) surfaces via the shared Toast.
- `_surfaceFailureToast` reconciles against `useToastStore` before skipping — a user
  who dismissed the toast (X button) gets a fresh warning on the next failure (stale
  `_toastId` would have suppressed it).
- `retryFailedOverlayActions()` re-sends queued actions on gesture (Retry button or
  export gate). Clears state on success; re-surfaces toast on continued failure.
- `reset()` called on project unmount (`useEffect` cleanup keyed on `projectId`) so
  failures from a prior project never leak into the next.

**Export gate (ExportButtonContainer.jsx):**
- `hasUnsavedOverlayFailures = failedActions.length > 0` (read from store, not prop-drilled).
- If true AND in overlay mode: `handleExport` shows an inline error message, calls
  `retryFailedOverlayActions()`, and returns — no render POST is fired.
- `buttonTitle` shows "Some edits haven't saved — retry saving before exporting" as tooltip.

**Wire-up (OverlayScreen.jsx):**
- All surgical action handlers (`wrappedAddHighlightRegion`, `wrappedMoveHighlightRegionEnd`,
  `wrappedAddHighlightRegionKeyframe`, etc.) now call `dispatchOverlayAction(...)` instead
  of bare `overlayActions.*()`.
- `reset()` fired on overlay teardown via `useEffect(() => () => reset(), [projectId])`.

**Tests:**
- `src/frontend/src/stores/overlayActionStore.test.js` (9 unit tests): happy path, retry
  transient, failure burst, dedup toast, stale-toast re-surface, retry-success,
  retry-fail-again, export-gate selector, reset.
- `src/backend/tests/test_t4900_cors_error_headers.py`: 401 error response carries CORS
  header; OPTIONS preflight on overlay/actions is answered correctly.
- `src/backend/tests/test_t4900_overlay_keyframe_persistence.py`: render read path
  `_region_bounds`/`_keyframes_within_bounds` tolerates camelCase + snake_case, keeps
  keyframes past extended boundary, drops genuinely outside ones; integration: actions →
  blob the render reads; persistence-gap simulation (31p failure mode reproduced).
- E2E spec: `src/frontend/e2e/T4900-overlay-action-failure-visibility.spec.js`.

**Invariant added:** Overlay surgical action fire-and-forget is now failure-visible: the
Retry affordance is gesture-initiated, NOT a background reactive loop. Do NOT add reactive
retry logic (`useEffect` watching failure state to re-send). The only allowed persistence-
retry trigger is an explicit user gesture (Retry button or export button auto-retry).

## Overlay region seed keyframes + retryability (prod report 2026-07-29)

**Symptom:** adding a spotlight then dragging the circle near the region boundary looped
`[overlayActions] Action failed: Keyframe at 2.0s not found` and pinned an unclearable
"Your edits aren't saving — Retry" toast (Retry re-failed identically; only a refresh cleared it).

**Root cause — memory/DB divergence at region creation.** `useHighlightRegions.addRegion`
materializes TWO boundary keyframes (`startFrame`/`endFrame`, from `defaultHighlightForRegion`)
so the new region shows a spotlight instantly, but `create_region` stored `keyframes: []`.
Two consequences, both live in prod:
1. **Export dropped the spotlight.** The render endpoint's `has_keyframes` check
   (`overlay.py`) skips GPU processing entirely when every region is keyframe-less, so a
   region the user added but never dragged exported with no highlight at all. A region only
   got persisted keyframes as a side effect of the user's first drag.
2. **The first boundary drag 400'd.** `addOrUpdateKeyframe` MOVES a keyframe within
   `MIN_KEYFRAME_DISTANCE_FRAMES` (5) onto the current frame and reports `movedFromFrame`;
   `persistKeyframeEdit` mirrors a move as delete(old)+add(new). The delete targeted a
   keyframe that only ever existed in memory. `2.0s` in the report = `DEFAULT_REGION_DURATION`.

**Fixes (`fix/overlay-seeded-keyframes-not-persisted`):**
- `createRegion(projectId, start, end, regionId, keyframes)` sends the seed keyframes;
  `OverlayScreen.wrappedAddHighlightRegion` converts `frame`→`time` with the SAME framerate
  the hook snapped with (exact equality, so `_keyframes_within_bounds` keeps them).
  Backend `OverlayKeyframePayload` types them and `create_region` stores them time-sorted.
- `delete_keyframe` on an absent keyframe is a **no-op success**, not a 400 — the gesture's
  postcondition already holds, and it is half of a snap-MOVE. A missing REGION is still a
  400 (genuine mismatch stays visible).
- **Retryability split (`isRetryableFailure` in overlayActionStore):** `sendAction` now
  returns the HTTP `status`. 4xx (except 408/429) = the server's verdict on this exact
  request → `runWithRetry` stops after ONE attempt, the action is NOT queued (queuing jams
  the export gate on work that can never be sent), and a dismissible no-Retry toast plus a
  `console.error` reports it. No status (never reached the server) / 5xx / 408 / 429 keep the
  old queue+Retry behavior. `retryFailedOverlayActions` also drops a queued action that has
  turned deterministic, so the queue can always drain.

**Legacy data:** regions stored pre-fix keep `keyframes: []`. No migration — the client-side
seed depends on `pickPrimaryDetectionBox` over per-region detections, and a backend
re-derivation would write a DIFFERENT (frame-centered) spotlight than the editor shows for
regions that have detections. They self-heal on the user's next keyframe edit (now that
delete is idempotent); until then the render endpoint logs a WARNING naming the enabled
region that will draw nothing.

**Tests:** `src/backend/tests/test_overlay_seeded_keyframes.py` (seed keyframes stored +
sorted, bare create still works, idempotent delete, real delete still deletes, missing region
still 400s, full snap-move round trip); `src/frontend/src/api/overlayActions.test.js`
(payload shape, status surfacing); `overlayActionStore.test.js` retryability block.

**Landmine:** `restoreRegions` ALSO materializes boundary keyframes when stored keyframes are
empty. That fixup is memory-only and must stay that way (persisting it would be reactive
persistence). The seed is persisted at the CREATE gesture, which is where it belongs.

## T5070 — Blocking update gate + version handshake + ordered state-sync flow

In-session PWA update is a **blocking, non-dismissible gate** (`UpdateGateModal` + `updateGateStore`), replacing the old dismissible toast (T4150). Paints above the login surface (z-[60] > AuthGateModal z-50) so an un-updated client can't log in or interact. **Tbug40p — the gate is raised SOLELY by a truth comparison; NOT by a waiting SW.** A waiting service worker no longer, by itself, blocks the user (that was bug40: a perpetually-`waiting` SW on Safari re-nagged on every wake because `onReturnToApp` gated on `registration.waiting`). The SW is now purely the swap *mechanism*.

**Truth-based version gate (Tbug40p — replaced the T5070 sha-mismatch heuristic):** the decision is `serverBuild > clientBuild` (strictly), where both are a **monotonic, orderable build number** = `git rev-list --count HEAD` (identical for FE and BE built from the same commit — that's why it's comparable; git shas are NOT orderable and are kept only for logs/bug-reports). Client bakes its own number into the bundle via the `__APP_BUILD__` vite define (`vite.config.js`), immutable for the loaded page — it is truth, not a latched observation. Backend advertises `X-App-Build` on every response (`AppVersionHeaderMiddleware`, outermost so it survives 401s/preflight) + `GET /api/version` `build`; value = `APP_BUILD` build-arg (Dockerfile ARG/ENV; deploy-backend.yml + deploy_production.sh compute `git rev-list --count HEAD` — **both need `fetch-depth: 0`** or a shallow clone counts 1; `version.py` falls back to `0` locally, and `0 > N` is always false so a dev/misconfigured server never false-gates). Client SSOT is `appVersion.checkServerVersion(X-App-Build)`: the passive `sessionInit.js` interceptor calls it on EVERY /api response (zero extra requests); `pwaUpdate.js` adds an on-load + resume (visibilitychange/pageshow) poll (5-min throttle). Why this kills the bug class: a running build can't re-detect ITSELF (no ack needed — the loaded bundle IS the acknowledgement), and a straggler backend on a LOWER number is `<= clientBuild` so it never gates — **no debounce/candidate machinery needed** (all deleted: `bootVersion`/`candidateVersion`/`acknowledgedVersion`/sessionStorage ack).

**Ordered update flow (barriered):** Update-now click (gesture) → durable flush (`updateFlush.flushDurableState`, awaits R2 confirmation) → **`pwaUpdate.landLatestBundle`** (Objective 2 — actually land the new bundle, SW included): `registration.update()` → if a bundle is waiting, `updateSW(true)` (skipWaiting; workbox reloads on `controllerchange`) → **if controllerchange doesn't fire within a timeout (Safari quirk), BUST the stale controller** (`postMessage SKIP_WAITING` + `registration.unregister()`) then `location.reload()` so the reload can't be served old precache. A plain `location.reload()` alone would be served the STALE precached `index.html` by the old SW and never escape the gate. After reload the fresh bundle's higher `__APP_BUILD__` makes the gate stay down (a clean in-memory reboot; session cookie preserved → session-init re-runs from R2). **`needsMigration` is a seam only** (Tbug40p decision #3): the data-schema axis (`PRAGMA user_version`) would route through a heavier sync→lock→migrate path, but today every app-code bump routes to the clean reload; the seam is dead until a real schema-advancing deploy wires an `X-Data-Schema` compare in `checkServerVersion`. Any flush failure keeps the gate up — never a reload with unsynced state.

**Persistence-rule compliance (landmines):** step-3 flush is invoked ONLY from the onClick gesture (never a reactive useEffect). It is a DRAIN+VERIFY, not a full-state dump: drains the overlay retry queue and calls `saveCurrentClipState` ONLY when `focusStore.framingChangedSinceExport` is true — a clean/mid-restore editor must NOT trigger a full-state save (the T4020 empty-shadow-save class). **Logged-out safety (was a guaranteed lockout):** a logged-out/expired-session user has no per-user dirty state — `runUpdate` skips the barrier when `!useAuthStore.isAuthenticated`, and `flushDurableState` treats a 401 from `POST /api/sync/flush-verify` as "nothing to flush → proceed", NOT a failure. Without this, every deploy permanently stranded anyone on the login surface.

**Tests:** `appVersion.test.js` (truth compare: gate iff serverBuild > clientBuild; equal/straggler/null/0 never gate), `updateGateStore.test.js` (flush barrier before reloader; flush-fail keeps gate up; needsMigration seam), `pwaUpdate.test.js` (onNeedRefresh no-op; resume never gates on waiting SW; `landLatestBundle` SW-bust escalation incl. the controllerchange-timeout → unregister+reload path), `updateFlush.test.js` (401 + dirty-flag); backend `test_t5070_version_and_flush_verify.py` (X-App-Build header/endpoint + APP_BUILD env). **Safari real-device pass (is a worker actually stuck `waiting`? does one Update clear it?) is a documented MANUAL step — SW activation is not container-verifiable.**

## T4310 — R2 CAS conflict detection (upload side)

**CAS is back ON for every async/worker/shutdown R2 upload; the request-path fast sync still skips the HEAD (T1020/T2720 intact).** The conflict check (T950, `storage.py: sync_database_to_r2_with_version` / `sync_user_db_to_r2_with_version`) HEADs R2, and if `r2_version > current_version` it refuses the upload and returns the R2 version — but every prod call site passed `skip_version_check=True`, compiled out by T1020 purely for request-thread latency (not false positives). **Round 2 (MAJOR-2):** the conflict branch used to also re-download the newer R2 copy over the local file; that was DEAD CODE pre-T4310 (every caller skipped the check) but became LIVE on the normal write path, where `profile.sqlite` is `journal_mode=WAL` and `_background_sync` runs OUTSIDE the per-user write lock — swapping the main DB file while a stale `-wal` from the OLD file sits beside it lets the next connection recover unrelated frames onto the fresh file (cross-DB page mixing). The re-download was REMOVED; refusing alone is safe because the baseline never advances on a refusal (below), so the same conflict is simply refused again on every retry until T4315's restore path heals the local copy under the write lock.

**Where the flag lives now:** `sync_db_to_r2_explicit(user_id, profile_id, lock_timeout=None, skip_version_check=False)` and `sync_user_db_to_r2_explicit(user_id, lock_timeout=None, skip_version_check=False)` (database.py) default to CAS ON. Every existing caller of these two functions is already off the request's event loop (`asyncio.to_thread` in `_background_sync`/admin/`downloads.py`; genuine background workers `export_worker.py`/`sweep_scheduler.py`/`auto_export.py`; admin batch jobs `poster.py`/`migrations/__init__.py`), so they get CAS for free with zero request-latency cost — this is the mechanism, not a per-caller edit. `retry_pending_sync` (db_sync.py, always invoked via `asyncio.to_thread` from the write path) and the SIGTERM shutdown loops (`main.py: _graceful_shutdown`) call the lower-level `sync_database_to_r2_with_version`/`sync_user_db_to_r2_with_version` directly with `skip_version_check=False` for the same reason.

**The two exceptions (still `skip_version_check=True`, explicit at the call site):** `profiles.py: create_profile` and `payments.py: stripe_webhook` call `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit` SYNCHRONOUSLY inline in an `async def` request handler — never wrapped in `asyncio.to_thread` — so a HEAD there really would add latency to the request's own event-loop turn (the T2720 regression). Any NEW direct (non-to_thread) call site from a request handler must do the same or it silently reintroduces T2720. **The legacy `sync_db_to_cloud` IS used by prod** — `POST /api/retry-sync` (`health.py`) calls it (round 1 incorrectly claimed otherwise); it now also defaults to `skip_version_check=False` since it's a manual-retry gesture, not a hot request path, so a HEAD there is free. `sync_db_to_cloud_if_writes` remains unused by prod.

**`SyncResult` 3-state contract** (database.py, `str, Enum`: `OK`/`CONFLICT`/`FAILED`, `__bool__` returns `True` only for `OK`) replaces the old bool return of `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit`. Truthy-only-on-OK means every pre-existing `if not sync_x_to_r2_explicit(...)` caller is unaffected (CONFLICT and FAILED both still read as "not success", same as before) — only code that explicitly compares `== SyncResult.CONFLICT` (the middleware) distinguishes them. Two boundary functions that propagate the result into a JSON response (`admin.py: _persist_target_user_db`, `export_helpers.py: sync_export_db_to_r2`, both declared `-> bool`) explicitly `bool()`-coerce before returning, so the enum's string value never leaks into an API response that used to carry a real boolean.

**Conflict recovery — freeze + escalate + Retry, never auto-merge:** on a CAS refusal, `storage.py` refuses the upload (no re-download, see above) and `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit` leave the local version baseline FROZEN at `current_version` — it must never advance without a confirmed refresh, or the NEXT attempt would compare stale local data against "confirmed" R2 data and silently force-push it (the exact clobber CAS exists to prevent). They call `mark_sync_conflict(user_id)` (parallel `.sync_conflict` file, database.py) for ops-visible differentiation from a generic transient failure. The EXISTING `.sync_pending`/retry UX (T4110/T4900) is unchanged — a conflict still surfaces as "edits aren't saving — Retry" because `_background_sync` only calls `clear_sync_pending` on `"ok"`, never on `"conflict"`. `_background_sync`'s `db_status`/`user_status`/foreign-DB-loop tracking now actually reaches `sync_status = "conflict"` (previously dead code — `db_status` could only ever be `"ok"`/`"failed"`). `retry_pending_sync` gets the identical treatment. **`X-Sync-Status` distinguishes the two** (round 2 MAJOR-1 follow-through): the header is `"conflict"` when `has_sync_conflict(user_id)`, else `"failed"` — the frontend (`syncStore.js`) treats both the same for the Retry banner, so this is ops-visibility only, not a UX branch. `set_sync_failed(user_id, False)` clears BOTH `.sync_pending` and `.sync_conflict` on a real success, so a stale conflict marker can't mislabel a later plain failure. The two markers can race when profile/user.sqlite sync in parallel (`_background_sync`'s `asyncio.gather` branch) — one thread's clear can stomp the other's concurrent mark; fixed by reasserting the correct marker once, authoritatively, after both threads join.

**Migration/rollout note:** every R2 object already carries `x-amz-meta-db-version`; legacy objects without it read as `0`, and the conflict guard (`r2_version > 0 and current_version is not None`) treats `0` as no-conflict, so CAS is inert on pre-metadata objects. The FIRST write after deploy from any machine holding a stale copy will refuse (repeatedly, until T4315's restore heals it) — a support spike of Retry toasts right after this deploy is expected, not a regression.

**What CAS compares:** the sync version (R2 `x-amz-meta-db-version` vs. the in-memory `_user_db_versions`/`_user_sqlite_versions` loaded-from cache) — NEVER `PRAGMA user_version` (the schema/migration counter, independent system, see "Version model" above).

**Known residual (by design, not a T4310 bug — this is T4315's job):** a writer whose loaded version is `None` (cold-cache background worker that never restored-if-newer) skips the conflict guard entirely (`current_version is not None` in the storage.py check). T4310 doesn't worsen this — it's the exact pre-existing gap; T4315 (restore-if-newer on write paths) closes it by guaranteeing every writer has a real baseline before it writes.

**Tests:** `tests/test_t4310_r2_cas_conflict.py` — real CAS against a fake R2 (stale writer refused + baseline FROZEN, no upload, regression-pinning the arshia move_reels class; matching version uploads normally); `_background_sync` conflict routing (marker stays set, distinct from "ok"); `retry_pending_sync` conflict handling; the two request-thread exceptions verified to still pass `skip_version_check=True`; `/api/retry-sync` (`test_sync_status.py`) verified to refuse a stale local on a conflict, never regress the R2 version, and never report success. `tests/test_performance.py::TestR2SyncSkipHead` (unchanged, still green) pins that `skip_version_check=True` skips the HEAD at the `storage.py` primitive level — T4310 doesn't touch that primitive, only which callers pass which flag.

## T4315 — Restore-if-newer for write paths (restore side, sibling of T4310)

**Round 2 note:** a fresh-context reviewer found 2 BLOCKING + 5 MAJOR issues in round 1 (a new stale-authoritative-DB vector, the design's stated `current_version is None` interlock hole left open, an event-loop-blocking regression, an unsynchronized WAL "fix" that could destroy committed data, and non-structural enforcement). All closed in round 2.

**Round 3 note:** round 2's OWN fixes introduced 2 NEW blocking issues, found by a third reviewer pass: (NEW-A) the recipient DB was uploaded to R2 BEFORE its WAL was checkpointed, shipping stale bytes at a NEWER version number (worse than doing nothing — see below); (NEW-B) the WAL-in-use guard ran BEFORE the R2 version check, refusing even when nothing needed downloading, silently breaking T3230 login share materialization. Both closed below; this section describes the POST-round-3 state. Also closed: NEW-D (round 2's structural guard put blocking R2 I/O back on the event loop at 4 call sites round 2 missed) and NEW-E (a test-patching bug that made an assertion vacuous).

**Round 4 note:** round 3's OWN checkpoint fix for NEW-A had a bug — `PRAGMA wal_checkpoint` does not raise on contention, it returns `(busy, log, checkpointed)` and silently leaves frames in the WAL, so a CONTENDED checkpoint (real, if not routine — `session_init.py`'s concurrent steps hold their own connections only for short transactions, so the actual window is narrow, but a checkpoint landing inside it is a genuine possibility, not a hypothetical) shipped the exact stale-bytes-at-a-newer-version failure NEW-A was meant to close, plus a new ~30s stall from the connection's inherited `busy_timeout=30000`. Fixed below. Also fixed: `shares.py`'s collection-share route still *awaited* the offloaded milestone call (its sibling route's `BackgroundTasks.add_task` pattern truly gets it off the response path; round 3's `asyncio.to_thread` alone did not), and a refused materialization in `games.py`'s `share_game`/`share_playback` had no pending-share fallback.

**The shared write-path guard: `confirm_current_before_write(user_id, profile_id=None)`** (`app/services/db_refresh.py`) is the ONE place "confirm this copy is current, or refuse" lives:
- `profile_id=None` -> user.sqlite, via `services/user_db.py: ensure_user_database_fresh(user_id)` — restore-if-newer sibling of `ensure_user_database` (which only restores on `local_version is None`, i.e. first access). Calls `sync_user_db_from_r2_if_newer` **regardless of whether `local_version` is already set**, so an out-of-band R2 edit or a write that landed on another machine while this one was pinned away is picked up before the next write. Raises `RefreshFailed` on an R2 error, and (round 2) ALSO refuses when `-wal`/`-shm` sidecars are present (see WAL safety below) — never proceeds on an unconfirmed OR possibly-in-use copy.
- `profile_id` given -> profile.sqlite, via `materialization.py: ensure_profile_db_local(user_id, profile_id, require_fresh=True)` (a5ff3e48, move_reels).

**Structural enforcement (round 2, closes "per-caller guard"):** `services/user_db.py: get_user_db_connection(user_id)` itself now confirms freshness whenever the resolved `user_id` differs from the request's own ambient session user — a NEW foreign-write call site that forgets to call `confirm_current_before_write` explicitly still gets the guard. A short (`5s`) "recently confirmed" marker (`db_refresh.user_db_was_recently_confirmed`) lets a caller that DID confirm explicitly (admin.py, payments.py) skip the redundant HEAD on the same call chain — critically, this avoids reintroducing a blocking HEAD onto whatever thread that first confirm was carefully kept off of. Outside a request context (background workers, `get_current_user_id()` raises) this falls back to the unchanged lenient `ensure_user_database` — workers still opt in explicitly.

**Callers wired (all confirm off the event-loop thread where the ambient request context makes that necessary — see MAJOR-2 below):**
- `admin.py: _refresh_target_user_db` — thin wrapper (`asyncio.to_thread`-called by its own routes, unchanged from round 1); "warn but still grant" is this call site's own policy choice.
- `payments.py` — ALL FOUR credit-grant sites (`confirm_payment_intent`, both webhook branches, `verify_session`) now call `_confirm_user_db_fresh_or_503(user_id)` (`await asyncio.to_thread(confirm_current_before_write, user_id)`) before `grant_credits`. A refusal is a retryable 503 (`code: sync_failed`) — safe because `grant_credits` is idempotent via the UNIQUE index on `(user_id, source, reference_id)`, so Stripe's webhook redelivery or the frontend's next verify/confirm call completes it without a double-grant. Round 1 left this unprotected entirely (money, on a machine that might hold a stale copy) — round-2 MAJOR-1.
- `materialization.py: materialize_game_share` — confirms the **recipient** via `ensure_profile_db_local(require_fresh=True)` BEFORE opening `sharer_conn` (round 2 MINOR: avoids holding the sharer's connection open across the recipient's network HEAD/download), then AFTER commit explicitly uploads the recipient's profile.sqlite (`sync_db_to_r2_explicit`) and refuses to call `mark_game_share_materialized`/`record_referral` if that upload fails (round-2 BLOCKING-1 — see below). All 5 call sites (`games.py` x2, `clips.py` x2, `session_init.py`) now offload the call via `asyncio.to_thread` (round-2 MAJOR-2); `session_init.py`'s T3230 pending-share block additionally moved to a background daemon thread since `user_session_init` itself is called synchronously ON the event-loop thread by the request middleware.

**BLOCKING-1 (round 2, closed — but see NEW-A below): recipient_conn is a raw `sqlite3.Connection`, invisible to sync.** `_open_profile_db` bypasses `TrackedConnection`, so the middleware's foreign-DB sync (`get_request_written_*_dbs`) never saw this write — for ANY recipient, not just a newly-downloaded one (round 1's `require_fresh` download made the write reachable even when the recipient wasn't already locally cached, which is what turned a latent gap into a guaranteed loss). Fix: `materialize_game_share` now calls `sync_db_to_r2_explicit(recipient_user_id, recipient_profile_id)` explicitly after commit and raises `ProfileDBRefreshFailed` (skipping the Postgres `mark_game_share_materialized`/`record_referral` calls) if it fails — a share that never left local disk stays retryable via the pending-share table instead of being marked permanently "done."

**BLOCKING NEW-A (round 3 fix, round 4 correction, closed): the recipient upload ran BEFORE its WAL was checkpointed, so R2 got STALE bytes at a NEWER version.** `_open_profile_db` opens WAL-mode connections, so round 2's fix above committed the materialized game/clips into `profile.sqlite-wal`, then immediately called `sync_db_to_r2_explicit`, which uploads ONLY the main file (`storage.py`: `client.upload_file` on the local path) — no checkpoint on this path (the only two `wal_checkpoint` calls in the repo are `main.py`'s SIGTERM handler). Net effect: R2 received the PRE-share bytes stamped as the NEW (post-share) version. This is **worse than not syncing at all** — the recipient's own next restore-if-newer sees `local >= r2` (same or higher version) and never re-pulls the real data; the share is permanently invisible even though Postgres reports it materialized. Every other `sync_db_to_r2_explicit` caller closes its connection before syncing (e.g. `auto_export.py`); `materialize_game_share` was the only one uploading with its writer connection still open.

Round 3's fix (`recipient_conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")` before the upload) **shipped the result unchecked** — `PRAGMA wal_checkpoint` does NOT raise on contention, it returns `(busy, log, checkpointed)` with `busy=1` and leaves the just-committed frames sitting in the WAL, so a contended checkpoint fell through to uploading the stale main file anyway (reviewer reproduced end-to-end: uploaded object had 0 games at db-version 1, plus a ~30s stall from the connection's inherited `busy_timeout=30000`). Contention here is real, not hypothetical — it's the same class of interleaving the WAL-safety section below (`session_init.py`'s concurrent steps) documents, though those steps hold their own connections only for short transactions, so in practice the window a checkpoint has to land inside is narrow, not routine. Fixed (round 4): lower `busy_timeout` to 2000ms first (fail fast, don't inherit the 30s default), then check the `busy` flag and `raise ProfileDBRefreshFailed` BEFORE the upload call when set — reusing the exact same "upload failed → do NOT mark materialized, stays retryable" path already in place for a failed `sync_db_to_r2_explicit`.

**Known landmine, ~~NOT fixed here (follow-up task T5920)~~ FIXED T5920:** the checkpoint-before-upload discipline was originally applied ONLY at the `materialize_game_share` call site. The hazard was systemic — `middleware/db_sync.py`'s end-of-request sync (`_background_sync`) uploads `profile.sqlite` the same way (main file only, no checkpoint), so any concurrent request/connection holding that same file open produced the identical under-checkpointed-upload-at-a-bumped-version failure on the NORMAL request-sync path, not just teammate-share materialization. **T5920 generalized the guard into the upload PRIMITIVE** — see the T5920 section below.

**BLOCKING-2 (round 2, closed, reconfirmed round 3): `current_version is None` let an empty post-R2-ERROR DB force-push over real data.** `ensure_user_database`/`ensure_database` (UNCHANGED, still lenient/first-access-only by design) create an empty schema'd DB when a fresh machine's R2 restore errors, without recording a version. The CAS guard in `storage.py` (`sync_database_to_r2_with_version` / `sync_user_db_to_r2_with_version`) used to read `r2_version > 0 and current_version is not None and r2_version > current_version` — an unconfirmed (`None`) baseline SKIPPED the conflict check entirely, so that empty DB would upload as `new_version = r2_version + 1`, silently destroying credits/profiles/quests with zero conflict signal. Fixed at the PRIMITIVE (covers every caller, not just T4315's own new call sites): `r2_version > 0 and (current_version is None or r2_version > current_version)` — an unconfirmed baseline against REAL R2 content now refuses exactly like a stale one. A genuinely brand-new user (R2 NOT_FOUND, `r2_version == 0`) is unaffected — still uploads normally. Round-3 reviewer verified this end-to-end against FakeR2 for both DB kinds and confirmed `admin.py` surfaces `synced: false` instead of lying.

**WAL safety (round 3 correction of round 2's MAJOR-3 fix): gate the DOWNLOAD, not the version check.** Round 2 checked `wal_sidecars_present(db_path)` BEFORE calling `sync_*_from_r2_if_newer` at all — refusing correctly protects a live connection from a swap, but this ALSO refused in the overwhelmingly common case where `local_version >= r2_version` and `sync_*_from_r2_if_newer` would not have downloaded anything anyway (sidecars just mean some UNRELATED connection has the file open for perfectly normal reasons — nothing unsafe is happening). Concretely this broke T3230 login share materialization: `session_init.py`'s steps 5-9 (`recover_orphaned_reservations`, `backfill_*`, `archive_completed_projects`) hold `user.sqlite`/`profile.sqlite` open on the request thread while the T3230 background thread concurrently tries to materialize a pending share — sidecars present, `require_fresh` refuses, exception swallowed by the caller's broad `except`, share silently never materializes, and `_init_cache` being set means the slow path never re-runs. Fixed: `sync_database_from_r2_if_newer`/`sync_user_db_from_r2_if_newer` (`storage.py`) gained an optional `before_download` callback, consulted ONLY once R2 is confirmed newer and a download has actually been decided — `ensure_user_database_fresh`/`ensure_profile_db_local` pass `before_download=lambda: not wal_sidecars_present(db_path)`. A live connection now blocks only the actual swap, never a no-op confirm. `clear_stale_wal_sidecars` (called AFTER a download that DID proceed) remains defense-in-depth for the narrow window between that check and the download completing, and still catches `OSError` broadly (not just `FileNotFoundError`; Windows raises `PermissionError` on an open file).

Practical effect of the guard: `ensure_user_database`'s own schema-apply connection (called first, inside `ensure_user_database_fresh`) already naturally clears ORDINARY leftover sidecars via its own open/close cycle (verified: SQLite auto-deletes them when it's the last/only connection) — so the guard firing (when a download IS needed) is a genuine signal of real concurrent access, not leftover-file noise.

**Structural guard's own blast radius (round 3, MAJOR NEW-D, closed):** round 2's `get_user_db_connection` foreign-user guard (above) put a possible R2 HEAD onto any code path resolving another user's `user.sqlite` — round 2 wrapped `materialize_game_share` itself in `asyncio.to_thread` but missed the `get_profiles(recipient_user_id)` call immediately preceding it at 3 call sites (`games.py` x2, `clips.py`) and missed `shares.py`'s `record_milestone(share["sharer_user_id"], ...)` on the PUBLIC, unauthenticated-by-default `GET /shared/collection/{token}` route (the viral share-view page — not "non-hot" as round 2's doc claimed). All 4 now `await asyncio.to_thread(...)`. **Round 4 correction (MAJOR-1):** `asyncio.to_thread` frees the EVENT LOOP but the handler still `await`s it, so the RESPONSE itself still waited on the HEAD/download for an authenticated viewer. Its sibling route (`get_shared_video`, T4840) already had the right pattern — `background_tasks.add_task(record_milestone, ...)` — which truly removes it from the response path, not just the event loop. `get_shared_collection` now matches.

**Round 4 (MINOR): a refused materialization must not silently drop the share.** `games.py`'s `share_game`/`share_playback` wrapped the single-profile `materialize_game_share` call in the outer per-recipient `except Exception` with no fallback — a `ProfileDBRefreshFailed` (from either the recipient sync failing or, now, a busy checkpoint) logged and moved on, leaving the recipient with no materialized share AND no pending-share row (unlike the non-user/multi-profile branches, which always create one). Both functions now catch `ProfileDBRefreshFailed` specifically around the materialize call and fall back to `create_pending_share`, matching the other two branches — retryable via T3230 login auto-materialize or a manual `resolve-pending-shares` call, never a silent drop.

**Design-doc correction (recorded, not re-litigated):** the T4315 task file's original claim that "the profile-DB request path already restores-if-newer per request" is FALSE — `ensure_database` (database.py) and `session_init` are ALSO first-access-only (comment at `database.py`: "We do NOT check R2 version on every request"). T4315 does not rely on that claim; profile.sqlite's OWN-session write path is unchanged by this task.

**Tests:** `tests/test_t4315_restore_on_staleness.py` (17 tests) — restore-before-write when R2 is newer (+ version cache assertion on refusal); R2-error refuses loudly with local file AND version cache untouched; machine-swap simulation serves current R2 data; `confirm_current_before_write` dispatch; `materialize_game_share` recipient refresh-or-fail (+ version cache untouched, with the `app.services.materialization.USER_DATA_BASE` patch round 3 found missing — round 2's version of this test was vacuous, NEW-E); `get_user_db_connection`'s structural foreign-user guard (fires for foreign+unconfirmed, skips when recently confirmed, stays lenient for same-session-user and no-session-context); the empty-DB-after-R2-ERROR end-to-end regression (BLOCKING-2); WAL guard refuses with a GENUINELY open connection for BOTH user.sqlite and profile.sqlite (round 3 added the missing profile.sqlite case) and lets an ordinary restore proceed EVEN WITH sidecars present when nothing needs downloading (round 3, proves NEW-B fixed, both DB kinds). `tests/test_materialization.py` gained 3 tests: BLOCKING-1 (recipient sync called; sync failure refuses to mark materialized) plus a FakeR2-backed round-3 test that reads the ACTUAL uploaded object back and asserts it contains the shared game/clips (proves NEW-A fixed — a mocked `sync_db_to_r2_explicit` call, which is all round 2 had, cannot catch stale-bytes-at-a-newer-version). `tests/test_version_conflict.py` gained the BLOCKING-2 primitive tests (refuses when unconfirmed + real content; still uploads when unconfirmed + genuinely empty) for both profile and user DB. `tests/test_auto_materialize.py`'s `_common_patches` stubs `threading.Thread` to run inline (T3230 moved to a background thread in round 2) — round 3 note: this makes the stub run BEFORE session_init's later steps, so it cannot by itself prove NEW-B fixed; the WAL-guard unit tests above are the authoritative regression coverage for that. Full suites re-verified green: `test_t4310_r2_cas_conflict.py`, `test_sync_status.py`, `test_background_sync.py`, `test_t4050_durable_sync.py`, `test_performance.py` (`TestR2SyncSkipHead`), `test_admin_credit_grant_r2_sync.py`, `test_move_reels_stale_target.py`, `test_credits_grant_prod_gate.py`, `test_double_grant.py`, `test_revenue_reconciliation.py`, `test_t4940_pack_pricing.py`, `test_shares.py`, `test_session_init_recovery.py` (its wall-clock fire-and-forget flake was replaced with a deterministic state-based assertion in T6070, so it no longer needs the removed `local_disk_timing` deselect). Two `test_t4820_expired_source_status.py::TestSweepPhase2ExpiresGameStorage` failures are pre-existing/out of scope (confirmed via `git stash` — fail identically on the base commit); one `test_materialization.py::TestPendingShareCRUD` Postgres-DDL-race error was confirmed flaky/unrelated (passes standalone and on rerun).

**Residual, out of this task's named scope:** `analytics.py: record_milestone`/`update_session` call `get_user_db_connection(user_id)` for a write; whether any caller passes a foreign (non-session) `user_id` wasn't fully audited beyond `shares.py` (fixed above).

## T5920 — WAL checkpoint before every R2 upload (systemic, in the primitive)

**Guarantee:** no R2 upload can ship an under-checkpointed SQLite file. Every per-user DB is uploaded
main-file-only (`client.upload_file` on `local_db_path`); in WAL mode committed data sits in `<db>-wal`
until a checkpoint (SQLite auto-checkpoints only on last-connection-close). If any other connection held
the file open during a sync, the upload shipped pre-commit bytes stamped at a BUMPED version — worse
than not syncing, because T4315 restore-if-newer (`local >= r2` → never re-pulls), T4310 CAS, and any
Postgres "materialized" mark then trust that stale-content-newer-version copy and the write is silently,
permanently lost. Previously only `materialize_game_share` checkpointed (T4315 round 4); T5920 moved the
guard into the one choke point every caller passes.

**The guard — `storage.py: _checkpoint_wal_or_refuse(local_db_path) -> bool`.** Called inside BOTH
upload primitives (`sync_database_to_r2_with_version`, `sync_user_db_to_r2_with_version`) AFTER
`new_version` is computed (so it covers the CAS path AND the two `skip_version_check=True`
request-thread callers — profiles.py create, payments webhook) and immediately BEFORE `client.upload_file`.
It opens a FRESH connection, sets **`busy_timeout=2000`** (NOT the 30000ms `_open_profile_db`/
`get_db_connection` inherit — fail fast, never a 30s/attempt stall), runs `PRAGMA wal_checkpoint(TRUNCATE)`,
and reads the busy flag. **The landmine: `wal_checkpoint` does NOT raise on contention** — it returns
`(busy, log, checkpointed)`; `busy=1` means it did nothing and left frames in the WAL. On busy (or ANY
exception — refuse rather than risk a stale upload, never a bare proceed-anyway fallback) it returns
False and the primitive `return (False, None)`.

**Refusal maps to `SyncResult.FAILED`, NOT CONFLICT (no 4th state).** `(False, None)` is the existing
FAILED mapping in `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit`; a busy checkpoint is TRANSIENT
(clears when the other connection closes), so it must retry (`.sync_pending` survives, `X-Sync-Status:
failed`, the existing "edits aren't saving — Retry" UX / durable 503), not freeze the baseline like a
CAS CONFLICT. **No version bump** — the `return` precedes both the key derivation and `set_local_db_version`,
so the baseline stays put and the same write retries cleanly.

**A fresh checkpoint connection can flush OTHER idle connections' committed frames** (WAL is shared), so
the common case — the request handler's `get_db_connection()` already closed before `_background_sync`
runs, verified in the audit — yields `busy=0` and a CORRECT upload. Only a concurrent **open read
snapshot / active transaction** on the same file forces `busy=1` → refuse. An idle post-commit open
connection does NOT block TRUNCATE (empirically busy=0).

**Call-site audit (T5920 deliverable):** of ~18 sync sites, only two held a connection open across the
sync — `materialize_game_share` (already guarded, its own `recipient_conn` checkpoint) and
`downloads.py: move_reels_to_profile`'s TARGET sync (`target_conn`, raw WAL, closed only in `finally`).
Every other site — including `_background_sync` (highest traffic) — closes its writer (or opens none)
before syncing, so the guard is inert for them except under genuine concurrent-reader contention.
**move_reels hardened:** it checkpoints `target_conn` (busy_timeout=2000 + TRUNCATE) before the sync and
refuses on busy via the existing rollback + retryable-503 path — it checkpoints rather than closes because
`target_conn` is still needed for the rollback. This is the exact shape of the reels-lost incident
(final_videos rows lost while the mp4s stayed in R2).

**Shutdown handler keeps its own pre-checkpoints** (`main.py:337,380`): NOT redundant with the primitive —
they also leave the on-disk file clean for the next boot, which the upload primitive does not do.

**Tests:** `tests/test_t5920_checkpoint_before_upload.py` — busy checkpoint refuses loudly (FAILED, no
upload, no version bump, `.sync_pending` stays) for profile AND user.sqlite; retry after contention clears
uploads the change (reads the R2 bytes back, asserts the committed row is present); uncontended path
unbroken; refusal is fast (≤10s, proves the 2000ms timeout, not 30s); `_background_sync` (highest-traffic
path) refuses under contention. Red-without-guard proven: disabling the guard call makes the refusal test
return `SyncResult.OK` (uploads stale bytes at a bumped version). `test_performance.py::TestR2SyncSkipHead`
updated to use a real WAL DB (the checkpoint step now opens `local_db_path`, so a dummy byte file is
refused as "file is not a database").

## T5870 — Pending vs failed vs conflict (stop lying about deferred syncs) + honest Retry

**Root cause (measured, prod bug 38p glitch 1 — "edits aren't saving fires regularly, only refresh
helps").** `is_sync_failed(user_id)` was literally `return has_sync_pending(user_id)`. `.sync_pending`
is set BEFORE every attempt (crash-safety) and cleared only on success, so a **0.5s upload-lock DEFER**
(the fire-and-forget `/actions` path, `_SYNC_LOCK_TIMEOUT`) — a queued-retry state, NOT a failure —
surfaced as `X-Sync-Status: failed`. Harness (`tests/t5870_measure_sync_outcomes.py`) measured 71% of
syncs DEFER under a rapid-edit burst; the alarm lands when a burst ENDS on a defer and the user goes
idle (nothing heals it). "Only refresh helps" had a second cause: the sync banner
(`SyncStatusIndicator`) had NO Retry button since commit `3b495048` ("no manual button") — auto-retry
fires only on a network `online` event, and the write-triggered `retry_pending_sync` needs the user to
keep editing. (Lead-1's "in-flight read as failed" race was probed and NOT reproduced — in-flight IS
suppressed; the mislabel is DEFER-read-as-failed.)

**Three honest states now.** New `.sync_failed` marker (`database.py`, mirrors `.sync_conflict`) means a
GENUINE, unrecovered failure. `.sync_pending` stays the crash-safe queued marker. Header decision is the
pure `db_sync.py: sync_status_header(user_id)` (suppressed while an attempt is in flight):
`conflict` (`.sync_conflict`) > `failed` (`.sync_failed`) > `pending` (`.sync_pending` only) > none.
`is_sync_failed` is now `has_sync_failed or has_sync_conflict` (NOT pending). Frontend `syncStore.js`:
`syncState` enum `ok|pending|failed|conflict` (was a `syncFailed` bool); `SyncStatusIndicator` shows a
quiet "Cloud backup pending" (no button) for `pending`, and the alarm "Could not save to the cloud" +
a **restored Retry button** for `failed`/`conflict`.

**Bounded re-drain (`db_sync.py: _redrain_failed_sync`) is what makes "pending" HONEST.** On a
transient `FAILED` (defer/checkpoint-busy/R2 blip), `_background_sync` retries the SAME write's sync
`_REDRAIN_MAX_ATTEMPTS=3` times (backoff `0.4·2ⁿ`) while STILL holding `_SYNC_IN_PROGRESS` (so it never
flashes mid-heal); on success it clears `.sync_pending`+`.sync_failed`, on exhaustion it marks
`.sync_failed`. **Persistence-rule compliance (a reviewer WILL challenge this):** it is a bounded,
attempt-scoped CONTINUATION of the originating write gesture (T4900 precedent), NOT reactive — it does
not watch state, is not a `useEffect`/store watcher, is not a poller that generates writes. Skipped for
the durable path (its 503 UX owns retry) and never for a CONFLICT (not blind-retryable). Showing a calm
"pending" for a write that never lands would be *silently-not-saving* — the re-drain is what prevents
that, not merely quieting the alarm.

**Conflict Retry restores-if-newer (`/api/retry-sync`).** A CAS conflict is not blind-retryable (T4310
freezes the baseline → a re-push re-refuses forever), and `session_init` is first-access-only so a
refresh may not heal it → **Retry is the only cure.** The endpoint calls
`confirm_current_before_write(user_id, None/profile_id)` (T4315 restore-if-newer) off the event loop to
pull R2's newer copy, then drains whatever `.sync_pending` markers survive, on `RefreshFailed` returns
`{success:false, conflict:true, message:"…reload…"}` — honest, never a loop. **T5081 changed what
"on success" means here** — see that section below; it no longer clears markers itself at all.

**Test-seam faithfulness (storage.py).** `FORCE_R2_SYNC_FAILURE` now also short-circuits the two upload
PRIMITIVES (`sync_database_to_r2_with_version`/`sync_user_db_to_r2_with_version`), not just the
`*_explicit` wrappers — so a forced "R2 down" also faults the primitive-direct callers
(`retry_pending_sync`'s re-drain, `sync_db_to_cloud`, shutdown sync). Without this the re-drain would
heal a "forced" failure against real R2. Inert on prod/staging (`_seams_enabled()` gated).

**Round 2 review fixes (1 BLOCKING + 5 MAJOR + 3 MINOR) — the architecture held; these are defects inside it:**
- **BLOCKING — conflict Retry no longer discards silently.** `confirm_current_before_write` REPLACES the
  local profile/user.sqlite with R2's newer copy — the refused local edit is gone from disk. The backend
  returns `{success, restored:true, message}`; the frontend (`syncStore.retrySyncToR2`) must NOT flip to
  `'ok'` — it stashes a persistent notice (`surfaceRestoredNoticeIfPending`, sessionStorage key, surfaced
  on next load) and `window.location.reload()`s so in-memory state matches the restored DB. Never a silent
  "resolved" over discarded work.
- **MAJOR-1 — the SESSION user's alarm is gated on its OWN sync (`own_status`), not the aggregate.** A
  FOREIGN DB failure (admin grant / share materialization / webhook) must alarm the FOREIGN owner
  (`mark_sync_failed(foreign_uid)` in the loops), NOT the session whose own data reached R2 — otherwise
  T5870 *escalated* master's quiet gray "pending" into a red alarm for the session (the exact false-positive
  class it was sent to kill). `own_status` is initialised before the try (early-exception safety) and forced
  "failed" in the except.
- **MAJOR-2 — the re-drain NON-BLOCKING-probes the per-user upload lock** (`get_upload_lock(user,"profile")`,
  mirrors the T1539 write-triggered retry) before re-uploading. Fire-and-forget `_background_sync` tasks
  aren't serialised per user, so a burst spawns several concurrent re-drains; without the probe each
  block-acquires and stampedes byte-identical uploads of the same object → T1537 R2 429s. The probe collapses
  the burst to ~1 and keeps the blocking acquire inside `retry_pending_sync` off a multi-second export hold.
- **MAJOR-3 — `_SYNC_IN_PROGRESS` is a `dict[str,int]` REFCOUNT, not a set.** With a set the first of two
  overlapping syncs to finish `discard`ed the shared entry and dropped in-flight cover while the second still
  ran → a concurrent read flashed the (now red) alarm. Refcount keeps cover until the LAST attempt ends.
  `_begin`=+1, `_end`=−1-and-pop. (Frontend `SyncStatusIndicator` also re-arms its 3s grace on a
  pending→alarm escalation as defense-in-depth.)
- **MAJOR-4 — conflict Retry no longer swallows `get_current_profile_id()`'s loud RuntimeError.** Without a
  profile it cannot restore the conflicted profile.sqlite, so it refuses honestly (markers kept) instead of
  clearing `.sync_conflict`/`.sync_pending` and reporting success (No silent fallbacks).
- **MINORs:** `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit` clear `.sync_failed` on success (an
  out-of-band export-worker success heals an idle user's red alarm); durable-path failure deliberately stays
  quiet `pending` on surface A (its 503 gesture UX owns retry — not the reconnect auto-retry); `import asyncio`
  hoisted to health.py top.

**Tests:** `tests/test_t5870_pending_vs_failed.py` (pending≠failed, header priority, re-drain heals /
exhausts / skips-conflict, no-refresh recovery, conflict-restore + honest-refusal); updated
`test_background_sync.py`/`test_sync_status.py`/`test_t4310` for the new semantics; FE
`syncStore.test.js` (three-state) + `SyncStatusIndicator.test.jsx` (quiet-pending vs alarm+Retry);
real-browser `e2e/T5870-sync-failed-retry-no-refresh.spec.js` (seed fault → real write → alarm banner →
Retry-while-down stays → clear fault → Retry clears the banner with NO reload). Each regression proven
red-without-fix.

## T5081 — INV-P: `.sync_pending` is a durability record, not a hint

**What it closes.** `.sync_pending` was the one marker T6390 never scoped per-DB — a single per-USER
file while `.sync_conflict`/`.sync_failed` were already split per scope. `retry_pending_sync` read "the
user has *something* pending" and unconditionally re-uploaded BOTH profile.sqlite and user.sqlite; if
R2 had moved ahead on the untouched one for any unrelated reason, that gratuitous re-upload tripped a
real CAS conflict against a copy with nothing to arbitrate — a false-conflict class distinct from (and
found while investigating, but NOT the cause of) the 2026-08-04 in-memory-baseline incident (see T6402
above / EPIC field-findings §4 in the JIT Migration epic for that postmortem).

**INV-P, the invariant governing every mark/clear from here on** (full text: the comment block above
`mark_sync_pending` in `database.py`): `.sync_pending.{scope}` exists **iff** that scope's local DB
may hold committed writes not yet confirmed present in R2. Cleared by exactly three reasons, nothing
else:
- **(a) upload success** for that exact scope (`sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit`).
- **(b) a restore-if-newer that actually replaced that scope's local content with R2's copy** — the
  peer fact to recording the new baseline. Discharged at every site that performs that download+swap:
  `ensure_database` (profile, database.py), `ensure_user_database`/`ensure_user_database_fresh`
  (user.sqlite, user_db.py), `materialization.ensure_profile_db_local` (T5087 deleted a fifth site,
  `migrations._migrate_profile_db`, once JIT retired the bulk sweep — see database.py's own INV-P
  comment). Deliberately NOT at a caller (see below for why).
- **(c) deletion of that scope's local DB** (`clear_scope_markers`).

`scope` is REQUIRED on mark/clear (`USER_DB_SCOPE` or a profile_id) — no default, `ValueError` if
falsy. A stray legacy bare `.sync_pending` file (no legitimate production cause — neither fly.toml
declares `[mounts]`, so `USER_DATA_BASE` is ephemeral) is upgraded loudly by
`adopt_legacy_pending_marker` into real per-scope markers, never silently tolerated as a dual format.

**Both (a) and (b) are compare-and-clear**, not unconditional unlink — this took 3 review rounds to
land correctly. An upload or a restore-if-newer both take real wall-clock time (checkpoint+PUT, or a
HEAD-plus-download) with no lock held; a DIFFERENT write can commit to the SAME scope and re-mark it
pending while one is in flight. `mark_sync_pending` returns a unique token (`{timestamp}:{uuid}` —
plain `time.time()` collided under load); a clearing site reads the CURRENT token with
`read_pending_token` before starting its upload/restore and passes it to
`clear_sync_pending(..., if_token=...)` after — the clear only fires if unchanged. A stale-token clear
is a safe no-op: the scope's own next drain resolves it correctly either way. Reason (c) alone stays
unconditional — deleting the local DB entirely invalidates any pending record for it regardless of
when it was marked.

**Why reason (b)'s clear lives at the swap site, never at a caller (the hard-won part — 3 more rounds
after the compare-and-clear landed).** The natural place to look is `POST /api/retry-sync`'s conflict
branch (`_retry_resolve_conflict`, health.py) — it calls the shared `confirm_current_before_write`
restore guard, so surely it knows if it restored something? It does not, reliably: a CAS conflict
schedules a reheal (`schedule_profile_db_reheal`/`schedule_user_db_reheal` null the cached version),
and that reheal is consumed by whichever request's `ensure_database`/`ensure_user_database` first-
access branch runs NEXT — often an ordinary, unrelated GET (even the `X-Sync-Status` poll that renders
the conflict banner) that races ahead of the user clicking Retry. By the time `_retry_resolve_conflict`
calls `confirm_current_before_write`, local is frequently already current — the restore already
happened, just not on this call. Two designs tried to detect "did I just restore this scope" from the
caller side (a version-before/after delta, then a `downloaded` boolean returned from the confirm call)
and both were provably wrong for this reason. The shipped fix: clear at the actual swap, using the
scope identifier from the function's own explicit args (never an ambient ContextVar —
`ensure_profile_db_local` temporarily points the ContextVar at a share's SHARER profile while its
`user_id`/`profile_id` arguments stay the caller's real target, so using the ContextVar there would
clear the wrong user's marker). `_retry_resolve_conflict` no longer tries to detect anything: it calls
`confirm_current_before_write` for both scopes, then `drain_pending_scopes(user_id, {USER_DB_SCOPE,
profile_id})` to deliver whatever is still genuinely undelivered (a scope that was merely deferred —
never actually behind R2 — keeps its marker through the no-op restore and gets uploaded by the drain;
before this fix Retry could report `restored: true` without ever having uploaded such a scope).

**`drain_pending_scopes` (middleware/db_sync.py)** is the one function that uploads exactly the scopes
with something pending — gated per-scope on `has_sync_pending_scope`, so a clean db is never dragged
into a retry. A pending marker whose local db file is missing (deleted profile, or predates
`clear_scope_markers`) is treated as an orphan and cleared (nothing to lose, would otherwise wedge
`has_sync_pending`/`/api/sync/flush-verify` true forever). Returns a `PendingDrainReport` whose
`.aggregate()` is `None` for "nothing attempted" vs. `SyncResult.OK`/`FAILED`/`CONFLICT` — callers must
not confuse "nothing to do" with "verified success". `retry_pending_sync(user_id, profile_id)` is a
thin wrapper scoped to `session_scopes(profile_id) = {profile_id, USER_DB_SCOPE}` — deliberately never
folds in other profiles (an earlier shape that did broke a caller's own verdict when a foreign profile
was stuck in CONFLICT, permanently disabling this user's in-band healing). `POST
/api/sync/flush-verify` is the one deliberate full barrier — it drains EVERY pending scope, own and
foreign, awaited.

**Tests:** `tests/test_t5081_pending_scoping.py` (scope isolation, compare-and-clear race protection
for both upload and restore, swap-site clears including a concurrent-remark-survives repro),
`tests/test_t5870_pending_vs_failed.py::TestConflictRetryDeliversAGenuinelyDeferredScope` (drain-based
Retry actually uploads a merely-deferred scope), `tests/test_move_reels_stale_target.py` (scope-
identity: the clear targets the function's argument profile, not the ambient ContextVar),
(T5087 deleted `tests/test_t6340_migration_sync_baseline.py`'s equivalent coverage for the bulk
primitive's own force-download+swap along with that primitive; the surviving
`migrate_local_profile_db_at_seam` does not swap independently — it migrates the file the seam's
OWN restore already swapped, so its scope-identity is covered by `test_t5081_pending_scoping.py`'s
existing site-1/ensure_database coverage above, not a separate citation).

## T5083 — JIT migrate-at-load-seam (migrations relocate into the serving process)

**What it closes.** Migrations previously ran ONLY via an admin-triggered bulk sweep
(`run_all_migrations`) after a deploy — miss it and accounts sit at old schema versions until someone
notices (T4820/T4830), and running it against a LIVE machine moved R2 ahead of that process's in-memory
baseline, arming the 2026-08-04 CAS-conflict incident (T6402/EPIC field-findings §"2026-08-04 prod CAS
conflict"). T5083 relocates the SAME single-user primitive (`_migrate_user`) to the per-user DB-load
seam so a user's DBs migrate to head in the process about to serve them, at the moment they're opened —
no post-deploy operator step. Design: `docs/plans/tasks/T5083-design.md`; epic:
`docs/plans/tasks/jit-migration/EPIC.md`.

**The seam, exactly (CORRECTED 2026-08-31 — see the CI-escalation landmine below for why).**
`ensure_database` (`database.py`, profile.sqlite) and `ensure_user_database` (`services/user_db.py`,
user.sqlite) each have a migration call sitting INSIDE `if R2_ENABLED:`, as a sibling of the first-access
restore branch (`if local_version is None: ...`) — strictly AFTER the restore-then-clear sequence
(`set_local_db_version`/`clear_sync_pending`) completes, so INV-P's ordering (§T5081 above) is never
touched, and (user.sqlite specifically) BEFORE schema creation (`executescript(_USER_DB_SCHEMA)`), never
after — see the FIX 1 landmine below for why that ordering is load-bearing, not cosmetic.
**The gate is `db_path.exists() and (user_id, profile_id_or_USER_DB_SCOPE) not in migrations._seam_verified`
— NOT "did this request enter the restore branch."** `_seam_verified` (a module-level
`set[tuple[str, str]]` in `migrations/__init__.py`) is added to ONLY after a real `"ok"` result, so a
below-head DB keeps re-entering the seam on every request until it verifiably reaches head, independent
of the restore branch's own version-cache gate (see the FIX 4 landmine below). `database.py`/`user_db.py`
read it via `migrations._seam_verified` (module attribute access, not `from .migrations import
_seam_verified`) specifically so a test's `monkeypatch.setattr(migrations_module, "_seam_verified",
set())` reset actually takes effect — a bound-name import would go stale against that reset. Cleared
alongside the existing per-user/per-profile caches in `forget_local_db_state` (database.py) and
`invalidate_user_cache` (session_init.py) so an account purge-then-reregister can't inherit a stale
verified flag; `forget_user_db` covers it transitively via `forget_local_db_state`. The profile seam is
additionally gated on `db_path.exists()` — a genuinely NEW profile (R2 NOT_FOUND, no prior local file)
has nothing to migrate; CREATE TABLE stamps it straight to head moments later, and without this guard the
seam sees a spurious "missing" file and blocks every brand-new signup. On an already-verified pair the
gate is an O(1) set-membership check — **zero R2 or migration-runner work on the hot path**, only the
one-time cold cost per (user,profile) per schema bump (the same performance property `entered_restore_
branch` gave, but correctly independent of the restore branch's own gate).

**Two leaner primitives, not the bulk one.** `migrations.migrate_local_profile_db_at_seam`/
`migrate_local_user_db_at_seam` operate on the file the seam's OWN restore just downloaded+swapped (or
confirmed current) — NO second R2 download and NO T6410 keep-local decision tree (the seam already
decided swap-vs-keep before the migration call). At the time these primitives were built they shared
`PROFILE_DB_RUNNER`/`USER_DB_RUNNER`, `sync_db_to_r2_explicit`/`sync_user_db_to_r2_explicit`, and
(profile only) `_read_r2_profile_user_version` verify-at-head with the bulk sweep's
`_migrate_profile_db`/`_migrate_user_db` — same runner, same upload, same verify, proven
byte/version-identical convergence (`test_sweep_and_seam_identical`, since deleted along with the bulk
sweep it compared against). Calling the FULL `_migrate_profile_db` from the seam was rejected: it
force-downloads the profile a SECOND time (the seam's restore already fetched it) and re-runs the
keep-local tree against a baseline the seam just set.

**T5087 (2026-09-01): the bulk sweep is DELETED, not just superseded.** `_migrate_user`,
`_migrate_profile_db`, `_migrate_user_db`, `run_all_migrations`, and the old `POST /api/admin/migrate`
are gone — the two leaner seam primitives above are now the ONLY way `user_db`/`profile_db` ever
migrate. There is no bulk backstop left for a non-seam path to lean on; every writer must reach the
seam (this is what T5085, below, made true for the non-login paths before T5087 shipped).

**Concurrency: a NEW lock, not the write lock.** `migrations._get_migration_lock(user_id,
profile_id_or_USER_DB_SCOPE)` returns a per-pair `threading.Lock` (module dict, TOCTOU-guarded by a
second lock around creation) serializing same-pair migrations. Deliberately NOT the existing
`_get_user_write_lock` (`db_sync.py`) — that lock is `asyncio`, user-keyed (not pair-keyed), non-
reentrant, and held ONLY on writes (GETs never acquire it) — reusing it would either leave GET-triggered
migrations unprotected or deadlock a WRITE request that already holds it and then triggers a migration
at the seam. The migration lock and the write lock are disjoint objects that never nest, so there is no
re-entrancy hazard by construction. Idempotency (the `PRAGMA user_version` gate) makes a lost race
harmless regardless — the lock exists to prevent a wasted double upload, not corruption.

**CAS refusal = re-pull-and-retry-once, INV-P-gated (EPIC decision 5).** On `sync_failed`,
`_seam_repull_and_retry_profile`/`_seam_repull_and_retry_user` first check `has_sync_pending_scope`
(T5081's now-trustworthy per-scope marker) — if THIS scope has nothing pending, another machine already
carried the migration to R2 and our attempt was a redundant clean-copy race: re-pull only, no retry
needed. If something IS pending: re-pull, by calling the LOW-LEVEL restore primitive DIRECTLY
(`sync_database_from_r2_if_newer`/`sync_user_db_from_r2_if_newer`) — **never by calling
`ensure_database`/`ensure_user_database` again**, which is the seam's own CALLER and would recursively
re-enter this same machinery — then retry the seam primitive exactly once. Still failing after that one
retry raises `MigrationBlocked` (never loop further).

**Fail-loud, mapped to 503 — and now genuinely retried, not just once.** Any non-`ok` result (`wal_busy`
surviving one `clear_stale_wal_sidecars` retry, `sync_failed` surviving the one re-pull+retry,
`not_at_head`, `missing`, or an outright exception from `migration.up()` — the runner call is wrapped in
`try/except` per FIX 3 below, so a bad migration surfaces as a `MigrateResult(status="exception: ...")`
the seam can act on, never a raw 500) raises `migrations.MigrationBlocked(user_id, profile_id, reason)`.
A `main.py` `@app.exception_handler(MigrationBlocked)` maps it to a retryable **HTTP 503**
`{"detail": "...", "code": "pending_migration"}` — the SAME convention as the T5970/T6550 guarded-write
503s. The DB is added to `migrations._seam_verified` ONLY after a real `"ok"` result (never on failure),
so a client retry genuinely re-enters the seam on the NEXT request too — see FIX 4 below for why
`_initialized_users`/`_initialized_user_dbs` alone could not guarantee this.

**Landmine (2026-08-31 Branch CI escalation) — the first shipped version of this seam had two real
bugs, both invisible to the 19-test suite that shipped with it, both root-caused by the expert agent
from a red Branch CI run and fixed same-day. Recorded here so the failure MODE, not just the fix, isn't
re-learned the hard way:**

- **FIX 1 (user.sqlite seam ran AFTER schema creation, not before).** The first shipped version placed
  user.sqlite's seam call AFTER `executescript(_USER_DB_SCHEMA)` (mirroring the ORIGINAL profile seam's
  physical position in the function, but profile.sqlite's schema-creation step is `CREATE TABLE IF NOT
  EXISTS` per-statement, so it never touches an EXISTING table's columns — user.sqlite's
  `executescript(_USER_DB_SCHEMA)` has the SAME property, but the ORDERING still matters for a table
  that's fully ABSENT). A restored user.sqlite below v002 (pre-dating `user_activity`'s creation) hit
  schema creation FIRST, which created `user_activity` fresh in its FULL HEAD shape (already carrying
  v004's `total_usage_seconds`, since `_USER_DB_SCHEMA` is kept at head) — then the migration ran and
  v004's bare `ALTER TABLE user_activity ADD COLUMN total_usage_seconds` crashed with "duplicate column
  name" on EVERY future request for that user (a permanent brick, not a transient failure). Real bug,
  real prod hazard — caught by `test_r2_restore_retry.py` in Branch CI, not by this file's own suite
  (see the gap below). Fixed by moving the seam to run BEFORE schema creation, as a sibling of the
  restore branch inside `if R2_ENABLED:` (matching the CORRECTED description above — the ORIGINAL
  design doc's placement description was itself imprecise on this point for user.sqlite).
- **FIX 4 (fail-loud was only one request deep — the more serious bug).** The first shipped version
  gated the seam on `entered_restore_branch` (a per-call local boolean, True only when
  `local_version is None`). But `set_local_db_version`/`set_local_user_db_version` run INSIDE the
  restore block, BEFORE the seam call — so a request that raised `MigrationBlocked` still left
  `local_version` non-`None`. Request 2 then found `entered_restore_branch` False (the restore branch
  never re-fires once a version is cached), **skipped the seam entirely**, and silently served the
  still-below-head DB — exactly the silent fallback this whole task exists to prevent, and worse than a
  hard failure (a below-head DB masquerading as fine is the T5970 `no such column` hazard waiting to
  happen on the NEXT hot-path read that names a newer column). Fixed by decoupling the seam's own
  success-tracking (`_seam_verified`) from the restore branch's version-cache gate entirely — see "The
  seam, exactly" above.
- **The gap that let both ship.** 16 of the original 19 tests in `tests/test_t5083_jit_seam.py` stub
  `PROFILE_DB_RUNNER.run`/`USER_DB_RUNNER.run` directly (a fake that unconditionally advances to head),
  so NONE of them ever ran a real `migration.up()` through the real seam call site end to end — that is
  precisely why FIX 1's ordering hazard was invisible locally. Two tests now close this gap:
  `test_real_runner_profile_head_minus_one_migrates_via_real_seam` and
  `test_real_runner_user_db_missing_table_migrates_via_real_seam` (the latter is the EXACT v004
  reproduction — builds via the real base schema, drops `user_activity` entirely, stamps
  `PRAGMA user_version = 1`, and asserts the real runner reaches head with no exception). **Lesson: a
  seam/call-site test suite that only ever exercises a stubbed runner proves the WIRING, not the
  MIGRATION — at least one test per track must drive the real runner against a genuinely below-head DB
  built via the real base-schema path.**
- **Minor, fixed the same pass:** `migrate_local_user_db_at_seam` never checked `wal_sidecars_present`
  (the caller's `wal_busy` retry branch was dead code) — added, symmetric with the profile primitive.
  **Minor, deliberately deferred (not a correctness bug, flagged for a future pass):** neither seam
  primitive nor `_seam_repull_and_retry_profile`/`_seam_repull_and_retry_user` saves/restores the
  `user_id`/`profile_id` ContextVar tokens around `set_current_user_id`/`set_current_profile_id` — when
  this runs for a FOREIGN user (an admin `get_migration_status_for_user` route, or the bulk sweep's
  `_migrate_user_db` which now also transitively calls `ensure_user_database` and therefore
  double-migrates+double-uploads on every bulk run) it can rebind an in-flight request's ContextVars.
  Idempotent but wasteful for the bulk-sweep case; a real (if narrow) cross-request-identity risk for
  the admin route. Not fixed this pass — noted for whoever touches this code next.

**Read-triggers-write is a SANCTIONED exception, not a gesture-based-persistence violation.** The
post-migration R2 upload can fire on a plain GET with no user gesture. This is deliberately NOT the
banned reactive-persistence pattern (invariant #1 above): it fires ONLY when the runner actually
`applied` something (a no-op at-head migration issues zero R2 writes), is idempotent and monotonic
(`PRAGMA user_version`-gated — cannot re-fire against its own output, so no feedback loop, the defining
hazard reactive persistence created for T350), and the admin sweep already performed this exact
ungestured write — JIT relocates WHERE the write happens, not whether it's sanctioned. Deferring the
upload to a later real gesture instead is strictly worse: a migrated-but-unsynced local copy whose
baseline disagrees with R2 arms the next writer's CAS conflict — precisely the 2026-08-04/T6402/T6340
failure class this task exists to close.

**Non-seam paths still uncovered (deliberate, T5085's scope).** `ensure_user_database_fresh` (write-path
baseline-confirm sibling, T4315) and `materialization.ensure_profile_db_local`/`_open_profile_db` (share
materialization, move-reels, admin analytics, background workers — user != profile-owner) do NOT get the
JIT trigger in T5083. They reach a profile without going through the seam at all. Safe because the bulk
sweep still backstops them and T5085 (next in epic order, before T5087 deletes the sweep) wires
"migrate-before-touch" for exactly this non-login-writer list.

**Tests:** `tests/test_t5083_jit_seam.py` (21 cases — at-head no-op zero-upload; behind-head migrates
and uploads `r2_version+1`; hot path never re-invokes the seam primitive; two concurrent first-access
requests produce exactly one upload; `wal_busy` blocks at both the primitive and the `ensure_database`
call site, never marks `_initialized_users`; a registry-thin/orphan profile still migrates;
`not_at_head`/`missing`/exception all raise `MigrationBlocked` with no fallthrough to a below-head open;
all three CAS shapes — nothing-pending re-pull-only, pending re-pull-plus-retry-lands, persistent-
failure-blocks-with-no-loop; user.sqlite symmetric coverage; sweep-vs-seam convergence; a regression
pinning the brand-new-profile `db_path.exists()` guard; PLUS the two real-(unmocked)-runner tests the
2026-08-31 escalation added — see the landmine above). Live-verified beyond the mocked suite: the REAL
(unmocked) `PROFILE_DB_RUNNER` drove a genuine floor-v23 profile DB (built via
`test_t6030_migration_window_structural_guard.py`'s `POST_V023_COLUMNS`-drop technique) through the real
`ensure_database()` seam to head v48, with correct R2 `db-version` advance and every audited column
restored. **Fixture landmine (same escalation, `tests/conftest.py::stamp_schema_head`):** several
pre-existing test files (`test_t6390_qa_evidence.py`, `test_t7010_clip_game_logging.py`,
`test_t4315_restore_on_staleness.py`, `test_t5081_pending_scoping.py`,
`test_t6160_conflict_self_heal.py`) build a synthetic marker-only DB (no base schema tables) with
`PRAGMA user_version` left at SQLite's default of 0 — impossible in real production (a fresh DB is
always stamped to head immediately; a genuinely below-head DB was created via the real base schema long
ago and always has every base table), but now that migration fires on every first access instead of only
an admin sweep, these fixtures tripped the SAME crash class as FIX 1/3 for a reason that has nothing to
do with the seam being broken. Per CLAUDE.md ("no defensive fixes for internal bugs that cannot occur"),
the fix is in the fixtures (`stamp_schema_head(conn, "profile_db"|"user_db")`, using the REAL runner's
`latest_version` — never a magic/sentinel number, so a future migration bump can't silently leave a
fixture claiming to be at an old head), not a new seam guard.

## T5960 / T6010 / T6020 — Alarm gated on write-attempt, classified by call-site marker

**Root cause (staging 2026-07-26):** a plain read-only load of `/home/games` (zero editing
gestures) showed the red alarm "Could not save to the cloud". The `.sync_conflict` marker is
**sticky** (survives until a later sync succeeds — see T4310 "freeze the baseline") so it outlives the
session whose write was refused and, because `X-Sync-Status` is set on EVERY response (incl. GETs,
`db_sync.py:857`), attaches to whatever session loads next — including a read-only one. The refusal
itself is working as designed; the defect was WHO gets shown the alarm. `.sync_failed` (T6010) has
the identical sticky-marker idiom and staleness property — closed one task later.

**Fix (frontend ONLY — backend marker write/clear/CAS semantics UNCHANGED, do not touch them):**
`conflict` AND `failed` (T6010) are still HELD in `syncStore`, but their ALARM is not rendered
until THIS session has attempted a **write**. `syncStore.js`:
- Ephemeral store field `hasAttemptedWrite` (per-session; NEVER persisted — no
  localStorage/SQLite/R2, no new write path) + `markWriteAttempted()`.
- The existing global `window.fetch` interceptor is the single seam: `isMutatingApiRequest(input,
  init)` (exported, unit-tested) arms the flag on a POST/PUT/PATCH/DELETE to our own API. Method can
  be lowercase, absent (→GET, never arms), or on a `Request` in `args[0]`; URL is matched by
  origin+`/api/` (foreign-origin R2 presigned PUTs do NOT arm).
- `SyncStatusIndicator.jsx`: `ALARM_SYNC_STATES = new Set(['failed', 'conflict'])` (T6010 generalized
  this from a conflict-only special case); `isHeldSilent = ALARM_SYNC_STATES.has(syncState) &&
  !hasAttemptedWrite`; `isAlarm = ALARM_SYNC_STATES.has(syncState) && hasAttemptedWrite`; `shouldShow`
  excludes the held-silent case. `pending` is deliberately NOT in `ALARM_SYNC_STATES` — its quiet
  banner renders regardless of write-attempt (pinned by a test; `offline` is likewise ungated).
- **T6020: classification of "could this write ever touch the user's profile SQLite" moved from a
  URL denylist to an explicit per-call-site marker.** The denylist (`NON_GESTURE_API_PREFIXES` /
  `_EXACT` / `_PATTERNS`) is DELETED. Reason: `PATCH /api/projects/{id}/state` is hit BOTH by
  `useProjectLoader.js` on project OPEN (load-time bookkeeping) AND by `App.jsx`'s real mode-switch
  GESTURE, at the IDENTICAL pathname — a pathname-only matcher structurally cannot tell them apart
  (the query string differs, but coupling the frontend gate to a specific backend query-param name
  was considered and rejected as fragile/easy-to-silently-break). The inverted mechanism: each
  non-data call site sets `rbNonDataWrite: true` in its own fetch options — `utils/apiFetch.js` is
  `fetch(url, {credentials:'include', ...options})`, so unknown `RequestInit` keys pass straight
  through with zero plumbing. `isMutatingApiRequest` just checks `init?.rbNonDataWrite`.
  `grep rbNonDataWrite` finds every marked call site (CLAUDE.md Refactoring Rules #6: greppability
  over registry indirection). **Direction is deliberate and asymmetric**: forgetting to mark a NEW
  non-data write arms the gate spuriously (stale alarm on a passive load — annoying, recoverable,
  the pre-T5960 status quo); forgetting to allowlist a user-data write would silently suppress a real
  conflict (data-loss-shaped) — so this is NOT an allowlist-of-gestures design, it's a
  denylist-of-non-data-writes design, just keyed by call site instead of by URL.
- **Key naming (T6020 follow-up, supervisor-audit-caught regression): `rbNonDataWrite`, NOT
  `rbLifecycleWrite`.** The first cut of T6020 named the key `rbLifecycleWrite` and reasoned about
  "fires without a user gesture" — but the OLD denylist's `NON_GESTURE_API_PREFIXES = ['/api/auth/',
  ...]` excluded the entire `/api/auth/` prefix, including endpoints that ARE user gestures: `POST
  /api/auth/google`, `/verify-otp`, `/send-otp` (login), `/logout`, `/report-problem`. These write
  Postgres auth tables, never the profile SQLite, so they structurally CANNOT set
  `.sync_conflict`/`.sync_failed` — but "logging in" is unambiguously a gesture, so a
  "lifecycle"-named key actively misled at exactly this boundary. The task's original call-site table
  only listed the non-gesture auth writes (init/heartbeat/accept-terms/etc.), so these five stayed
  UNMARKED after the denylist was deleted — a real regression vs the T5960 baseline: any user who
  actually logged in (rather than being restored from an existing cookie) armed the gate at session
  start, which re-broke acceptance criterion 1 for exactly the population most likely to be carrying
  a stale marker (someone returning after being away). Caught by supervisor audit, not by the
  e2e suite — the passive-load e2e authenticates via `dev-login`/`test-login`, neither of which
  routes through the real login POSTs. Renamed to `rbNonDataWrite` so the key states the true
  semantic ("this write cannot touch user data") instead of a gesture/non-gesture distinction that
  doesn't hold at the auth boundary.
- **Marked call sites (14, `grep rbNonDataWrite` is authoritative):** `sessionInit.js` (`POST
  /api/auth/init`, `POST /api/auth/accept-terms`), `useSessionHeartbeat.js` (`POST
  /api/auth/heartbeat`, and the non-`sendBeacon` `POST /api/auth/session-close` FALLBACK —
  `navigator.sendBeacon` itself does NOT route through `window.fetch` and never reaches the
  interceptor, no marker possible/needed there), `useInstallPrompt.js` (`POST
  /api/auth/pwa-installed`), `videoErrorBeacon.js` (`POST /api/client-errors/video`),
  `useExportRecovery.js` (`POST /api/exports/acknowledge`, `POST
  /api/exports/{job_id}/resume-progress` — mount-time reconciliation for a finished/still-running
  export from a prior session, zero user intent), `useProjectLoader.js` (`PATCH
  /api/projects/{id}/state?update_last_opened=true&...` — the pathname URLs cannot express), PLUS
  the five auth-gesture sites from the follow-up: `utils/googleAuth.js` (`POST /api/auth/google`),
  `components/auth/OtpAuthForm.jsx` (`POST /api/auth/send-otp`, `POST /api/auth/verify-otp`),
  `stores/authStore.js` (`POST /api/auth/logout`), `components/ReportProblemButton.jsx` (`POST
  /api/auth/report-problem`). `App.jsx`'s two mode-switch PATCHes to the SAME pathname stay
  deliberately UNMARKED — that is the whole point of the mechanism.
- **`POST /api/clips/resolve-pending-shares`** (`SharedAnnotationView.jsx`, fires on mount of the
  shared-clip-link route) stays classified as a real user-data write (unmarked): unlike auth/
  export-recovery it does not fire on every app load, only when the user deliberately opened a
  share link, and it performs a real data materialization write to the recipient's own
  profile.sqlite (the exact kind of write that can genuinely conflict).
- **`/api/admin/impersonate/{id}` and `/api/admin/impersonate/stop`** (`authStore.js`) stay
  UNMARKED — not `/api/auth/`-prefixed so the old denylist never covered them either (not a
  regression), and both call sites hard-reload the page immediately after, so any gate state they
  set is moot before it could ever be observed.

**Old-vs-new exclusion coverage (T6020 follow-up systematic check):** every request the OLD
denylist excluded is still excluded under the new marker set. Blanket prefix `/api/auth/` →
every mutating (non-GET) `/api/auth/*` call site enumerated and confirmed marked (see the 14
above; `GET /api/auth/me` never arms regardless, method-gated). Blanket prefix
`/api/client-errors/` → exactly one call site in the whole frontend (`videoErrorBeacon.js`),
confirmed marked. Exact path `/api/exports/acknowledge` and the `resume-progress` regex → both
in `useExportRecovery.js`, confirmed marked. No other previously-excluded request was found
unmarked.

**Tests:** `syncStore.test.js` (hasAttemptedWrite default/setter; `isMutatingApiRequest` method/URL/
Request-object/`rbNonDataWrite`-marker matrix, INCLUDING the project-open-marked vs
mode-switch-unmarked pair at the identical pathname, AND the five auth-gesture-but-non-data sites
from the follow-up; interceptor arms on a real mutating fetch only); `SyncStatusIndicator.test.jsx`
(conflict/failed + zero-writes → nothing rendered; conflict/failed + after-write → alarm+Retry;
mid-session write flips held-silent → alarm; pending never gated). Real-browser
`e2e/T5960-conflict-alarm-gated-on-write.spec.js` (conflict, 5 criteria) and
`e2e/T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js` (failed matrix + conflict regression pin
+ project-open-vs-mode-switch + export-start-still-arms + auth-writes-do-not-arm), both INJECTING
`X-Sync-Status` via `page.route` (a real cross-machine CAS conflict / backend failure needs two
boxes — not reproducible on a single-box container, see commit 9468a960) and asserting on the
rendered banner, never the API response (the bug was the API being right and the UI lying). The
auth-writes e2e case drives the real interceptor with the real request SHAPE each marked call site
issues rather than a real login flow — a real OTP/Google login needs a live email round-trip /
Google credential exchange this container cannot drive; no test seam auto-approves an OTP code.

## T6160 — A CAS conflict now self-heals (restore is first-access-only, so Retry used to be futile forever)

**Root cause (staging 2026-07-27, hit live by the user — "nothing saves, everything breaks").**
`ensure_database()` (database.py) and `ensure_user_database()` (user_db.py) restore from R2 **on
first access only** — profile gates on `local_version is None`; user.sqlite ALSO early-returns on
`_initialized_user_dbs` membership BEFORE the version check. The code comment rejects a per-request
HEAD (20s+ cold). Consequence: once a running machine has a version cached, it **never notices R2
moving ahead out-of-band** (env copy, admin restore, second machine). Every write then hits the
T4310 upload-side CAS guard, is correctly refused (503 `sync_failed` durable, or `.sync_conflict` +
banner fire-and-forget), and the offered **Retry re-runs the same stale write forever**. Only a
process restart escaped (ephemeral disk gone → file absent → first-access restore). The CAS refusal
was CORRECT; the defect was the **absence of recovery**.

**Two traps that made the naive one-liner insufficient (verified, pinned by tests):**
1. `set_local_db_version(user_id, profile_id, None)` pops ONLY the in-memory cache. The `db_version`
   row persisted in the profile.sqlite file survives, and `get_local_db_version` reads it back
   (database.py fallback branch) → the stale version is resurrected → no first-access restore. So the
   invalidation must ALSO delete the file row (`_clear_persisted_db_version`). The "simulate machine
   cycle" test seam (test_seams.py) confirms this — it deletes the local files, not just the cache.
2. user.sqlite: `ensure_user_database` early-returns on `_initialized_user_dbs` BEFORE the version
   check, so clearing the (memory-only) version does nothing — the init flag must be dropped too.

**The fix — invalidate on conflict, re-pull on the next request (one HEAD only when a conflict
happened, NOT per-request):**
- `database.py: schedule_profile_db_reheal(user_id, profile_id)` — pops in-memory version +
  `_clear_persisted_db_version` (DELETE the db_version row) + clears the restore cooldown (a conflict
  means R2 was reachable, so any prior transient cooldown is stale). Next `ensure_database` reads
  `local_version=None` → first-access re-pull. Note `already_initialized` (database.py) gates only
  table-creation, NOT the R2 restore block, so the re-pull fires even with the user still in
  `_initialized_users`.
- `services/user_db.py: schedule_user_db_reheal(user_id)` — pops memory version + discards
  `_initialized_user_dbs` + clears cooldown. No persisted file row for user.sqlite
  (`set_local_user_db_version` is memory-only), so nothing on disk to clear.
- **Call sites (every `mark_sync_conflict` that could dead-end):** `sync_db_to_r2_explicit` /
  `sync_user_db_to_r2_explicit` conflict branches (covers `_background_sync` session AND foreign-user
  syncs, which route through the `_explicit` wrappers); `retry_pending_sync` profile + user branches
  (they call the lower-level primitive directly, so they invoke the reheal explicitly).
  `sync_db_to_cloud` (the `/api/retry-sync` wrapper) is deliberately NOT rehealed — its caller routes
  a conflict into `_retry_resolve_conflict` (T5870), which heals via `confirm_current_before_write`
  (restore-if-newer) directly.

**CAS refusal UNCHANGED — the baseline is never ADVANCED.** Invalidation sets the loaded-from version
to `None`, NOT to R2's version. A `None` baseline against real R2 content still refuses at the
storage.py primitive (`r2_version > 0 and (current_version is None or r2_version > current_version)` —
BLOCKING-2, T4315), so during the window between conflict and re-pull, writes keep refusing (no
force-push). This is why the T4310 tests changed from asserting "baseline frozen at v3" to "invalidated
to None": both prove the same guarantee — the stale copy never lands on R2. Self-limiting, no loop
(each successful re-pull sets a real version; genuine multi-writer contention just refuses+re-pulls
until local == R2).

**Decision 2 (the refused in-flight write): DISCARDED.** The write committed to the LOCAL profile.sqlite
(only the R2 upload was refused). The self-heal re-pull overwrites the local file → the stale-based
edit is gone. Re-applying it would be exactly the clobber CAS exists to prevent (never auto-merge,
never blind-retry — CLAUDE.md rule 7). Discard is legitimate ONLY because it stays user-visible via the
EXISTING conflict UX (fire-and-forget: `.sync_conflict` → write-attempt-gated alarm (T5960/T6010) →
Retry → `_retry_resolve_conflict` restore + "your local changes were replaced" notice + reload, T5870;
durable: 503 keeps the card in place). No frontend change and no change to the write-attempt gating.

**Decision 3 (Retry affordance) is fixed BY decision 1, no frontend change.** The durable-503 Retry
re-runs the write; the retried request re-pulls R2 first (self-heal) so the handler runs on the CURRENT
base and the write lands (the first attempt's local commit was discarded by the re-pull, so no
double-apply). The banner Retry already restored-if-newer (T5870). Both are now honest instead of
looping forever.

**WAL safety (required — the re-pull can now fire on a RUNNING machine).** `ensure_database`/
`ensure_user_database`'s first-access restore had NO WAL guard (safe only because "first access == no
connections yet"). T6160 makes them reachable while a live connection may hold the file open
(`-wal`/`-shm` present), where a blind main-file swap lets the next connection replay the old WAL onto
the new file (cross-DB page mixing — the exact hazard T4310 removed its post-conflict re-download for).
Both now pass `before_download=lambda: not wal_sidecars_present(db_path)` and call
`clear_stale_wal_sidecars` after a download that proceeded — the same T4315 pattern
`ensure_profile_db_local`/`ensure_user_database_fresh` use. A live connection blocks only the swap
(refused → transient → retried next request), never corrupts. Also hardens genuine first access against
crash-leftover sidecars.

**Tests:** `tests/test_t6160_conflict_self_heal.py` — the resurrection trap (set-None-alone reads back
the file row); profile conflict → invalidate (memory + file row) → next `ensure_database` re-pulls R2's
newer copy → a subsequent write lands (recovery), R2 advanced to the next version; the stale edit
discarded on re-pull; `retry_pending_sync` conflict invalidates; user.sqlite conflict → invalidate
version + drop init flag → `ensure_user_database` re-pulls (both `USER_DATA_BASE`s must be patched —
user_db.py keeps its own). `tests/test_t4310_r2_cas_conflict.py` updated: conflict now invalidates to
None (not frozen-at-v3), safety assertions (no upload, stale never lands, second attempt still refuses)
unchanged. Reviewer (fresh context): 0 blocking / 0 major.

## T6040 — Reader-vs-writer split on `conflict` (frontend-only, sibling of T5960/T6010/T6020)

**Problem T5960/T6010 left open:** gating the `conflict`/`failed` ALARM on write-attempt correctly
stopped telling a passive reader "Could not save to the cloud" for work they never did — but it also
made the banner the reader's ONLY signal of staleness, so a no-write session on a `conflict` machine
now saw nothing at all and had no way to recover.

**The `conflict`-is-behind / `failed`-is-ahead asymmetry (the non-obvious fact this task
establishes — do not flatten it in a future refactor):**
- **`conflict`** = CAS refused an upload because `r2_version > current_version`. R2 is **ahead**,
  local is **behind**. A reader on this machine is looking at genuinely **stale** data.
- **`failed`** = an upload didn't land for some other reason (transient R2 error, exhausted re-drain).
  Local is **ahead** — it holds the unsynced write. A reader on this machine is looking at the
  **newest** data available; there is nothing for them to do.

So only `conflict` gets a reader-facing notice. `failed` stays exactly as silent as T6010 shipped it
for a no-write session — generalizing the reader notice to `failed` would tell a reader to reload
into a copy that is actually OLDER than what they already have.

**Presentation (`SyncStatusIndicator.jsx`):** `isReaderConflictNotice = syncState === 'conflict' &&
!hasAttemptedWrite` — styled like the quiet `pending` banner (no `AlertTriangle`, no red border,
"A newer version of your work is available"), button labeled **Reload** (not Retry). `isHeldSilent`
narrowed from `ALARM_SYNC_STATES.has(syncState)` to `syncState === 'failed'` only — `conflict` is no
longer held fully silent, it just renders a different, non-alarm variant. The writer path
(`hasAttemptedWrite === true`) is completely unchanged: same red alarm, same "Could not save to the
cloud", same Retry button, same message text.

**Reuses `retrySyncToR2`/`POST /api/retry-sync` as-is — no backend change.** The endpoint's restore
branch (`_retry_resolve_conflict`, `health.py`) returns the same `{success, restored: true, message:
"Your local changes were replaced..."}` for both a writer's Retry and a reader's Reload; that message
is wrong for a reader (they have no local edit to lose — the same bug class T5960 fixed one layer up).
Fixed frontend-only in `syncStore.js`: `retrySyncToR2` captures `hasAttemptedWrite` BEFORE the request
(`wasWriter`) and passes it to `stashRestoredNotice(wasWriter)`, which now stores `'1'`/`'0'` in the
sessionStorage flag instead of always `'1'`. `surfaceRestoredNoticeIfPending` (runs once at next
module load, i.e. post-reload) only shows the "your local changes were replaced" toast when the flag
is `'1'` — a reader's `'0'` is consumed (never leaks a stale key) but shown nothing.

**`POST /api/retry-sync`-before-restore question (verified, does NOT need a fix):** the task doc
assumed the endpoint calls `sync_db_to_cloud()` (an unmodified-DB upload) before reaching the restore
branch for a reader. Traced and found narrower than assumed: `retry_sync()` (`health.py:182`) checks
`if has_sync_conflict(user_id): return await _retry_resolve_conflict(user_id)` FIRST — for the exact
scenario this task is about (a pre-existing sticky `.sync_conflict` marker), `sync_db_to_cloud()` is
**never called at all**; the handler branches straight to the restore path. `sync_db_to_cloud()` only
runs when `has_sync_conflict` is false and a NEW conflict is discovered mid-retry — a different,
rarer path than "reader inherits a sticky marker," and even there CAS would just refuse an
unmodified-version upload harmlessly (no re-mark needed since the version hasn't changed). No
backend change made or needed.

**Tests:** `syncStore.test.js` (writer vs reader restore-notice flag, `surfaceRestoredNoticeIfPending`
consumes `'0'` without toasting); `SyncStatusIndicator.test.jsx` (reader notice text/Reload button/
gray styling, RED-pinned before the fix); `e2e/T6040-reader-sees-stale-data-silently.spec.js` (full
matrix: reader-conflict-notice, writer-conflict-alarm-unchanged, failed-reader-still-silent,
pending-unchanged, Reload-reaches-restore-and-no-replaced-notice, 375px responsive). **Existing
regression-pin spec `e2e/T5960-conflict-alarm-gated-on-write.spec.js` needed a 1-line narrowing**:
its `CONFLICT_SUB` matcher was `/newer version of your work/i`, meant to catch the ALARM's own
sub-line — it collided with the new reader notice's legitimately similar wording (both describe a
conflict). Narrowed to `/newer version of your work exists/i` (the alarm-only phrasing) so it no
longer false-positives against the deliberate new reader UI; the actual regression pin (banner text +
Retry button hidden for a no-write session) is untouched and still enforced. Backend suites unchanged
and reconfirmed green (`test_t5870_pending_vs_failed.py`, `test_sync_status.py`,
`test_background_sync.py`) since no backend code was touched.

## T4320 — Durable clip gestures + user.sqlite shutdown sync + T5310 profile-create fix

**Gestures made durable** (`Depends(durable_sync)`): `POST /clips/raw/save`, `PUT /clips/raw/{id}`, `DELETE /clips/raw/{id}` (clips.py), `POST /api/games/finalize-upload` (games_upload.py), `POST /api/profiles` (profiles.py). An annotate save that returned 200 now survives a machine replacement (previously it rode fire-and-forget with a 0.5s lock-timeout defer → whole sessions could revert).

**Latency decision — UNBOUNDED wait (`lock_timeout=None`), matching the existing pattern.** A clip save uploads the SAME profile.sqlite that publish/restore/export already sync durably in prod (T4050/T4200) — identical cost, already accepted. Local measurement (real middleware via httpx.ASGITransport against the T4050 fake R2, varying simulated per-upload latency): the durable await adds ≈ one R2 upload RTT (profile.sqlite + user.sqlite upload in PARALLEL via `asyncio.gather`, so ~1 RTT not 2). p95 save ≈ 66ms @25ms RTT, ≈119ms @75ms, ≈205ms @150ms — all far under the task's 1.5s bounded-vs-unbounded threshold. So no bounded/`sync_pending` variant was needed (which also avoids inventing a new pattern). **A real-R2 staging p95 is still owed to the supervisor** — the local harness models RTT, not true R2 network variance. Working-clip `/actions` were EXCLUDED (high-frequency; would re-introduce the T2720 blocking-sync regression) — T4310/T4330 are their backstop.

**T5310 profile-create durability (prod-proven bug):** `POST /api/profiles` previously wrote the registry row to user.sqlite then relied on fire-and-forget to push the NEW profile.sqlite; a second profile created seconds after the first lost that fire-and-forget sync on prod → **registered profile with no R2 object** (arshia's `6ff007e6`/`22c7616a`, "missing"/Direction-A). Fix (profiles.py `create_profile`): **ordering matters** — `set_current_profile_id(new_id)` → `ensure_database()` (create local profile.sqlite) → `sync_db_to_r2_explicit(user_id, new_id)` durably pushes the NEW object to R2 FIRST → only then `db_create_profile` writes the registry row, and `Depends(durable_sync)` makes the middleware AWAIT the user.sqlite (registry) sync. Object-before-registration means a mid-op machine death yields at worst a benign R2 orphan (Direction-B, which the migration runner already tolerates), NEVER a "missing" registered profile. On profile-sync failure it returns `JSONResponse(503, DURABLE_SYNC_FAILED_RESPONSE)` (top-level `{code:'sync_failed', retryable}` — the shape the frontend's `error.code === 'sync_failed'` retry paths expect) BEFORE writing the registry, so nothing is registered. This is the cross-profile-durable-write pattern of invariant 6b applied to create (new profile.sqlite = the "other"/target DB, synced first; user.sqlite registry = the request DB, synced second via durable_sync). ~~Footgun: `sync_db_to_r2_explicit(user_id, new_id)` derives the R2 upload KEY from the ContextVar (`r2_key`), agreeing here only because `set_current_profile_id(new_id)` runs first; call it with a profile_id that differs from the ContextVar and it uploads the right file to the WRONG key.~~ **FIXED T5340: `sync_db_to_r2_explicit` now keys R2 off the `profile_id` ARG (`profile_r2_key`), so correctness no longer depends on the ContextVar matching the arg** — profile-create's `set_current_profile_id(new_id)`-first ordering is still correct but no longer load-bearing for the key. (T4850 `move_reels_to_profile`, which syncs a NON-request `target_profile_id`, was the live victim of the old footgun and is fixed by the same primitive change.)

**Tests:** `tests/test_t4320_durable_clip_gestures.py` (reuses the T4050 fake-R2 harness): clip save/update/delete survive a machine replacement; forced-sync-failure → 503 + not-durable; user.sqlite covered by `_graceful_shutdown`; profile-create survives a machine swap (object + registry both in R2); TWO profiles created back-to-back BOTH have R2 objects and survive a machine swap (the exact prod failure mode — arshia's second-of-a-pair profile); forced profile-sync-failure → 503 and the profile is NOT registered.

**T5350 — frontend closes the clip 503 loop (completes T4320's user-visibility).** T4320 made the clip routes return the retryable 503 but the frontend didn't surface it: `useRawClipSave` had no `sync_failed` branch, and the shared `DURABLE_SYNC_FAILED_RESPONSE.detail` ("Your reel was not moved") is nonsensical for a clip. Fix (frontend-only, `src/frontend/src/hooks/useRawClipSave.js`): on `response.status === 503 && (body.code || body.detail?.code) === 'sync_failed'`, each of save/update/delete now sets `error` + calls the exported `surfaceClipSyncFailed(gesture, retry)` — a persistent (`duration:0`, per-gesture `dedupKey`) shared-Toast error with a **Retry action** that re-fires the SAME gesture, then returns `null`/`false` (**never a silent-success toast** on a 503). **Copy is keyed on the GESTURE in the frontend (`CLIP_SYNC_FAILED_COPY`), NOT sourced from the backend `detail`** — the backend message stays reel/move-shaped and shared; do not surface `body.detail` for a clip gesture. **Invariant: the Retry is a user click (gesture), never a reactive `useEffect` re-send** — mirrors the overlay/publish/move durable-fail UX (`overlayActionStore`, `useMoveReels`, `useReEditReel`). Tests: `src/hooks/__tests__/useRawClipSave.syncFailed.test.js` (8 unit: 503→not-saved+Retry+re-fire per gesture, happy path unchanged, non-sync 500 not treated as sync_failed); live-drive `e2e/T5350-clip-sync-failed-frontend-ux.spec.js` renders the real toast via the exported `surfaceClipSyncFailed` against the mounted `ToastContainer`.

## T4330 — Unified action client: per-entity FIFO + version threading + 409 conflicts

**The gap.** `api/focusActions.js` and `api/overlayActions.js` each carried a near-identical
private `sendAction` (fire-and-forget POST). Two in-flight actions on the SAME entity could arrive
reordered on the wire; the backend does whole-blob RMW, so last-arrival wins — silent corruption,
no user-visible cause (the T3800 `persistKeyframeEdit` snap-move `del(old)+add(new)` pair is
exactly this hazard). Only overlay sent `expected_version`, and its backend check was commented
out (`overlay.py:645-652`) — plumbing that protected nothing. Framing had no versioning at all.

**The fix.** One transport, `api/actionClient.js` (`createActionClient`), that both wrapper files
route through declaratively, preserving their exact caller-facing return shapes (`mapResult`):
- **FIFO** — `Map<entityKey, Promise>` tail chain; a rejected/`success:false` action's REAL result
  still propagates to the caller (T3800 rollback unaffected), but the STORED tail is
  `.catch(()=>{})`'d so a failure can never wedge the entity's chain — the next queued action still
  fires. No coalescing (each queued action still POSTs individually).
- **Version threading** — tracks the last echoed version per entity (`version` for overlay,
  `new_version` for framing, both surfaced identically to `expected_version` on the wire), omitted
  until the first response for that entity, deleted on a 409 (next action re-seeds from its own
  success).
- **409 → refresh prompt, never auto-merge.** Both backends return `409 {success:false,
  error:"version_conflict", current_version, message}` on a stale `expected_version`; the client's
  `onConflict` fires `actionConflictPrompt.js`'s persistent toast + Refresh action
  (`window.location.reload()`, full reload — not in-place refetch). `overlayActionStore.dispatch`
  routes a `version_conflict` result to this prompt BEFORE its existing retryable/non-retryable
  classification (a 409 used to be misclassified as a deterministic 4xx and shown the WRONG "undo
  it and try again" toast — nothing to undo, the other tab's edit is legitimate). Framing has no
  failure store; `actionConflictPrompt.js` is its ONLY conflict surface too (a neutral
  `src/frontend/src/utils/` helper, not living on `overlayActionStore`, so framing doesn't depend
  on an overlay store).
- **Framing's counter is a NEW column**, `working_clips.framing_version` (profile_db migration
  v044, `ensure_database()` DDL updated for fresh DBs) — the pre-existing `working_clips.version`
  is the EXPORT version-row counter (one row per exported version) and would corrupt export
  versioning if reused. **Pre-migration (column absent, deploy->migrate window — this project's
  migrations do NOT auto-run, and profile_db is per-user so different users' DBs can be at
  different heads): the check/bump is skipped SILENTLY via `column_exists`, never a 500** — crop/
  segment/trim/rotation keep editing with no conflict protection until that profile DB migrates.
  The 409 check runs ONCE, immediately after the read, covering every framing write path uniformly
  (including `set_rotation`, which keeps its own separate, pre-existing, UNRELATED
  `column_exists(cursor,"working_clips","rotation")` 503 guard from v029 — untouched by this task).
  RMW atomicity (invariant 6) is preserved on both endpoints: the 409 check is a pure comparison on
  the already-read version, no `await` added before the commit.

**Design doc:** `docs/plans/tasks/T4330-design.md`. **Tests:** `actionClient.test.js` (FIFO,
cross-entity independence, version threading both field shapes, 409 handling, rollback
determinism, `mapResult` shape preservation), `overlayActionStore.test.js` (409 routing, not
queued, not the generic rejection toast), backend two-writer 409 per endpoint
(`test_overlay_actions.py::TestOverlayActionVersionConflict`,
`test_framing_action_version_conflict.py`), migration idempotency (`test_t4330_migration_v044.py`).

## T4360 — Explicit orderings: BEGIN IMMEDIATE + activation invariants

**The gap (audit B8/G3).** `framing_action` and `overlay_action` each do a whole-blob
read-modify-write with NO lock taken on the read (SQLite's default `isolation_level=""` only
issues an implicit `BEGIN DEFERRED` immediately before the first DML — a bare `SELECT` acquires
nothing). Safety was an *accident*: no `await` existed between read and commit inside one
coroutine, so the event loop could never interleave two in-flight requests across that span. One
added `await`, or moving DB work to a thread, reopens a silent lost-update race — two writers each
read the same blob, mutate in memory, and UPDATE; whichever commits last wins, discarding the
other's edit with no error.

**The fix.** `conn.execute("BEGIN IMMEDIATE")` as the FIRST statement after `cursor =
conn.cursor()` in both `framing_action` (clips.py:451) and `overlay_action` (overlay.py:639),
before the read. This takes SQLite's RESERVED lock immediately, so a second connection's own
`BEGIN IMMEDIATE` blocks (up to `busy_timeout=30000`) until the first commits — the invariant is
now enforced at the DB level, independent of Python scheduling. Works cleanly under Python 3.11's
legacy `isolation_level=""`: because `BEGIN IMMEDIATE` runs before any DML, `in_transaction`
becomes `True` and the sqlite3 module never issues its own competing implicit `BEGIN DEFERRED`;
every pre-existing `conn.commit()` in both handlers (there are multiple exit points — `set_rotation`
early-returns, the text-overlay sub-branches, the highlight-save path) correctly commits the same
IMMEDIATE transaction unchanged. Error paths in both handlers `return` a JSONResponse without
re-raising, so the open transaction is rolled back by `finally: conn.close()` — no half-committed
state on any path.

**Lock-timeout is a named, retryable error, never a silent 500.** If `BEGIN IMMEDIATE` itself or a
later commit raises `sqlite3.OperationalError` with `"database is locked"` (busy_timeout
exceeded), both handlers catch it and return `503 {"success": False, "error": "database_locked",
"message": ...}` — a client can retry the gesture. Non-lock `OperationalError`s are NOT swallowed
by this catch; they fall through to the handler's existing generic exception path.

**`games.py activate_game` was deliberately NOT wrapped.** Its bug26p ordering (:591-768) spans
MULTIPLE transactions and connections on purpose — a mid-handler `conn.commit()` exists solely to
release the writer lock before `insert_game_storage_ref` opens its own nested connection; a single
enclosing `BEGIN IMMEDIATE` would deadlock against that nested connection. T4360's job there was
invariant-*pinning*-by-test only (the restructure into a service is T4640):
1. Storage refs are written BEFORE the status flip — a crash between them leaves the game
   `pending` (never `ready`-without-ref); the self-heal branch (:591-603) backstops any pre-existing
   violation.
2. **Credit/status crash window — real, narrow, left as-is (confirmed at the T4360 design gate,
   not a bug to close now).** Credit deduction (:751, **Fly Postgres**, T5840) precedes the final
   status-flip commit (:764-768, **SQLite** — two different datastores, not one atomic unit). A
   crash in that window leaves credits-charged-but-`pending`. This does NOT literally satisfy
   "deduction happens iff activation completed," but `deduct_credits` is idempotent on
   `(source="game_upload", reference_id=game_id)`, so re-activating the still-`pending` game
   re-runs deduct with no double-charge and completes the flip — self-healing on retry, not data
   loss. Closing this window for real (merging the Postgres write and the SQLite flip into one unit)
   is explicitly T4640's scope, not this task's.

**Tests:** `tests/test_t4360_explicit_orderings.py` — a two-writer threadpool race detector proven
RED against `BEGIN DEFERRED` (deterministic lost-update reproduction) and GREEN against `BEGIN
IMMEDIATE`, plus a variant driving two overlapping real requests through the ASGI app; activation
happy-path (ready + ref + one deduction), the credit/status crash-window test (deduct once, stays
`pending`, retry completes with no double-charge), ready-without-ref-cannot-persist, and the legacy
self-heal path. The `BEGIN_DEFERRED`-hardcoded proof test is `@pytest.mark.xfail(strict=True)` —
it hardcodes the pre-fix mechanism directly and can never pass against any production code, so it's
marked xfail rather than left permanently red (the real regression guards are the sibling
`BEGIN_IMMEDIATE`-hardcoded test and the real-ASGI-request test). Design doc:
`docs/plans/tasks/T4360-design.md`.

## Active/upcoming work
Durability & Sync Hardening epic (docs/plans/PLAN.md, in order): **T4310 DONE** (this doc's T4310 section) — R2 CAS conflict detection, upload side; **T4315 DONE** (this doc's T4315 section) — restore-if-newer for write paths, the interlocking restore-side sibling: populates the `current_version` baseline CAS needs via `confirm_current_before_write`; **T4320** durable clip-creating gestures + user.sqlite in shutdown sync (DONE); **T4330 DONE** (this doc's T4330 section) — unified action client (per-entity FIFO, version threading, 409); **T4340** canonicalize segments_data at write; **T4350** re-transform carried highlights on re-export; **T4360 DONE** (this doc's T4360 section) — BEGIN IMMEDIATE + invariant tests. Related bug tier: T4200 (framing/multi-clip sync-then-announce), T4210 (overlay blob decode → 500). Full map: docs/plans/audit-2026-07-03-code-quality.md sections B and G.
