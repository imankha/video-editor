# Code Expert Report — T5083: JIT migrate at the per-user DB-load seam

READ-ONLY audit (Stage 1). All line anchors are post-T5081, verified against the working tree.

## §1 Restore seam anatomy

### 1a. `ensure_database()` — profile.sqlite — `src/backend/app/database.py:1023`

Signature: `def ensure_database()` (no args; reads `get_current_user_id()` / `get_current_profile_id()` from ContextVars). Called by `get_db_connection()` (`database.py:1698`) before every profile.sqlite connection, and by `session_init._ensure_database_with_context` during boot.

Exact ordered sequence:

1. `database.py:1032` — `user_id = get_current_user_id()`; `db_path = get_database_path()` (ContextVar-derived).
2. `database.py:1037` — `already_initialized = user_id in _initialized_users and db_path.exists()`.
3. `database.py:1040` — `ensure_directories()`.
4. `database.py:1045` — `if R2_ENABLED:` → `profile_id = get_current_profile_id()`; `local_version = get_local_db_version(user_id, profile_id)` (1047).
5. `database.py:1050` — **restore branch fires ONLY when `local_version is None`** (first access, or a reheal that nulled the cache). This is the hot-path short-circuit: an already-loaded profile has a cached version and skips this entire block — **no R2 round trip**.
   - 1052-1055: cooldown check (`_r2_restore_cooldowns`).
   - 1083: `pending_token = read_pending_token(user_id, profile_id)` (INV-P capture BEFORE download).
   - 1084-1087: `sync_database_from_r2_if_newer(..., before_download=lambda: not wal_sidecars_present(db_path))` — WAL guard gates the actual download+swap.
   - 1089-1122 (`was_synced` branch): `clear_stale_wal_sidecars(db_path)` → T7010 mid-write-heal CRITICAL log → **`set_local_db_version(user_id, profile_id, new_version)` (1121)** → **`clear_sync_pending(user_id, profile_id, if_token=pending_token)` (1122)** → `already_initialized = False` (1124).
   - 1125-1146: error → cooldown; `new_version is not None` (up-to-date, no download) → `set_local_db_version(...)`; else NOT_FOUND → `set_local_db_version(..., 0)`.
6. `database.py:1149` — `if already_initialized: return` (skips table creation).
7. `database.py:1153-1673` — open raw `sqlite3.connect`, `CREATE TABLE IF NOT EXISTS ...` (idempotent), and at **1669-1671 `if is_fresh_db: PRAGMA user_version = PROFILE_DB_RUNNER.latest_version`** — the ONLY user_version write, and ONLY for a brand-new DB.
8. `database.py:1675` — `_initialized_users.add(user_id)`; `conn.close()` (1679).

**Candidate insertion point for the JIT migration call:** between step 5 (restore-then-clear complete, `set_local_db_version`/`clear_sync_pending` done) and step 6's `already_initialized` return. On an already-initialized hot request the code never enters the restore block at all and returns at 1149. A migration call placed inside the `local_version is None` block runs only on first access, which is "before the first connection opens and before the first read" for that process — but it must run on the SWAPPED-IN bytes, so it belongs AFTER `set_local_db_version` (1121) / the up-to-date branch (1139), operating on `db_path`. The existing code opens a fresh `sqlite3.connect` for table creation at 1154; a migration runner (`PROFILE_DB_RUNNER.run(conn, "sqlite")`) could share that connection or run its own, but it must run BEFORE `_initialized_users.add` so a subsequent hot request treats the DB as at-head.

**WAL/marker interaction the Architect must preserve:** the restore-then-clear sequence (download → `clear_stale_wal_sidecars` → `set_local_db_version` → `clear_sync_pending(if_token=...)`) is the INV-P compare-and-clear. A migration that itself uploads (post-migration `sync_db_to_r2_explicit`) will re-clear the pending marker via reason (a); a migration that does NOT change bytes must not clear or re-mark anything. The migration must run AFTER `clear_stale_wal_sidecars` (no live sidecars) so its own `PRAGMA user_version` write + `PROFILE_DB_RUNNER.run` doesn't race a WAL replay.

