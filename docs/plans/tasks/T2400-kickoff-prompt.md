# T2400 Kickoff Prompt: Grace Period for Expired Games

Implement T2400: Grace Period for Expired Games

Read CLAUDE.md for project rules, workflow stages, coding standards, and agent orchestration before starting.

Read the task file: `docs/plans/tasks/T2400-grace-period-for-expired-games.md`

## Epic Context

This task builds on the Storage Credits epic (T1580-T1583) and is part of the Expired Game Experience epic. Prior tasks already shipped:
- **T1580** (Game Storage Credits): `game_storage_refs` table in auth.sqlite with `storage_expires_at`, `get_expired_refs()`, `delete_ref()`, `has_remaining_refs()`, `get_next_expiry()` in auth_db.py.
- **T1581** (Storage Extension UX): ExpirationBadge, StorageExtensionModal, `POST /games/{id}/extend-storage` endpoint.
- **T1582** (Upload Surcharge): 1-credit auto-export surcharge on uploads.
- **T1583** (Auto-Export Pipeline): `auto_export_game()`, `sweep_scheduler.py` with `do_sweep()`, `_run_sweep_loop()`, background asyncio task. Also `RecapPlayerModal.jsx`.

**Key insight:** Right now, when the last user's storage ref for a hash expires, `do_sweep()` auto-exports the game and **immediately deletes the R2 object**. The user can never extend storage after expiry because the video is already gone. This task adds a 14-day grace period before permanent R2 deletion.

## Design is APPROVED — Skip to Classification + Implementation

The design decision is made: use a new `r2_grace_deletions` table in auth.sqlite (Option B from the task file). This keeps the `game_storage_refs` table clean — no phantom rows.

## Design Decisions

1. **New `r2_grace_deletions` table in auth.sqlite** — Schema: `(blake3_hash TEXT PRIMARY KEY, grace_expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`. Inserted when the last ref for a hash is deleted. Swept when `grace_expires_at < now`.
2. **Grace period = 14 days** — Add `GRACE_PERIOD_DAYS = 14` constant to `sweep_scheduler.py`.
3. **Sweep processes grace deletions after refs** — `do_sweep()` gets a second phase: after processing expired refs, query `r2_grace_deletions` for rows where `grace_expires_at < now`, delete the R2 objects, and remove the rows.
4. **Extension during grace cancels deletion** — When `insert_game_storage_ref()` is called (during extension), check if a grace deletion row exists for that hash and delete it.
5. **`get_next_expiry()` must also consider grace deletions** — The sweep loop sleeps until the next event. It must return the earliest of `MIN(storage_expires_at)` from refs OR `MIN(grace_expires_at)` from grace deletions.
6. **No frontend changes needed** — The game already shows "Expired" with "Extend Storage" when `storage_status === 'expired'`. The extend-storage endpoint already calls `insert_game_storage_ref()`. The only UX difference is that extension now works (the video still exists in R2).

## Implementation Order

### Backend (all changes):

1. **auth_db.py — New table**: Add `r2_grace_deletions` table to `init_auth_db()` schema (after `game_storage_refs` block at line ~183).
   ```sql
   CREATE TABLE IF NOT EXISTS r2_grace_deletions (
       blake3_hash TEXT PRIMARY KEY,
       grace_expires_at TEXT NOT NULL,
       created_at TEXT DEFAULT (datetime('now'))
   );
   ```

2. **auth_db.py — New functions**: Add three functions:
   - `insert_grace_deletion(blake3_hash: str, grace_days: int = 14)` — Insert a row with `grace_expires_at = utcnow() + timedelta(days=grace_days)`. Uses `INSERT OR IGNORE` since a grace row may already exist from a different user's ref expiring first.
   - `get_expired_grace_deletions() -> list[str]` — Returns blake3_hashes where `grace_expires_at < now`.
   - `delete_grace_deletion(blake3_hash: str)` — Remove a grace row (used after R2 deletion or when a ref is re-inserted).

3. **auth_db.py — Modify `insert_game_storage_ref()`**: After the INSERT OR REPLACE at line ~951, add: `db.execute("DELETE FROM r2_grace_deletions WHERE blake3_hash = ?", (blake3_hash,))`. This cancels any pending grace deletion when a user extends storage.

4. **auth_db.py — Modify `get_next_expiry()`**: Currently queries only `game_storage_refs`. Must also query `MIN(grace_expires_at)` from `r2_grace_deletions` and return the earliest of the two.

