# T6770 Design — Replace `game_ref_counts.ref_count` with a derived ref-set

**Status:** DESIGN — awaiting user approval (design gate). Do not implement until approved.
**Tier:** L · **Layer:** Backend (Postgres) only · **Gates:** IRREVERSIBLE R2 game-video deletion.

---

## 1. Current state (as-built, verified in code)

### Three stores, one datum
The "does anyone still want game video `{blake3}.mp4`?" question is answered from three
places today:

| Store | Location | Role | Source of truth? |
|---|---|---|---|
| `game_storage` | per-profile **SQLite** (`profile.sqlite`) | per-profile expiry, drives UI + sweep Phase 1 | **YES** (per-profile) |
| `game_ref_counts` | **Postgres** aggregate | `ref_count` INTEGER + `latest_expiry`; drives sweep Phase 2 scheduling / grace queueing | no — hand-maintained cache |
| `game_storage_refs` | **Postgres** per-profile rows | `(user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)`, `UNIQUE(user_id,profile_id,blake3_hash)` | **DEAD — no writer** |

### How they got this way (root-cause of BOTH prod findings)
`migrations/postgres/v002_game_ref_counts.py` **created** `game_ref_counts` by aggregating the
then-live per-profile ref-set:
```sql
INSERT INTO game_ref_counts (blake3_hash, ref_count, latest_expiry)
SELECT blake3_hash, COUNT(*), MAX(storage_expires_at) FROM game_storage_refs GROUP BY blake3_hash
```
i.e. v002 **replaced the per-profile ref-set with a bare aggregate counter**, and T2930 then
moved per-profile expiry into SQLite `game_storage`. After that, **nothing writes the Postgres
`game_storage_refs` table** (confirmed: zero `INSERT INTO game_storage_refs` in the codebase —
the only mentions are the two migrations that *read* it and stale comments). This is the exact
provenance of the two evidence findings the task requires explaining:

- **2026-08-24 (prod): `game_storage_refs` dead since May.** ✅ Explained. It lost its writer at
  the v002/T2930 refactor; the 8 residual rows (newest 2026-05-15) are pre-refactor sediment.
  Recent uploaders having no `game_storage_refs` row is the *designed* post-T2930 state, **not a
  new regression.** The real question the finding raises — "does `game_ref_counts` share the gap?"
  — is the missing-row drift below.
- **2026-08-11 (dev): `game_ref_counts` MISSING for imankh games 2/3/5** while SQLite
  `game_storage` rows are active. ✅ Root-caused to a structural coupling bug in
  `insert_game_storage_ref` (auth_db.py:391-412):
  ```python
  is_new = (sqlite INSERT OR IGNORE rowcount == 1)   # novelty of the SQLite row
  if is_new:  INSERT ... game_ref_counts ... ON CONFLICT DO UPDATE ref_count = ref_count + 1
  else:       UPDATE game_ref_counts SET latest_expiry = ... WHERE blake3_hash = %s   # NO-OP if row absent
  ```
  The Postgres counter mutation is gated on whether the **SQLite** row was new — a novelty flag
  from a *different database with no spanning transaction*. If the SQLite row already exists but
  the PG counter row does not (PG write lost to a crash between the two commits; a purge/reset
  that cleared PG but not SQLite; the v002 aggregate never having a row for a hash whose SQLite
  row predates it), the `else` branch `UPDATE ... WHERE blake3_hash` matches **zero rows** and the
  counter row **stays missing forever** — there is no create-if-absent on the non-new path. The
  counter can under-count or vanish and never self-heal outside the sweep's recount.

Both findings are the **same class**: an independently-stored count that can diverge from the
per-profile source of truth. The 2026-07-24 point-fixes (decrement floor, Phase-2 authoritative
recount, T5850 heal) made the *delete* safe but left the driftable state in place.

### Every call site touching the Postgres count today
Reads (`game_ref_counts`):
1. `auth_db.has_remaining_refs(hash)` → `SELECT ref_count ... ref_count > 0` (sweep Phase 1, decides grace queue).
2. `auth_db.get_next_expiry()` → `MIN(latest_expiry) WHERE ref_count > 0` (sweep sleep scheduling).
3. `auth_db.heal_ref_count(hash, true_count)` → `UPDATE ref_count = %s` (sweep Phase 2 drift heal).

