# T11560: Direct game share writes the recipient's storage ref into the sharer's own SQLite, not the recipient's

**Status:** STAGING (merged to master `7b08ef806`, 2026-10-01; auto-deploys to staging)
**Impact:** 8
**Complexity:** 3
**Created:** 2026-10-01
**Updated:** 2026-10-01

## Problem

Reported live by imankh@gmail.com: on 2026-09-02, shared a game with gsarah@gmail.com on
production via the direct email-share flow. gsarah@gmail.com got "Source video expired" trying
to open it. The game's R2 source was never touched — this is a false negative, not a real
expiration, and it hits the core growth loop (sharing).

Root cause (confirmed via code trace, Explore investigation 2026-10-01):

`POST /api/games/{id}/share` → `materialization.materialize_game_share` →
`_create_storage_refs` (`src/backend/app/services/materialization.py:788-806`) →
`auth_db.insert_game_storage_ref(user_id=recipient_user_id, profile_id=recipient_profile_id, ...)`
(`src/backend/app/services/auth_db.py:364-386`).

`insert_game_storage_ref` writes two halves:
1. Postgres `game_storage_refs` — correctly scoped using the explicit `user_id`/`profile_id` args.
2. SQLite `game_storage` — via `upsert_game_storage_row(conn, ...)` where `conn` comes from
   `get_db_connection()`, which ignores the passed `user_id`/`profile_id` and instead resolves
   the AMBIENT request context (`get_current_user_id()`/`get_current_profile_id()`,
   `src/backend/app/database.py:1757-1758`).

`materialize_game_share` runs inside the SHARER's own HTTP request (offloaded via
`asyncio.to_thread`, which preserves the caller's context — `games.py:2980-2994`). So the SQLite
write lands in the SHARER's own `game_storage` table (harmless no-op there) instead of the
recipient's. Postgres is correct; the recipient's local SQLite ref row never gets created.

When the recipient then loads/lists the game, `_compute_storage_status()`
(`src/backend/app/routers/games.py:2610-2644`) finds a `blake3_hash` but no row in the
recipient's own `game_storage` table, and — by design, for the genuinely-reclaimed case —
returns `'expired'`. The frontend (`AnnotateModeView.jsx:720`, `AnnotateContainer.jsx:1076`,
`SourceExpiredPanel.jsx:37-39`) renders that verbatim as "Source video expired."

This is not a recent regression (`_create_storage_refs`/`insert_game_storage_ref` date to
T2830/T6770, long before 2026-09-02) and is unrelated to T7350 (mobile share UA-sniff, a
different bug in link routing).

## Solution

Fix `insert_game_storage_ref`'s SQLite half to write into the RECIPIENT's profile DB using the
explicit `user_id`/`profile_id` it already receives, instead of trusting
`get_db_connection()`'s ambient context. Add a non-mocked integration test that actually opens
the recipient's SQLite afterward and asserts the ref row exists (every existing
`test_materialization.py` test mocks `insert_game_storage_ref` directly, which is why this
landmine wasn't caught).

No data migration needed — not a schema change, a call-site bug. Production repair for
gsarah's specific broken share: after this fix ships, imankh re-shares the same game with
gsarah again (ordinary gesture through the now-fixed code path) to self-heal her copy. No
bespoke prod-data script needed/wanted for a single row.

## Context

### Relevant Files
- `src/backend/app/services/auth_db.py` — `insert_game_storage_ref` (the actual fix)
- `src/backend/app/database.py` — `get_db_connection()` ambient-context behavior (reference only, not changed)
- `src/backend/app/services/materialization.py` — `_create_storage_refs` / `materialize_game_share` (reference, may need a profile-DB-connection helper call)
- `src/backend/tests/test_materialization.py` — existing mocked tests; add one unmocked integration test

### Related Tasks
- None blocking. Secondary gap noted but out of scope: `backend-services.md:984` claims a
  self-heal on next list-load for the public game-link claim flow (`_ensure_game_storage_refs`)
  that doesn't actually exist on `list_games`/`load_game` — only on `/activate`/`/attach`. Worth
  its own task if it reproduces; not filed yet.