**At-head no-op concern:** `PROFILE_DB_RUNNER.run(conn, "sqlite")` gates on `PRAGMA user_version` (SQLite track pending = `> current`). If already at head it applies nothing — cheap, one `PRAGMA user_version` read. But the version-cache short-circuit at step 5 means on the hot path (`local_version` not None) `ensure_database` returns at 1149 without opening any connection at all; a migration call would need to either (a) live inside the first-access block (runs once per process per profile, cheap thereafter because `_initialized_users` gates it), or (b) add its own guard so it doesn't reopen a connection on every hot request.

### 1b. `ensure_user_database()` — user.sqlite — `src/backend/app/services/user_db.py:122`

Signature: `def ensure_user_database(user_id: str) -> None`. Explicit `user_id` arg (no ContextVar for identity).

Exact ordered sequence:
1. `user_db.py:129-136` — under `_init_lock`: if `user_id in _initialized_user_dbs` and file exists → return; else discard the flag.
2. `user_db.py:138-139` — `db_path`, mkdir.
3. `user_db.py:151` — `if R2_ENABLED:` → `local_version = get_local_user_db_version(user_id)` (152).
4. `user_db.py:157` — restore branch fires when `local_version is None or not db_path.exists()`.
   - 158-161: cooldown.
   - 186: `pending_token = read_pending_token(user_id, USER_DB_SCOPE)` (INV-P capture).
   - 187-190: `sync_user_db_from_r2_if_newer(..., before_download=lambda: not wal_sidecars_present(db_path))`.
   - 192-199 (`was_synced`): `clear_stale_wal_sidecars` → **`set_local_user_db_version(user_id, new_version)` (198)** → **`clear_sync_pending(user_id, USER_DB_SCOPE, if_token=pending_token)` (199)**.
   - 200-218: error/up-to-date/NOT_FOUND branches mirror the profile path.
5. `user_db.py:220-233` — `is_fresh_db = not db_path.exists()`; open, `executescript(_USER_DB_SCHEMA)`; **`if is_fresh_db: PRAGMA user_version = USER_DB_RUNNER.latest_version` (229-231)**; close.
6. `user_db.py:239-240` — under `_init_lock`: `_initialized_user_dbs.add(user_id)`.

**Candidate insertion point:** after the restore block records the baseline/clears pending (~`user_db.py:219`) and after schema creation, but BEFORE `_initialized_user_dbs.add`. Same at-head-no-op shape: `USER_DB_RUNNER.run` gates on `PRAGMA user_version`; user_db head is v006.

`_migrate_user_db` relationship: today `migrations._migrate_user_db(user_id)` (`migrations/__init__.py:189`) is the ONLY thing that runs `USER_DB_RUNNER.run` on user.sqlite — it calls `ensure_user_database(user_id)` first (restore), then opens a raw connection, runs the runner, and syncs up if applied (206). It never swaps bytes itself, so there is **no INV-P clear in `_migrate_user_db`** — it relies on `ensure_user_database`'s clear.

### 1c. `ensure_user_database_fresh()` — `src/backend/app/services/user_db.py:262`

Write-path sibling (T4315). Calls `ensure_user_database(user_id)` first (299), then does its OWN restore-if-newer with `sync_user_db_from_r2_if_newer` (319-322), and at 331-338 `set_local_user_db_version` + `clear_sync_pending` (INV-P site 3). Raises `RefreshFailed` on R2 error (323-326). This is a SECOND download+swap site for user.sqlite on the WRITE path — a JIT migration relocated here would double-fire unless keyed off `_initialized_user_dbs` / version cache.

## §2 Migration primitives — `src/backend/app/migrations/__init__.py`