Writes (`game_ref_counts`):
4. `auth_db.insert_game_storage_ref(...)` — the `is_new`-gated increment above (auth_db.py:391-412).
5. `auth_db.delete_ref(...)` — `UPDATE ref_count = GREATEST(ref_count - 1, 0)` (auth_db.py:480).

Callers of those writers (unchanged signatures, all already pass `user_id, profile_id, hash`):
- `insert_game_storage_ref`: games.py:586/759/1483 (`_ensure_game_storage_refs`, activate, extend),
  materialization.py:695 (`_create_game_storage_refs`, share recipient), profile_db migration
  v017 backfill.
- `delete_ref`: sweep_scheduler.py:172 (Phase 1), games.py:1764 (delete game), games_upload.py:735.

Reads of the **SQLite** source of truth (the Phase-2 delete gate — **stays as-is**):
- `count_refs_in_profile` / `_count_refs_all_profiles` (sweep_scheduler.py) — authoritative recount
  across all profiles before an irreversible delete. This is the real safety net and is untouched.

Account-deletion FK site (privacy.py:246-256): `game_storage_refs` has
`user_id ... REFERENCES users(user_id)` with **no ON DELETE CASCADE**. Dead today, so `DELETE FROM
users` rarely trips it. **Making the table live turns this into a regression** (see §5, must-fix).

---

## 2. Target state

**Make the per-profile ref-set the single Postgres representation, and derive the count.**
Revive the `game_storage_refs` table (its schema is already exactly right) as the *live,
authoritative* projection of every profile's SQLite `game_storage` rows, and retire the
`game_ref_counts` aggregate. The count is then `COUNT(*)` over real rows and **cannot drift by
construction** — there is no stored integer to disagree with reality.

This is a deliberate reversal of v002: v002 turned the ref-set into a counter (introducing drift);
T6770 turns the counter back into a ref-set (removing drift), but this time keeps every writer
maintaining it as a faithful projection.

### Table (repurpose existing `game_storage_refs`, unchanged shape)
```
game_storage_refs(
  id SERIAL PK,
  user_id TEXT NOT NULL REFERENCES users(user_id),
  profile_id TEXT NOT NULL,
  blake3_hash TEXT NOT NULL,
  game_size_bytes BIGINT NOT NULL,
  storage_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, profile_id, blake3_hash)         -- one row per (profile, video)
)  -- idx_game_refs_hash, idx_game_refs_user already exist
```
Derived quantities (no stored aggregate):
- `ref_count(hash)` ≡ `SELECT COUNT(*) FROM game_storage_refs WHERE blake3_hash=%s`
- `latest_expiry(hash)` ≡ `MAX(storage_expires_at)` — for grace scheduling
- `next_expiry` ≡ `MIN(storage_expires_at)` over all rows (every row *is* a live ref, so the old
  `WHERE ref_count > 0` guard disappears)

### Call-site rewrites (§1 numbering)
1. `has_remaining_refs` → `SELECT EXISTS(SELECT 1 FROM game_storage_refs WHERE blake3_hash=%s)`.
2. `get_next_expiry` → `MIN(storage_expires_at) FROM game_storage_refs` (grace `MIN` unchanged).
3. `heal_ref_count` → **DELETED.** A derived count has nothing to heal; remove the function AND
   its sweep call site (sweep_scheduler.py:218). The Phase-2 ABORT branch keeps its ERROR log and
   `delete_grace_deletion`; it simply no longer heals a counter. *(This is a net simplification —
   the whole "recount and heal the drift-prone counter" concept is designed out.)*
4. `insert_game_storage_ref` → replace the `is_new`-gated `game_ref_counts` write with an
   idempotent per-profile upsert, keyed on the actual pair (no cross-DB novelty gate):
   ```sql
   INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)
   VALUES (%s,%s,%s,%s,%s)
   ON CONFLICT (user_id, profile_id, blake3_hash)
     DO UPDATE SET storage_expires_at = GREATEST(game_storage_refs.storage_expires_at, EXCLUDED.storage_expires_at),
                   game_size_bytes    = EXCLUDED.game_size_bytes
   ```
   The SQLite `game_storage` write in the same function **stays** (per-profile UI/expiry). Still
   `DELETE FROM r2_grace_deletions WHERE blake3_hash=%s`. The `is_new` flag becomes irrelevant to
   PG. `user_id`/`profile_id` (already accepted, previously ignored for PG) are now used.