### Technical Notes
- `.claude/knowledge/backend-services.md:968` already documents the ambient-context trap for
  TEST fixtures (`get_db_connection` reads current context, not passed args) — same landmine,
  unguarded in production code. Fix the doc's framing in the same commit if it implies this is
  test-only.
- Tier M: backend only, ~2-3 files, no schema change, no new abstraction — don't over-build.

## Implementation

### Steps
1. [x] Load `.claude/knowledge/backend-services.md` (persistence-sync.md not directly relevant;
   the bug is a call-site ambient-context mismatch, not a sync/CAS issue)
2. [x] Write failing integration test: `test_full_materialization` now asserts the RECIPIENT's
   real profile SQLite has the `game_storage` row; confirmed it fails against pre-fix code
   (crashes with `RuntimeError: No user context set`, proving the ambient-context mechanism)
3. [x] Fix: split `_create_storage_refs` into `_resolve_sharer_storage_refs` (read-only) +
   explicit writes via `upsert_game_storage_row(recipient_conn, ...)` +
   `insert_game_storage_ref_pg_only(...)`, using the already-open `recipient_conn` instead of
   the ambient-context `insert_game_storage_ref`. Moved the local SQLite write to before the
   WAL checkpoint/R2 sync so it rides the same upload as the copied game/clips.
4. [x] Confirmed new test passes; ran curated set (test_materialization.py,
   test_auth_db_storage_refs.py, test_t4820_expired_source_status.py,
   test_t6770_derived_ref_set.py, test_shared_game_extension.py,
   test_v017_backfill_storage_refs.py, test_game_load.py, test_t3970_expired_share_block.py,
   test_t2930_migrations.py, test_t8190_seam_reentrancy_deadlock.py) — 214 passed. Also had to
   update test_shared_game_extension.py's one direct `_create_storage_refs` caller (rewrote to
   use the new split functions + a real recipient connection; its old assertion via
   `get_game_storage_ref` turned out to be SQLite-only/ambient-only and never actually checked
   Postgres — replaced with a direct `game_storage_refs` query).
5. [x] Fresh-context Reviewer spawned on the diff (background)
6. [x] Updated `backend-services.md`: broadened the Test-context landmine note (it's not
   test-only) and added a full landmine entry under "Landmines & history" describing the bug,
   the fix, and why the `claim_game_link` (T5730) call site is unaffected (ambient==claimer
   there already, by design).

### Progress Log

**2026-10-01**: Investigated and root-caused via Explore subagent. Task filed, branch created.
Implemented fix in materialization.py, updated/added tests in test_materialization.py and
test_shared_game_extension.py, proved red-to-green against the pre-fix code via a manual
file-swap (not git stash — blocked by the auto-mode destructive-action classifier; used
scratchpad backup/restore instead). Updated backend-services.md. Reviewer running. Still to do:
await review verdict, commit, push branch for the user, and have imankh re-share the game with
gsarah post-deploy to self-heal her existing broken share (no bespoke prod-data script).

## Acceptance Criteria

- [x] New non-mocked test demonstrates the bug: fails on pre-fix code, passes on post-fix code
- [x] Recipient's own SQLite `game_storage` table gets the ref row after a direct share
- [x] Existing materialization test suite still green
- [ ] imankh re-shares the game with gsarah post-deploy to self-heal her existing broken share

## Review Round 2 (fresh-context Reviewer, NEEDS CONVERSATION verdict -> addressed)

0 BLOCKING, 3 MAJOR findings on the round-1 diff. All three fixed:

- **MAJOR-1 (root cause not fully fixed):** the round-1 fix still read the sharer's ref via
  `auth_db.get_game_storage_ref`, which is ALSO ambient-context-only (ignores its own
  `user_id`/`profile_id` args) -- correct only for the 3 callers where ambient happens to equal
  the sharer (share_game, share_playback, teammate_share). Silently produced no ref for
  `resolve_pending_shares` (ambient = recipient) and actively CRASHED
  `session_init._materialize_pending_shares_for_user` (T3230, bare background thread, zero
  ambient context -- `RuntimeError: No user context set`), a regression the round-1 reordering
  introduced (pre-round-1, that crash happened at the END of materialize, after the game/clips
  had already copied+synced; round-1 moved it to the START, so T3230 now imported NOTHING).
  **Fix:** `_resolve_sharer_storage_refs` now reads directly off `sharer_conn` (already open,
  already bypasses ContextVar) instead of calling `get_game_storage_ref` at all -- works
  identically for every caller, no ambient context needed anywhere in the storage-ref path.
  `claim_game_link` (T5730) would otherwise have started receiving REAL storage refs too (a
  product-behavior change, since its old "no fabricated ref" was itself just an accident of
  ambient=claimer-not-sharer) -- added an explicit `materialize_game_share(...,
  materialize_storage_refs=False)` flag so that stays a deliberate, greppable decision instead
  of an implicit side effect of the fix.
- **MAJOR-2 (recipient's paid expiry could be silently shortened):** `upsert_game_storage_row`'s
  SQLite UPDATE unconditionally overwrote `storage_expires_at`, so a recipient who paid to
  extend storage, then had the same game re-shared/re-merged, would have their longer expiry
  clobbered back down to the sharer's shorter one (Postgres already used `GREATEST` and would
  have disagreed with the now-wrong SQLite value). **Fix:** SQLite UPDATE now also uses
  `MAX(storage_expires_at, ?)`, matching Postgres's invariant.
- **MAJOR-3 (red-proof didn't exercise the real bug):** the original red run crashed with
  `RuntimeError` (no ambient context set at all in the test) rather than reproducing the actual
  silent-misdirect mechanism (ambient = sharer, write lands in the sharer's own table). Added
  `test_storage_ref_lands_in_recipient_even_under_sharer_ambient_context` which sets ambient
  context to the sharer exactly as a real share_game request does, and asserts the ref lands in
  the recipient (not the sharer, not duplicated) -- this is the test that actually reproduces
  2026-09-02's bug mechanism.

**Side effects of the MAJOR-1/2 fixes, all handled:**
- 6 other test files had stale `@patch(".get_game_storage_ref"/"insert_game_storage_ref")`
  mocks that no longer match real call sites (materialization.py no longer imports either name):
  `test_materialization.py`, `test_shared_game_extension.py`, `test_auto_materialize.py`,
  `test_t5730_claim_import_flow.py`, `test_t5740_share_scope.py`, `test_t5745_layer_aware_merge.py`.
  All updated to seed real `game_storage` rows / assert real state instead of mocking the exact
  function under test. `test_auto_materialize.py` gained a real end-to-end T3230 regression
  assertion (recipient's SQLite gets the ref row via the bare-thread path with zero ambient
  context -- this is the test that would have caught the round-1 regression).
- MAX-semantics fix broke 2 tests that depended on being able to shorten a ref's expiry via a
  second ambient-collapsed write (both in `test_shared_game_extension.py`): rewrote
  `test_can_extend_true_recipient_expired_sharer_active` to use genuinely separate sharer/
  recipient SQLite connections (the established `_conn_for` pattern from the sibling
  `test_recipient_extend_does_not_affect_sharer`, not an ambient-collapse shortcut) and isolated
  `TestExtendEndpointHandler`'s `_create_users` fixture to `tmp_path` (it was writing ref rows to
  the REAL local machine's app-data directory across test runs, previously masked because
  unconditional overwrite reset it every run; MAX let that leftover state survive and compound).

**Known pre-existing issue found, NOT fixed (out of scope):** `test_shared_game_extension.py`'s
`test_get_storage_refs_for_user_is_user_scoped` and `test_all_ref_hashes_includes_both_users`
call `insert_game_storage_ref` with no `USER_DATA_BASE` tmp_path patch, so they write into the
real local machine's ambient-resolved profile SQLite (not a tmp_path). Running that file and
`test_auto_materialize.py` in the SAME pytest invocation lets this leak into the latter's
recipient profile and fail with "no such table: main.projects" -- pre-existing, confirmed via
bisection to be present and reproducible independent of any T11560 change, not introduced by
this task. Each file passes cleanly on its own or combined with every other file in this task's
curated set; only that specific pre-existing combination is order-sensitive. Worth its own
test-hygiene task if it ever bites Branch CI's full-suite run.

All fixes verified: 285 passed (group A, storage-ref-related files) + 45 passed (group B,
claim/pending-share/scope files) = 330 passed, 0 failed, run as separate pytest invocations per
the Test Scope Policy (curated, not "run everything together").

## Review Round 3 (re-review after round 2, NEEDS REVISION -> addressed)

0 BLOCKING, 2 MAJOR (both evidence/test, no further production-code changes), 2 MINOR (docs).
All four addressed:

- **MAJOR (round-2 red-proof didn't reach its own assertion):** the ambient=sharer test's
  pre-fix run hit an unrelated `no such column: uploaded_filename` schema error from
  `ensure_database()` choking on the file's minimal hand-rolled fixture (which lies about being
  at head schema via `stamp_schema_head`), never reaching the real misdirect assertion. Fixed by
  building the sharer's profile DB via the REAL `ensure_database()` (full production schema,
  fresh tmp_path, `_initialized_users` reset) instead of the minimal fixture, for this one test.
  Re-proved red/green: pre-fix now fails cleanly on `assert len(r_refs) == 1` with `0 == 1` (zero
  ref rows reached the recipient) — no schema noise, no crash, just the real misdirect; post-fix
  passes.