5. **sweep_scheduler.py — Modify `do_sweep()`**: Replace the immediate R2 deletion at lines 119-121 with a grace insertion:
   ```python
   # OLD:
   if not has_remaining_refs(blake3_hash):
       r2_delete_object_global(f"games/{blake3_hash}.mp4")
   
   # NEW:
   if not has_remaining_refs(blake3_hash):
       insert_grace_deletion(blake3_hash)
   ```
   Then add a second phase at the end of `do_sweep()`:
   ```python
   # Phase 2: delete R2 objects whose grace period has elapsed
   grace_expired = get_expired_grace_deletions()
   for blake3_hash in grace_expired:
       r2_delete_object_global(f"games/{blake3_hash}.mp4")
       delete_grace_deletion(blake3_hash)
   ```

6. **sweep_scheduler.py — Update imports**: Add `insert_grace_deletion`, `get_expired_grace_deletions`, `delete_grace_deletion` to the auth_db import block at lines 13-18.

7. **Tests — Update test_sweep_scheduler.py**: Modify `TestDoSweep` tests:
   - `test_sweep_processes_ref`: Mock `insert_grace_deletion` instead of `r2_delete_object_global`. Verify grace insertion, NOT R2 deletion.
   - `test_sweep_skips_r2_delete_when_refs_remain`: Verify `insert_grace_deletion` is NOT called when other refs exist.
   - Add `test_sweep_grace_phase_deletes_expired`: Mock `get_expired_grace_deletions` returning hashes → verify `r2_delete_object_global` + `delete_grace_deletion` called.
   - Add `test_sweep_grace_phase_empty`: Mock `get_expired_grace_deletions` returning [] → verify no R2 deletions.

8. **Tests — Update test_auth_db_storage_refs.py**: Add tests for:
   - `TestInsertGraceDeletion`: basic insert, idempotent (INSERT OR IGNORE), grace_expires_at is ~14 days from now.
   - `TestGetExpiredGraceDeletions`: returns only past grace rows, ignores future.
   - `TestDeleteGraceDeletion`: removes row, no-op for nonexistent.
   - `TestInsertRefClearsGrace`: calling `insert_game_storage_ref()` removes any grace row for that hash.
   - `TestGetNextExpiryWithGrace`: returns the earlier of ref expiry vs grace expiry.

## Code Paths (exact locations)

### `sweep_scheduler.py` — Where to change

- **Lines 13-18**: Import block. Add `insert_grace_deletion`, `get_expired_grace_deletions`, `delete_grace_deletion`.
- **Lines 119-121**: The R2 deletion decision point. Currently: `if not has_remaining_refs → r2_delete_object_global`. Change to: `if not has_remaining_refs → insert_grace_deletion`.
- **After line 121**: Add Phase 2 — grace expiration processing.
- **Line 29**: Add `GRACE_PERIOD_DAYS = 14` constant.

### `auth_db.py` — Where to change

- **Lines 170-183**: `game_storage_refs` schema block in `init_auth_db()`. Add `r2_grace_deletions` CREATE TABLE after line 183.
- **Lines 940-956**: `insert_game_storage_ref()`. Add `DELETE FROM r2_grace_deletions WHERE blake3_hash = ?` inside the same `with get_auth_db()` block, before `db.commit()`.
- **Lines 1020-1032**: `get_next_expiry()`. Add a second query against `r2_grace_deletions` for `MIN(grace_expires_at) WHERE grace_expires_at > now`, return the earlier datetime.
- **After line 1032**: Add the three new functions: `insert_grace_deletion`, `get_expired_grace_deletions`, `delete_grace_deletion`.

### `games.py` — Expired game display (potential issue)

- **Lines 650-681**: `list_games()` derives `storage_status` from `expiry_by_hash.get(row['blake3_hash'])`. After the sweep deletes the ref, `expiry_by_hash` won't contain the hash, so `storage_status` falls through to `'active'` (line 681). **This is a bug for grace period games**: an expired game whose ref was deleted should show `'expired'`, not `'active'`. Fix: when `expires_at_str` is None and the game has `auto_export_status` set (indicating it was swept), treat it as expired.

### `games.py` — Extension during grace