5. `delete_ref` → replace `UPDATE ... GREATEST(ref_count-1,0)` with a keyed delete:
   ```sql
   DELETE FROM game_storage_refs WHERE user_id=%s AND profile_id=%s AND blake3_hash=%s
   ```
   Idempotent by construction; the `row_existed` SQLite pre-check and the `GREATEST(...,0)` floor
   hack are no longer needed (a double-delete is a zero-row no-op, not an under-count).

Untouched (correctly): `count_refs_in_profile`, `_count_refs_all_profiles`,
`_expire_game_storage_all_profiles`, all SQLite `game_storage` reads/writes, the Phase-2
authoritative-recount delete gate.

---

## 3. Backfill migration (the "no game loses its live refs mid-migration" criterion)

The derived set lives in Postgres but its **source of truth is per-profile SQLite `game_storage`,
scattered across R2** — a plain postgres-track migration (runs once, no per-profile context)
cannot read it. Precedent exists: `profile_db/v017_backfill_missing_storage_refs.py` already
backfills PG ref state per-profile by calling `insert_game_storage_ref` inside the per-profile
migration loop that `run_all_migrations()` drives (downloads each profile.sqlite, syncs back).

**Two migration files, two tracks (mirrors the original v002 postgres + v002 profile_db split):**

- **A. postgres `v0NN_game_storage_refs_derived.py`** (schema/cutover). Provisional number
  **v025** — RE-VERIFY against `origin/master` at implement time per kickoff (siblings T6780 etc.
  may take it; current latest on master is v024). Steps:
  1. `game_storage_refs` already exists in `_SCHEMA_DDL` (fresh deploys have it) — no CREATE
     needed, but assert/clean: `DELETE FROM game_storage_refs` (drop the 8 pre-T2930 sediment rows;
     they will be rebuilt authoritatively by B).
  2. **Do NOT drop `game_ref_counts` here.** Leave it in place (dead) so this migration is
     reversible and the postgres migration does not depend on B having run. A follow-up migration
     drops it once the derived set is confirmed in prod (see §5 open item).
  Also update `_SCHEMA_DDL` in pg.py: keep `game_storage_refs`, and remove `game_ref_counts` from
  fresh-schema creation **only after** the follow-up drop — for THIS task `_SCHEMA_DDL` is
  unchanged (both tables still declared), because the app no longer *reads* `game_ref_counts` but
  keeping the empty table costs nothing and preserves rollback.

- **B. profile_db `v0NN_backfill_game_storage_refs.py`** (data). Per-profile, in the
  `run_all_migrations()` loop (which already sets `set_current_user_id/profile_id`, downloads the
  profile DB, syncs back):
  ```python
  for row in game_storage:                      # SQLite source of truth, this profile
      insert_game_storage_ref(user_id, profile_id, row.blake3_hash,
                              row.game_size_bytes, row.storage_expires_at)
  ```
  This delegates to the NEW `insert_game_storage_ref` (upsert into `game_storage_refs`),
  reconstructing every profile's real refs. Idempotent (`ON CONFLICT DO UPDATE`), so re-runnable.
  **Row-factory landmine (memory: v017):** `up(conn)` gets a TUPLE row factory for SQLite — index
  positionally `r[0]`, never `r['col']`.

**Why the migration window is safe (the acceptance criterion):** during
deploy→migrate→backfill, the derived table may be empty. The **only** irreversible action —
Phase-2 R2 delete — is already gated on `_count_refs_all_profiles`, which reads the **SQLite
source of truth across every profile**, not the PG count. So even an empty/partial derived set
**cannot cause a wrongful delete**: the worst case is `has_remaining_refs`→False queues a grace
row, and Phase 2's authoritative recount then ABORTs the delete and (post-change) just cancels the
grace row. `get_next_expiry`→NULL merely makes the sweep sleep 24h. No game loses a live ref.
The backfill is run right after deploy via `POST /api/admin/migrate` like every other migration.

---

## 4. What happens to the retrospective's two smaller open items

- **One-time reconciliation of existing drift → ABSORBED.** Backfill B *is* the reconciliation: it
  rebuilds PG ref state from the SQLite source of truth for every profile, clearing all negative /
  missing / stale-sediment drift in one authoritative pass. No separate reconciliation task needed.