- **MAJOR (no regression test for the MAX-semantics/MAJOR-2 fix):** added
  `TestInsertGameStorageRef::test_sqlite_upsert_never_moves_expiry_backward` in
  `test_auth_db_storage_refs.py` — seeds a 60-day expiry, re-upserts a 10-day one, asserts the
  SQLite row stays at 60 days (and that a genuinely later expiry still extends forward). Proved
  red (fails `assert ... == late` against pre-fix `auth_db.py`, which silently overwrote to the
  shorter value) / green (passes post-fix) via the same isolated swap-and-restore method.
- **MINOR (knowledge doc not updated for round 2, now wrong):** rewrote the T11560
  `backend-services.md` entry to describe both rounds (write-side fix, then the read-side
  `sharer_conn` fix + the `materialize_storage_refs` flag + the MAX/GREATEST invariant), and
  corrected the claim-path framing (explicit flag, not "ambient happens to equal the recipient").
  Added a MAX-semantics line to the `game_storage.storage_expires_at` write-authority bullet.
- **MINOR (new code comments restated the false claim-path heal-path premise):** reworded the
  `materialize_game_share` docstring, the `claim_game_link` call-site comment, and the
  `test_expired_source_imports_annotations_no_fabricated_ref` docstring to state plainly that a
  claimed hash-backed game currently shows 'expired' with no ref either way (the heal path is
  activate/attach-only, doesn't run on list/load) — a pre-existing, separately-tracked gap this
  flag doesn't fix or claim to, rather than asserting the heal path "resolves it honestly."

Final verification after round 3: 286 passed (group A) + 45 passed (group B) = 331 passed, 0
failed (the +1 is the new MAX-semantics regression test).

## Review Round 4 (final re-review): APPROVED

0 BLOCKING, 0 MAJOR. One MINOR left (two doc/comment spots still describing the old,
now-removed `_create_storage_refs` ambient mechanism and an inaccurate heal-path claim) — fixed:
rewrote the T5730 "Storage refs" bullet in `backend-services.md` and the matching
`test_t5730_claim_import_flow.py` fixture comment to state the actual current status (claimed
hash-backed games show 'expired' either way; heal path is activate/attach-only, not list/load;
pre-existing gap, not this task's fix).

The reviewer independently reproduced both red/green proofs in an isolated `git worktree` (not
the shared tree) and confirmed: pre-fix the ambient=sharer test fails cleanly on
`assert 0 == 1` (no schema error), and the MAX-semantics test fails on the expected
`2026-10-11... != 2026-11-30...` backward-overwrite. Post-fix: 148 passed (materialization +
auth_db_storage_refs + shared_game_extension + t5730 + t5740 + t5745) + 4 passed
(auto_materialize) = 152 passed, 0 failed, independently run.

**Status: ready to commit.** Noted by the reviewer (not blocking): Branch CI has not run yet for
the final SHA — confirm it's green before considering this merged, given the documented
pre-existing cross-file test-pollution finding (unrelated to this task, see above).