### `_migrate_user(user_id)` — line 133
- Returns `{any_applied, errors, orphans}`. **Context assumption:** takes explicit `user_id`; does NOT set ContextVars itself at the top. Calls `_migrate_user_db(user_id)` (149), reads the registry via `get_profiles(user_id)` (155), lists R2 orphans via `_get_profile_ids` (165), iterates `sorted(registered_ids)` calling `_migrate_profile_db(user_id, profile_id)` (173).
- **Opens no connection itself**; delegates. Registry-authoritative (only registered profiles migrated; orphans logged, never migrated — INV #1, T4830).
- **Runs OUTSIDE a request context today** (admin sweep). Does NOT set `user_id`/`profile_id` ContextVars at the `_migrate_user` level — only `_migrate_profile_db` sets them.

### `_migrate_profile_db(user_id, profile_id)` — line 211
- **Force-downloads** the canonical R2 profile.sqlite to `profile.sqlite.migrating_tmp` via `_download_profile_db` (245), which fetches bytes+`db-version` metadata in ONE `get_object` (452-496, T6340 atomicity).
- Decision tree (250-378):
  - `local_version > r2_version` (schema ahead): keep local, `set_current_user_id`/`set_current_profile_id` (273-274), `sync_db_to_r2_explicit` up; refuse (`sync_failed`) on CAS conflict (275-279).
  - T6410 keep-local guard (281-320): if `local_baseline is not None and > 0 and >= downloaded_sync_version` → keep local, migrate in place.
  - else R2 canonical (321-372): **WAL guard** `if wal_sidecars_present(db_path): return MigrateResult(status="wal_busy")` (354-361); else `pending_token = read_pending_token` (366) → `shutil.move(tmp, db_path)` (367) → `clear_stale_wal_sidecars` (370) → **`set_local_db_version(user_id, profile_id, downloaded_sync_version)` (371)** → **`clear_sync_pending(user_id, profile_id, if_token=pending_token)` (372)** (INV-P site 5).
- Then `set_current_user_id`/`set_current_profile_id` (385-386), open raw `sqlite3.connect`, **`PROFILE_DB_RUNNER.run(conn, "sqlite")` (391)**, close.
- If `applied` → `sync_db_to_r2_explicit(user_id, profile_id)` (395); failure → `sync_failed` with real r2_version.
- Always re-verifies in R2 (405-409): `_read_r2_profile_user_version == head`, else `not_at_head`.
- **Refusal shapes:** `MigrateResult.status` ∈ `ok | sync_failed | not_at_head | missing | download_failed | wal_busy` (dataclass at line 14-23).
- **Context assumption:** SETS `set_current_user_id`/`set_current_profile_id` explicitly (273-274/385-386) because migrations like v002 read `get_current_user_id()`. It **downloads the profile DB itself** (does NOT assume local) — always force-downloads to a temp and decides swap-vs-keep. Key JIT tension: at the `ensure_database` seam the restore ALREADY downloaded and swapped; `_migrate_profile_db`'s force-download would be a SECOND download of the same bytes.

### `_migrate_user_db(user_id)` — line 189
- `ensure_user_database(user_id)` (193, restore), raw connect (198), `USER_DB_RUNNER.run` (201), `sync_user_db_to_r2_explicit` if applied (206). No ContextVar set. No own INV-P clear (relies on `ensure_user_database`).

## §3 Concurrency — `_get_user_write_lock` / write serialization

- `_get_user_write_lock(user_id)` — `db_sync.py:253` — returns an **`asyncio.Lock`** (245), **keyed on `user_id` ONLY** (not user+profile). **NOT reentrant**.
- Acquisition: `_maybe_write_lock(user_id, method, path, req_id)` (`db_sync.py:264`) — `@asynccontextmanager`; **no-op for reads** (`method not in WRITE_METHODS` → bare `yield`, 266-268). Only POST/PUT/PATCH/DELETE acquire (`WRITE_METHODS`, 244). Wrapped at **`db_sync.py:988`** `async with _maybe_write_lock(...): response = await self._sync_aware_flow(...)`.
- **Reuse feasibility at the READ seam:** A GET does NOT hold this lock. A JIT migration triggered from `ensure_database` on a READ request runs with NO write-lock protection — two concurrent GETs for the same user (different profiles, or same profile first-access) could both enter the restore/migration path. Existing protection: `session_init._get_init_lock(user_id)` (threading lock) serializes boot init, and `user_db._init_lock` / `_initialized_user_dbs` guard user.sqlite; but profile.sqlite `ensure_database` has NO per-profile lock around its restore block — relies on `_initialized_users`/version-cache being process-global under the single-process model. Because the lock is `asyncio`, user-keyed, non-reentrant, and not held on reads, a migration at the read seam **cannot simply reuse the write lock**. The Architect must decide: a dedicated per-(user,profile) migration lock, or piggyback on the existing `_initialized_users` gate.

## §4 Caches & at-head no-op

Four caches govern whether the seam does R2 work:
- `_initialized_users: set` (`database.py:42`, profile.sqlite) — `ensure_database` adds (1675); `forget_local_db_state` (1785-1792) and reheal (via version-null) drop. Gates table-creation skip (`already_initialized`, 1149) but NOT the R2 restore (restore gated by `local_version`).
- `_user_db_versions: dict[(user,profile)->int]` (`database.py:45`) — profile SYNC baseline. `get_local_db_version` (747) prefers in-memory, falls back to the file's `db_version` row (2026-08-04 stale-baseline mechanism, 760-785). **`local_version is None` is the sole trigger for the restore branch.** `set_local_db_version` (807) writes both cache and file row.
- `_user_sqlite_versions: dict[user->int]` (`database.py:2063`, user.sqlite) — memory-only, no file row. `get_local_user_db_version` (2067) / `set_local_user_db_version` (2073).
- `_initialized_user_dbs: set` (`user_db.py:34`) — user.sqlite init flag; `ensure_user_database` early-returns on membership (130) BEFORE checking version; `schedule_user_db_reheal` drops the flag, not just the version (user_db.py:247-258).

**At-head cheap path:** once `local_version` is cached (not None), `ensure_database` skips restore entirely and, if `already_initialized`, returns at 1149 with zero SQLite/R2 work. A JIT migration must hang off the SAME first-access gate (or an equivalent per-process "migration checked" flag) so it runs once per (process, profile) and costs one `PRAGMA user_version` at most on the cold path, nothing on hot requests. Running `PROFILE_DB_RUNNER.run` unconditionally on every `get_db_connection` would reopen a connection per read — a regression against the T6200 concurrency model.

## §5 Orphan-profile handling today

- **Read path never consults the registry for profile DB access.** `ensure_database` uses the ContextVar `profile_id` directly (`get_database_path()`), opens/creates whatever profile.sqlite that points at. No `get_profiles`/registry check inside `ensure_database`, `get_db_connection`, or `ensure_directories`.
- **Registry consulted at the request BOUNDARY only** (T7520 ownership guard): `db_sync.py:922` `peek_registered_profile_ids(user_id)` / `db_sync.py:928-930` `load_registered_profile_ids` — an `X-Profile-ID` not in the registry gets a **404 before `set_current_profile_id`** (`db_sync.py:931-943`, `[PROFILE_GUARD]`). `session_init._init_slow_path` validates `hint_profile_id` (225). Exceptions: `/api/shared/` placeholder header bypasses (919-920); background workers and share materialization open non-registered profiles legitimately.
- **The sweep's orphan policy** (`_migrate_user`, `migrations/__init__.py:164-168`): R2 profile dirs not in `get_profiles` logged + collected in `orphans`, never migrated, never errored (INV #1). `_get_profile_ids` (414) lists R2 prefixes.
- **Net for JIT:** because the T7520 guard already 404s a foreign/unregistered `X-Profile-ID` at the boundary, a request that REACHES `ensure_database` has a registry-owned profile (or is a share/worker path). So a seam-based migration inherits "registered ⇒ migrate" for free on the request path — but the Architect must state policy for the non-guarded entry points (share `/api/shared/` placeholder, `ensure_profile_db_local` sharer resolution, workers).

## §6 Seam-bypass / bug-smell list

Callers that open a profile.sqlite / user.sqlite WITHOUT going through `ensure_database`/`ensure_user_database`:

1. **`materialization._open_profile_db`** (`materialization.py:34`) — raw `sqlite3.connect`, **opens locally-cached only, does NOT download or migrate**. Reached via `ensure_profile_db_local` (which DOES restore + INV-P clear at 103-120, but does NOT migrate) and `open_profile_db_readonly` (141, `mode=ro`). Share materialization, move-reels, admin analytics (T7860) read here. A JIT-at-`ensure_database` migration would NOT fire for these paths (T6780 "materialization opens raw, only R2-syncs never migrates" reachability).
2. **`sweep_scheduler.do_sweep`** (`sweep_scheduler.py:122`) — iterates ALL R2 profiles via `_get_profile_ids` (134, orphans included), sets ContextVars, calls `ensure_database()` (137) then `get_db_connection()` (365). Goes THROUGH the seam, but on a background thread with no request context and no write lock; a JIT migration here would fire for orphans too.
3. **`migrations._migrate_profile_db` / `_read_r2_profile_user_version` / `_download_profile_db`** — open raw `sqlite3.connect` on temp files (`__init__.py:388, 520, 481`); these ARE the primitives.
4. **`_migrate_user_db`** opens raw connect (198) after `ensure_user_database`.
5. The profile-DB access convention is `get_db_connection` (which calls `ensure_database`) — the raw-open exceptions are the materialization family (#1) and the migration/verify temp files (#3).

**Ordering hazards:**
- None found on the profile-DB request path: `get_db_connection` calls `ensure_database()` BEFORE `sqlite3.connect` (`database.py:1698` then 1701).
- **WAL-swap safety already enforced** at all four swap sites via `wal_sidecars_present` before_download + `clear_stale_wal_sidecars` after. A JIT migration that swaps or `PRAGMA user_version`-writes must sit AFTER `clear_stale_wal_sidecars` and AFTER `set_local_db_version`, never between the check and the move.

**⚠️ BUG SMELL: Context assumption mismatch (sweep vs request path).** `_migrate_user`/`_migrate_profile_db` were written for the admin sweep (ContextVar-free entry; `_migrate_profile_db` SETS the ContextVars itself at 273-274/385-386). JIT runs on the request path where the ContextVars are ALREADY set. Re-setting them is harmless, but `_migrate_profile_db` **force-downloads the profile DB again** (245) even though `ensure_database`'s restore just downloaded+swapped it — a redundant `get_object` on the JIT hot path, and its T6410 keep-local decision tree re-runs against a baseline the seam just set. ROOT CAUSE: the primitive bundles "acquire the canonical bytes" with "apply migrations"; the seam has already acquired the bytes. RECOMMEND the Architect decide whether JIT calls the full `_migrate_profile_db` (accepting the double download / relying on the T6410 keep-local branch to no-op the swap) or a leaner "run `PROFILE_DB_RUNNER.run` on the already-restored local file + sync-if-applied" primitive extracted from it.

## §7 Open questions for the Architect

1. **Which seam(s) get the trigger** — `ensure_database` (profile) + `ensure_user_database` (user) both, or a new wrapper? `ensure_user_database_fresh` and `ensure_profile_db_local` are ADDITIONAL download+swap sites a purely-`ensure_database` trigger would miss (bypass #1).
2. **Full `_migrate_profile_db` vs a leaner extracted primitive** — former double-downloads on the JIT hot path; latter must re-implement post-migration sync + R2 verify + INV-P clear without the force-download/keep-local decision tree.
3. **Locking at the read seam** — write lock is `asyncio`, user-keyed, non-reentrant, not held on reads. New per-(user,profile) migration lock, or piggyback on `_initialized_users`/version-cache? How to avoid re-entrancy deadlock when a WRITE request (already holding the user write lock) triggers the migration?
4. **At-head no-op gating** — hang off the `local_version is None` first-access gate vs an independent "migration checked this process" flag? Must not add a `PRAGMA user_version` read to every hot `get_db_connection`.
5. **Orphan / non-registered profile policy** — the T7520 guard 404s foreign profiles before the seam, but `/api/shared/` placeholder, `ensure_profile_db_local` sharer resolution, and workers reach a DB without that filter. Migrate-then-serve, refuse, or repair for each?
6. **Sweep interaction** — JIT and the admin `run_all_migrations()` sweep now both mutate the same DBs; sweep migrates orphans-excluded on a background thread. Does the sweep still exist as bulk backstop, and does JIT's INV-P clear + R2 verify match the sweep's so a DB migrated by either path is byte/version-identical?
7. **Post-migration sync semantics on a READ request** — `_migrate_profile_db` calls `sync_db_to_r2_explicit` when it applies. On a GET (no write lock, no `has_writes` flag), issuing an R2 upload from inside `ensure_database` is a write triggered by a read — does this violate gesture-based persistence, or is a schema migration a sanctioned exception (as the sweep already is)? Sharpest design question: a migration that uploads at `r2_version+1` on an ordinary read request is a write with no user gesture.
8. **`not_at_head` / `sync_failed` / `wal_busy` on the request path** — sweep records these in a results dict; on a live request, does a failed JIT migration 503, serve-stale-and-log, or fall through to the un-migrated DB (risking the very `no such column` the migration-window guards defend against, T5970)?
