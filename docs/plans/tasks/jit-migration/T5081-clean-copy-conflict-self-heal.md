# T5081: Split clean-copy conflicts from unsynced-write conflicts

**Status:** DONE (deployed 2026-08-31 prod)
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-04
**Updated:** 2026-08-30

Epic child 1/5 — see [EPIC.md](EPIC.md) for goal, settled design decisions, and the two field-findings
sections. This task is the safety net every later child leans on.

## Problem — CORRECTED 2026-08-29, twice (see EPIC.md field-findings §4 for the full postmortem)

The original diagnosis below (a clean-vs-dirty discriminator needed at the CAS refusal site) was
**wrong** and the design review before implementation caught it: `sync_database_to_r2_with_version`'s
CAS refusal is structurally unreachable without a write having already happened this request, so the
"clean, nothing to arbitrate" case barely exists on the live request path.

A first correction pass then over-claimed the fix below as "the true mechanism behind the 2026-08-04
incident" — also wrong, caught by the implementation reviewer: the incident's own log line shows
`method=GET`, and `retry_pending_sync` (what this task fixes) only ever runs on a WRITE request
(`WRITE_METHODS` gate). **2026-08-04 was EPIC.md finding 1, full stop** (the out-of-band migration
runner moved R2 ahead of a long-lived process's in-memory baseline cache) — this task's fix does not
touch that path and would not have changed that incident's outcome.

What this task DOES fix, found while investigating that incident but a genuinely separate defect:
**`.sync_pending` was the one marker T6390 (2026-08-03) never scoped per-DB.** It stayed a single
per-USER file while `.sync_conflict`/`.sync_failed` were already split per scope (`USER_DB_SCOPE` or a
profile_id). `retry_pending_sync` read "the user has *something* pending" from that one file and
unconditionally re-uploaded **both** profile.sqlite and user.sqlite (a bare file-exists check, never
"does THIS db have anything pending") — so a write to user.sqlite alone (e.g. session-init's
backfills) made a LATER retry also re-attempt a profile.sqlite that had nothing queued. If R2 had
moved ahead on that untouched profile for any unrelated reason, the re-upload would trip a real CAS
conflict against a copy with nothing to arbitrate.

This still matters for JIT (T5083): a user.sqlite-only backfill or a profile-only edit are both
common, and either one currently drags the OTHER db into every retry attempt regardless of whether
it changed.

## Solution

**Finish T6390's scoping for `.sync_pending`, then make every clear of it provably correct
(INV-P).** No `storage.py` / CAS-primitive changes at all. The design grew substantially past the
initial scoping — see the Progress Log for why each later round was necessary; this section
describes the FINAL shipped shape only.

### The invariant (INV-P)

`.sync_pending.{scope}` exists **iff** that scope's local DB may hold committed writes not yet
confirmed present in R2. It is cleared by exactly three reasons, nothing else — no `scope=None`
blanket clear, no opportunistic sweep:

- **(a) upload success** for that exact scope (`sync_db_to_r2_explicit` /
  `sync_user_db_to_r2_explicit`).
- **(b) a restore-if-newer that actually replaced that scope's local content with R2's copy** — the
  peer fact to recording the new baseline (`set_local_db_version`/`set_local_user_db_version`).
  Discharged at **every site that performs that download+swap**, never at a caller: `ensure_database`,
  `services.user_db.ensure_user_database`, `services.user_db.ensure_user_database_fresh`,
  `services.materialization.ensure_profile_db_local`, `migrations._migrate_profile_db`. There is no
  single call site for reason (b) — see the Progress Log (round 6) for why a caller-side "did I just
  restore this" check does not work.
- **(c) deletion of that scope's local DB** (`clear_scope_markers`).

Both (a) and (b) are **compare-and-clear**: `mark_sync_pending` returns a unique token; a clearing
site reads the CURRENT token with `read_pending_token` before its upload/restore starts and passes it
to `clear_sync_pending(..., if_token=...)` after — the clear then only fires if nothing re-marked the
scope in the meantime. Full rationale in the INV-P comment block in `database.py` above
`mark_sync_pending`.

### What changed

1. `mark_sync_pending`/`clear_sync_pending`/`has_sync_pending_scope` in `database.py` require an
   explicit `scope` (`USER_DB_SCOPE` or a profile_id) — no default, `ValueError` if falsy. Production
   has no legitimate reason to write a bare marker (no `[mounts]` in either fly.toml, so
   `USER_DATA_BASE` is ephemeral); a stray bare file is handled loudly by
   `adopt_legacy_pending_marker` (upgrades it into real per-scope markers, CRITICAL-logged), not
   silently tolerated as a permissive dual format.
2. `middleware/db_sync.py` gained `session_scopes(profile_id)`, `drain_pending_scopes(user_id, scopes)`
   (the one function that uploads exactly the scopes with something pending, gated on
   `has_sync_pending_scope`, treating a missing local db as an orphan), and `PendingDrainReport`
   (`.aggregate()` distinguishes "nothing attempted" from `OK`/`FAILED`/`CONFLICT`).
   `retry_pending_sync` is now a thin wrapper over `drain_pending_scopes(session_scopes(profile_id))`
   — deliberately never folds in other profiles (a foreign profile stuck in CONFLICT must not disable
   this user's own in-band healing).
3. `_sync_aware_flow` marks pending using the PRECISE `(user_id, profile_id)` write-attribution from
   `get_request_written_profile_dbs()`/`get_request_written_user_dbs()` (not the request's own
   session context — a profile can be created mid-request), and marks a foreign scope BEFORE the
   response returns on both the success and exception paths (crash-safety, T930).
   `_background_sync` clears each db's pending scope based on that db's own status, never the
   aggregate or a blanket clear.
4. `POST /api/sync/flush-verify` (health.py) drains EVERY pending scope, own and foreign, awaited —
   the one deliberate full barrier. `POST /api/retry-sync`'s conflict branch
   (`_retry_resolve_conflict`) calls the shared `confirm_current_before_write` restore guard for both
   scopes, then drains whatever markers survive — it does NOT try to detect which scope it personally
   restored (see Progress Log round 6).
5. `export_helpers.sync_export_db_to_r2` tracks `profile_ok`/`user_ok` separately instead of one
   aggregate `ok`, marking only the scope that actually failed.

The migration-path "re-pull, re-apply, retry once" behavior from EPIC decision 5 belongs to
**T5083** (which has the migration-runner context to safely replay a migration), not this primitive.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/database.py` — the INV-P comment block (above `mark_sync_pending`); scoped marker
  helpers `mark_sync_pending`/`read_pending_token`/`clear_sync_pending`/`has_sync_pending_scope`/
  `list_pending_scopes`/`adopt_legacy_pending_marker`/`clear_scope_markers`; `ensure_database`'s
  first-access restore branch (swap site 1)
- `src/backend/app/services/user_db.py` — `ensure_user_database` (swap site 2),
  `ensure_user_database_fresh` (swap site 3)
- `src/backend/app/services/materialization.py` — `ensure_profile_db_local` (swap site 4)
- `src/backend/app/migrations/__init__.py` — `_migrate_profile_db`'s R2-canonical swap branch (swap
  site 5)
- `src/backend/app/services/db_refresh.py` — `confirm_current_before_write` (the shared restore guard
  every swap site's caller goes through)
- `src/backend/app/middleware/db_sync.py` — `drain_pending_scopes`, `PendingDrainReport`,
  `retry_pending_sync`, `session_scopes`, `_sync_aware_flow`'s mark/clear-pending call sites,
  `_background_sync`'s foreign-db loops and success-path clear
- `src/backend/app/routers/health.py` — `flush_verify`, `retry_sync`, `_retry_resolve_conflict`
- `src/backend/app/services/export_helpers.py` — `sync_export_db_to_r2` (tracks profile/user outcomes
  separately instead of one aggregate `ok`)
- Knowledge: [persistence-sync.md](../../../../.claude/knowledge/persistence-sync.md) § CAS / SyncResult
  (stale re: this task as of 2026-08-30 — needs the INV-P model folded in, see EPIC.md task list)

### Related Tasks
- Epic sibling, blocks: **T5083** (JIT) — ship this first
- Builds on: T6390 (established the per-scope marker pattern this task extends to `.sync_pending`),
  T4310/T4315 (CAS + restore-if-newer), T6160 (scheduled re-pull), T6402 (self-conflict exemption)

### Technical Notes
- M-tier at classification; grew past that in practice (7 review rounds — the severity class, silent
  data loss on a durability record, kept surviving "looks correct" fixes). Backend-only throughout. No
  schema change, no migration. No `storage.py` changes — the CAS primitive is untouched; the fix is
  entirely in what decides whether to call it and what discharges the record afterward.
- Do not weaken the CAS refusal itself — this task never touches `storage.py`.
- **Legacy bare-marker handling changed from the original plan**: `scope` is now REQUIRED (no
  `scope=None` default) — production has no legitimate reason to write a bare marker (no `[mounts]` in
  either fly.toml). A stray one is upgraded loudly via `adopt_legacy_pending_marker`, not served as a
  permissive dual format. `test_sync_pending.py`/`test_sync_retry.py` were rewritten for the
  required-scope API, not preserved as originally planned.
- Test with a real conflict, not a mocked one: two baselines against one R2 object (`FakeR2` harness,
  `tests/test_t4050_durable_sync.py`).

## Implementation

### Steps
1. [x] Scope `.sync_pending` through the same per-scope marker scheme as `.sync_conflict`/`.sync_failed`
   (`database.py`) — `scope` required, no legacy dual-format default (revised from the original plan;
   see round 3)
2. [x] Add `has_sync_pending_scope(user_id, scope)`, `list_pending_scopes(user_id)`,
   `read_pending_token`/`clear_sync_pending(..., if_token=...)` compare-and-clear, and
   `adopt_legacy_pending_marker`
3. [x] `drain_pending_scopes` (middleware/db_sync.py) replaces the old duplicated-logic
   `retry_pending_sync`, which becomes a thin wrapper over it scoped to `session_scopes(profile_id)`
4. [x] Scope every mark/clear call site (`_sync_aware_flow`'s precise write-attribution marking,
   `_background_sync`'s per-scope clear, `export_helpers.sync_export_db_to_r2`'s split `profile_ok`/
   `user_ok`)
5. [x] INV-P reason (a) (upload) made compare-and-clear (round 3); reason (b) (restore) made
   compare-and-clear too, and relocated from a single caller to every actual swap site (rounds 5-6-7)
6. [x] `POST /api/sync/flush-verify` drains everything; `POST /api/retry-sync`'s conflict branch
   confirms both scopes then drains whatever survives, without trying to detect which scope it
   personally restored
7. [x] Tests: per-scope isolation, compare-and-clear race protection (upload AND restore sides), swap-
   site clears at all 5 sites (including cross-user/cross-profile scope-identity checks), drain-based
   conflict-retry delivers a merely-deferred scope
8. [x] Correct the EPIC.md/T5081 misdiagnosis (2026-08-04 was NOT a clean copy, and separately, was NOT
   caused by this task's fix either — it's a GET, `retry_pending_sync` never runs on one)

### Progress Log

**2026-08-04**: Split out of T5080 when it became an epic. Motivated by the prod CAS conflict the
same day (see EPIC.md field findings) — correct data handling, wrong user-facing outcome.

**2026-08-29 (round 1 — expert design review)**: found the original clean/dirty-CAS-discriminator
design did not work — the CAS site is unreachable without a write, so "clean" is nearly unreachable
there, and the 2026-08-04 copy was actually dirty (session-init wrote it). Re-scoped to the real
defect: `.sync_pending` was never scoped per-DB.

**2026-08-29 (round 2 — implementation reviewer)**: found the round-1 fix, while correctly scoped,
had two live regressions and one more misattribution: (a) a pending marker on a profile OTHER than
the session's current one was never retried or cleared once the blanket clear was removed, wedging
`/api/sync/flush-verify` 503 forever for that user; (b) a legacy bare marker made every scoped branch
skip while the aggregate stayed true forever, since nothing scoped could ever clear it; (c) the
round-1 write-up over-claimed this fix as 2026-08-04's actual cause, contradicted by that incident's
own `method=GET` log line. All three fixed: `retry_pending_sync` now drains every pending profile via
`list_pending_scopes`, `has_sync_pending_scope` treats a legacy bare marker as pending for every
scope, and EPIC.md/this file now credit finding 1 (in-memory baseline) as 2026-08-04's sole cause.

**2026-08-29 (round 3 — implementation reviewer, BLOCKING)**: found `.sync_pending`'s reason-(a)
clear (upload success) was unconditional — an upload takes real wall-clock time (checkpoint + PUT),
during which a different request can commit a NEWER write to the same scope and re-mark it; the
in-flight upload's success then discharged that newer write's durability record too. Fixed with
compare-and-clear: `mark_sync_pending` now returns a unique token (`read_pending_token` reads it),
`clear_sync_pending(..., if_token=...)` only fires if unchanged. Also revised the legacy-marker plan:
`scope` is now REQUIRED (no `scope=None` back-compat), a stray bare marker is upgraded loudly via the
new `adopt_legacy_pending_marker` instead of served as a permissive dual format. Plus 2 MAJOR + 6
MINOR (foreign-scope crash-safety pre-marking, `_background_sync`'s missing 4th branch, etc.) — all
fixed in the same round.

**2026-08-29 (round 4 — implementation reviewer, BLOCKING)**: found the SAME marker-stomp class round
3 fixed for uploads was still present for restores — `POST /api/retry-sync`'s conflict branch
(`_retry_resolve_conflict`) cleared both scopes' pending markers unconditionally after
`confirm_current_before_write` succeeded, with the identical race (the restore's HEAD-plus-download
spans real time with no lock held). Attempted fix: compare local DB version before/after each restore,
clear only if it changed. Also found `mark_sync_pending`'s token (`str(time.time())`) collided under
load (153/200 in a tight loop on Windows) — fixed with a uuid suffix.

**2026-08-29 (round 5 — implementation reviewer, BLOCKING)**: found round 4's version-delta gate was
ALSO insufficient — the window it measures spans exactly where a concurrent write lands, and a version
can change with NO replace at all (`schedule_*_db_reheal`'s `NOT_FOUND`→0 reset), making "version
differs" neither necessary nor sufficient proof a scope's pending record was discharged. Fixed by
applying the SAME token-based compare-and-clear already proven correct for uploads: capture each
scope's `read_pending_token` before both restores, clear only if unchanged after both complete.

**2026-08-29 (self-found gap, then round 6 reviewer + expert design consult)**: found token-unchanged
alone is necessary but not sufficient — it proves nothing NEWER touched the scope, not that a restore
actually replaced its content. The typically-not-conflicted scope (e.g. user.sqlite alongside a
profile conflict) is usually already current, so clearing it just because the confirm call "succeeded"
would discharge a write R2 never received. Attempted fix: plumb a `downloaded: bool` out of
`confirm_current_before_write` and gate the clear on it. Round 6's reviewer then found (with an
empirical probe) that THIS was also wrong: a CAS conflict schedules a reheal that nulls the cached
version, so the actual restore almost always happens via an ORDINARY intervening request (even a GET)
before the conflict-retry endpoint ever runs — by the time it calls `confirm_current_before_write`,
local is already current and `downloaded` comes back False, even though the scope genuinely was just
restored moments earlier by a different code path. An Opus expert consult then produced the shipped
design: move the clear to every site that actually performs the restore's download+swap (5 sites —
see Solution above), never at a caller trying to guess whether it was the one that restored. This also
surfaced a separate real gap (Finding 3): the conflict-retry endpoint was reporting `restored: True`
without ever uploading a scope that was merely deferred (never behind R2, so its restore was
correctly a no-op) — fixed by having it drain whatever markers survive the two confirms.

**2026-08-30 (round 7 — implementation reviewer)**: reviewed the swap-site design; found it
structurally sound (no BLOCKING/CONFIRMED issue) but: `clear_sync_pending`'s own docstring still told
future callers to omit `if_token` for reason (b) (directly contradicting the INV-P comment and the
actual code — fixed); 4 of the 5 swap sites had zero test coverage (added: `ensure_database`
self-heal-clears-marker + concurrent-remark-survives, `ensure_profile_db_local`'s scope-identity test
proving the clear targets the function's own args not the ambient ContextVar, `_migrate_profile_db`'s
swap-clears test); site 5's token capture brackets the swap rather than the download (documented as
intentional — its download target is a temp file, not the live path, so the live file is genuinely
untouched during the download itself); site 3's `set_local_user_db_version`/`clear_sync_pending` were
gated on different conditions (collapsed to match sites 1/2/4). While adding the site-5 test, found
and fixed a TEST bug (not a production bug): assertions reading `has_sync_pending_scope` were placed
outside the `with patch(...USER_DATA_BASE...)` block, so they silently checked the real filesystem.

## Acceptance Criteria

- [x] A db with nothing pending is never re-uploaded by `retry_pending_sync`/`drain_pending_scopes`
      (the false-conflict class)
- [x] A db that genuinely has a pending write is still retried and, on success, its scope is cleared —
      including a profile OTHER than the one the caller's own request is scoped to
- [x] Clearing one db's pending scope never clears another db's (incl. a different profile of the
      same user, or a different user entirely) — no self-stomp, mirroring T6390's
      `.sync_conflict`/`.sync_failed` guarantee
- [x] A write committed WHILE an upload or restore for the SAME scope is in flight survives that
      operation's clear (compare-and-clear, both INV-P reasons a and b)
- [x] A restore-if-newer clears `.sync_pending` at the site that actually performs it, regardless of
      which request's code path triggered that restore (conflict-retry, an ordinary request racing
      ahead of it, or an admin migration run)
- [x] A stray legacy bare marker is upgraded loudly (`adopt_legacy_pending_marker`), never silently
      served as a permissive dual format
- [x] The healed case is still greppable in logs (distinct INFO/CRITICAL markers, not silence)
- [x] Tests pass (304 tests across the sync/materialization/migration regression set)