- **Admin/monitoring alert on negative `ref_count` → OBSOLETED by construction.** `COUNT(*)` is
  `≥ 0`; a negative count is now impossible, so that specific alert has nothing to fire on. The
  *other* half of the retro item — "a grace-queued hash that still has a live ref" — is already
  surfaced by the Phase-2 `logger.error("[Sweep] ABORT delete ...")` path (which fires exactly when
  that anomaly is detected). **Recommendation: build no new alerting in this task** (the drift class
  it would watch is structurally removed); if standalone monitoring is still wanted, file it
  separately. → **open question Q3 for the user.**

---

## 5. Risks / must-fix / open questions

**Must-fix (regression introduced by making the table live):**
- **R1 — account deletion FK.** `game_storage_refs.user_id REFERENCES users(user_id)` has no
  cascade; once rows are live, `_purge_user_data` / privacy delete must
  `DELETE FROM game_storage_refs WHERE user_id=%s` (an unref of all the user's games) **before**
  `DELETE FROM users`, or account deletion 500s after R2 is already purged (privacy.py:246 comment
  already flags the latent FK gap). Add this delete to the shared purge helper + the test-account
  reset scripts. This is the one non-obvious blast-radius item.

**Risks:**
- **R2 — dual-store still exists** (SQLite `game_storage` + PG `game_storage_refs`). We removed the
  drift-prone *aggregate*, but SQLite and the PG projection can still diverge on a partial write.
  Mitigation: the PG side is now an idempotent per-(profile,hash) upsert/delete with no novelty
  gate, so it *self-heals* on the next gesture for that pair (re-activate / extend re-upserts;
  delete re-deletes), unlike the counter which could never recover. And the Phase-2 delete gate
  reads SQLite, not PG, so a diverged PG projection can still never cause a wrongful delete. Full
  single-store unification (drop SQLite or drop PG) is out of scope — noted as future work.
- **R3 — migration numbering race.** Provisional postgres v025 / next profile_db number must be
  re-verified against `origin/master` at implement time (kickoff §"Migration-number coordination";
  sibling containers T6780 active). Rebase onto origin/master first, re-pick numbers.

**Open questions for approval:**
- **Q1 — table choice:** repurpose the existing dead `game_storage_refs` (recommended: identical
  shape + indexes already present, and it *removes* a dead table) vs. create a fresh
  `game_video_refs` and drop `game_storage_refs` (greppably-clean name, no stale-semantics
  baggage). Recommendation: **repurpose `game_storage_refs`.**
- **Q2 — retire `game_ref_counts`:** this task leaves it declared-but-dead (reversible), with a
  follow-up migration to `DROP TABLE game_ref_counts` + remove from `_SCHEMA_DDL` after prod
  confirmation. Acceptable, or drop it in this task's postgres migration for a clean single-store
  end state? Recommendation: **leave dead this task, drop in follow-up** (rollback safety on an
  irreversible-delete-gating change).
- **Q3 — monitoring:** confirm we build **no** new negative-count/live-ref alert here (§4).

---

## 6. Test plan (Tester, pre-implementation)
Existing suite must stay green against the new shape (or be deliberately superseded):
- `test_sweep_scheduler.py::TestGraceDeletionLiveRefGuard`, `::TestDeleteRefCounterDrift`,
  T5850 authoritative-recount tests — the Phase-2 delete gate is unchanged, so these should pass
  as-is; the `heal_ref_count` assertions (if any) get updated to "grace cancelled, no heal call".
New tests for the derived-set invariant:
- `ref_count == COUNT(*)` holds after arbitrary insert/delete/double-delete sequences (the
  counter-drift class is untestable-because-impossible: assert no stored integer exists).
- `insert_game_storage_ref` is idempotent per (profile,hash) and creates the PG row even when the
  SQLite row already exists (the exact 2026-08-11 missing-row scenario — must now produce a row).
- `delete_ref` double-delete leaves `COUNT(*)` correct (no floor hack, no under-count).
- account deletion removes the user's `game_storage_refs` rows (R1) and `DELETE FROM users` succeeds.
- backfill B reconstructs rows from SQLite `game_storage` for a profile with pre-existing rows.