- **Lines 733-793**: `extend_game_storage()`. Calls `insert_game_storage_ref()` at lines 778-781 for each game_video hash. Since we're adding `DELETE FROM r2_grace_deletions` inside `insert_game_storage_ref()`, no changes needed here — grace is cleared automatically.
- **Lines 763-769**: Current expiry logic. When `ref` is None (grace period, ref already deleted), `base = datetime.utcnow()` — extension starts from now. This is correct behavior.

### Frontend — No changes needed

- **`ProjectManager.jsx:1134`**: `isExpired = game.storage_status === 'expired'` — already handles expired display.
- **`StorageExtensionModal.jsx:40`**: If `storage_expires_at` is in the past, `currentExpiry = new Date()` — extension starts from now. Already correct.
- **`ExpirationBadge.jsx:14`**: Shows badge for < 14 days remaining, shows "Expired" when `daysLeft <= 0`. Already correct.
- The only frontend issue is that expired games in grace period currently show `storage_status = 'active'` due to the missing ref (see games.py issue above). Once the backend fix is applied, the frontend will correctly show "Expired".

## Critical Gotchas

### The `list_games` storage_status bug
After `do_sweep()` deletes a user's ref, `get_storage_refs_for_user()` returns no entry for that hash. `list_games()` at line 673-681 falls through to `storage_status = 'active'`. This makes expired games appear active during the grace period — the user can't tell they need to extend. Fix this by checking `auto_export_status` as a secondary signal: if the game has been auto-exported (status = 'complete'/'failed'/'skipped'), it's post-expiry.

### `get_next_expiry()` must account for grace deadlines
The sweep loop at `_run_sweep_loop()` (lines 62-68) sleeps until `get_next_expiry()`. If the only pending event is a grace deletion (no active refs), the current `get_next_expiry()` returns None → sleeps for 24h. The sweep might miss grace deletions by up to 24h. Fix by including `MIN(grace_expires_at)` in the query.

### `insert_game_storage_ref` uses INSERT OR REPLACE
At auth_db.py line 951, the function uses `INSERT OR REPLACE`. When a user extends during grace, this re-inserts the ref. The grace deletion row must be cleaned up in the same transaction to avoid a race where the sweep sees the grace row and deletes R2 before the ref insert completes.

### Grace deletions should be INSERT OR IGNORE
Multiple users may have refs to the same hash. When user A's ref expires, the sweep calls `delete_ref(A)` then checks `has_remaining_refs()`. If user B's ref also expired in the same sweep run, user B's iteration will also try to insert a grace deletion for the same hash. Use `INSERT OR IGNORE` to handle this idempotently.

### `sync_auth_db_to_r2()` is called in `delete_ref()` and `insert_game_storage_ref()`
Both functions already sync auth.sqlite to R2 after writes. The new grace deletion functions should also sync (they modify auth.sqlite). Use the same `sync_auth_db_to_r2()` pattern.

### Multi-video games during grace period
A multi-video game has multiple blake3_hashes. Each hash gets its own grace deletion row. If the user extends one hash (e.g., extends the game), `insert_game_storage_ref()` is called for ALL hashes in the game (games.py lines 772-781), clearing all grace rows. This is correct behavior.

### The sweep should NOT re-run auto-export during grace phase
Auto-export happens when the ref expires (Phase 1 of the sweep). Phase 2 (grace expiration) only deletes R2 objects — it should NOT call `auto_export_game()` again. The game was already exported when the ref expired.

## Prior Task Learnings

- **T1583 (earlier this session)**: `storage_expires_at` was removed from the games table — auth_db is the single source of truth. `list_games()` derives expiry from `get_storage_refs_for_user()`.
- **T1583**: Sweep processes refs per-user, not per-hash. R2 deletion only happens when `has_remaining_refs()` returns False.
- **T1583**: Background tasks need explicit ContextVars (`set_current_user_id`, `set_current_profile_id`) and `ensure_database()` before accessing per-user DBs.
- **T1583**: `sync_auth_db_to_r2()` is called via `_r2_enabled()` check — in tests, monkeypatch `_r2_enabled` to return False.
- **T1583 test patterns**: Tests use `@patch(f"{M}.function_name")` decorator stacking. Sweep tests mock `get_expired_refs`, `delete_ref`, `has_remaining_refs`, `r2_delete_object_global`, `auto_export_game`, `ensure_database`. Auth_db tests use `temp_auth_db` fixture with `monkeypatch.setattr(auth_db, "AUTH_DB_PATH", db_path)`.

This task should NOT require any frontend changes. The backend changes are isolated to `auth_db.py` and `sweep_scheduler.py` plus their test files.
