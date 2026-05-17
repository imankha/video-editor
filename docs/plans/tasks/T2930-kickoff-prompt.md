# T2930 Kickoff Prompt: Postgres Data Locality Audit

> Paste this entire prompt into a fresh AI session to implement T2930.

---

## Implement T2930: Postgres Data Locality Audit

Read `CLAUDE.md` for project context, coding standards, and workflow rules before starting. This is a **backend-only** task that touches database schemas, migration scripts, and API endpoints. No frontend changes.

### Classification

```
**Stack Layers:** [Backend | Database]
**Files Affected:** ~10 files
**LOC Estimate:** ~400 lines
**Test Scope:** [Backend]

| Agent     | Include? | Justification |
|-----------|----------|---------------|
| Code Expert | Yes    | Cross-database data flow audit across 6+ files; need to trace every Postgres read/write for per-user data |
| Architect   | Yes    | New SQLite schema design, Postgres index redesign, data migration strategy — requires approval |
| Tester      | Yes    | Migration correctness, R2 cleanup sweep refactor, storage credit endpoint changes |
| Reviewer    | Yes    | Schema change + data migration = high risk; persistence/state changes warrant scrutiny |
| Migration   | Yes    | Both Postgres and profile_db schema changes |
```

---

### Problem

**Architectural rule: all per-user data belongs in profile.sqlite. Postgres is only for global data or data shared between multiple accounts.**

`game_storage_refs` in Postgres stores `(user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)` — per-user, per-profile data tracking when each game's storage credit expires. This belongs in profile.sqlite alongside the `games` and `game_videos` tables it relates to.

**Consequences of the current split:**
1. **Data across two systems** — Games in SQLite, their expiry in Postgres. Checking expiry requires cross-joining two databases in Python.
2. **Missing from R2 sync** — Profile SQLite syncs to R2 automatically. Postgres per-user data doesn't.
3. **Script friction** — Debugging a user requires downloading SQLite AND querying Postgres separately.

The only reason `game_storage_refs` is in Postgres today is that the R2 cleanup sweep needs a global view of all refs. That's a valid cross-user concern, but the solution should be a lightweight global index in Postgres (just `blake3_hash` + `ref_count`), not the full per-user expiration data.

---

### Current State (What You'll Find)

#### Postgres Schema (`src/backend/app/services/pg.py`, lines 72-89)

```sql
-- Per-user data that should move to SQLite:
CREATE TABLE IF NOT EXISTS game_storage_refs (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(user_id),
    profile_id TEXT NOT NULL,
    blake3_hash TEXT NOT NULL,
    game_size_bytes BIGINT NOT NULL,
    storage_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(user_id, profile_id, blake3_hash)
);

-- Global data, stays in Postgres:
CREATE TABLE IF NOT EXISTS r2_grace_deletions (
    blake3_hash TEXT PRIMARY KEY,
    grace_expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Other Postgres tables (all stay — document rationale):
- `users` — auth, inherently cross-user (login, admin lookups)
- `sessions` — must be accessible pre-sync from any machine
- `otp_codes` — ephemeral auth, cross-user email verification
- `admin_users` — global admin list
- `impersonation_audit` — admin audit trail, cross-user queries
- `shares` / `share_videos` / `share_games` — share tokens must be globally queryable by token or recipient email without knowing the sharer
- `pending_teammate_shares` — recipients must find pending shares by email before they have a profile
- `schema_migrations` — global migration tracking
- `credit_summary` — per-user but used for cross-user admin analytics (document this as an exception or candidate)

#### SQLite Schema (`src/backend/app/database.py`, lines 660-861)

```sql
-- Games table (profile.sqlite) — NO expiry column today
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    video_filename TEXT,
    blake3_hash TEXT,
    clip_count INTEGER DEFAULT 0,
    -- ... rating columns, metadata ...
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'ready',
    -- NOTE: storage_expires_at is NOT here — it's in Postgres game_storage_refs
);

-- Multi-video support
CREATE TABLE IF NOT EXISTS game_videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    blake3_hash TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    duration REAL,
    video_width INTEGER, video_height INTEGER, video_size INTEGER,
    fps REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(game_id, sequence)
);
```

#### game_storage_refs CRUD (`src/backend/app/services/auth_db.py`, lines 323-470)

Functions to refactor (currently hit Postgres, should read/write SQLite after migration):

| Function | Lines | What it does | After migration |
|----------|-------|--------------|-----------------|
| `insert_game_storage_ref(user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at)` | 323-344 | Upsert into Postgres; also deletes from `r2_grace_deletions` | Write to SQLite `game_storage` table + update Postgres ref count |
| `get_game_storage_ref(user_id, profile_id, blake3_hash)` | 347-358 | Read single ref from Postgres | Read from SQLite |
| `get_storage_refs_for_user(user_id)` | 361-370 | All refs for a user | Read from SQLite |
| `get_expired_refs()` | 373-381 | All expired refs across ALL users (R2 cleanup) | Query Postgres ref counts where count=0, or scan SQLite per-user |
| `delete_ref(user_id, profile_id, blake3_hash)` | 384-391 | Delete single ref | Delete from SQLite + decrement Postgres ref count |
| `has_remaining_refs(blake3_hash)` | 394-401 | Any users still referencing hash? | Query Postgres `game_ref_counts` table |
| `get_all_ref_hashes(user_id)` | 404-411 | Set of all blake3 hashes for user | Read from SQLite |
| `get_next_expiry()` | 414-431 | Next expiring ref or grace deletion | Needs both SQLite (per-user expiry) and Postgres (grace deletions) |

Grace deletion functions (lines 437-470) stay in Postgres — they're global R2 lifecycle management.

#### Cross-Database Join Patterns (`src/backend/app/routers/games.py`)

**GET /api/games (list_games, lines 740-814)** — Implied cross-DB join in Python:
```python
storage_refs = get_storage_refs_for_user(user_id)       # Postgres
expiry_by_hash = {r['blake3_hash']: r['storage_expires_at'] for r in storage_refs}
grace_hashes = get_grace_deletion_hashes()               # Postgres
all_ref_hashes = get_all_ref_hashes(user_id)             # Postgres

for row in games:  # SQLite
    expires_at_val = expiry_by_hash.get(row['blake3_hash'])  # Cross-join in Python
```

**POST finalize flow (lines 683-696)** — Creates game in SQLite, writes expiry to Postgres:
```python
for vr in game_video_rows:
    if vr["blake3_hash"]:
        insert_game_storage_ref(user_id, profile_id, vr["blake3_hash"],
                                vr["video_size"] or 0, expires_str)
```

**PUT /api/games/{id}/extend (lines 960-983)** — Reads game from SQLite, expiry from Postgres, writes back to Postgres.

#### Storage Credits (`src/backend/app/services/storage_credits.py`)

Pure calculation module — no DB access. Produces expiry timestamps consumed by `game_storage_refs`. Functions:
- `calculate_storage_cost(file_size_bytes, days=30)` → credits (int)
- `calculate_upload_cost(file_size_bytes, days=30)` → credits + surcharge
- `calculate_extension_cost(file_size_bytes, days)` → credits
- `storage_expires_at(from_dt=None, days=30)` → datetime

No changes needed here — it's the callers that need refactoring.

#### Persistence Model Skill (`src/backend/.claude/skills/persistence-model/SKILL.md`)

Current rules reference SQLite sync + R2, but don't explicitly document the data locality boundary. This needs a new section.

#### Migration Infrastructure (T2920 — status: TESTING)

- Three migration tracks: `user_db`, `profile_db`, `postgres`
- `BaseMigration` with `version: int`, `description: str`, `up(conn)` method
- `MigrationRunner` handles version tracking: `PRAGMA user_version` (SQLite), `schema_migrations` table (Postgres)
- Admin endpoint: `POST /api/admin/migrate` — iterates all users, runs pending migrations, syncs to R2
- **All three tracks at v001 (baseline only) — no custom migrations deployed yet**
- Migration files live in `src/backend/app/migrations/{track}/v{NNN}_{description}.py`

---

### Target State

#### 1. New SQLite table in profile.sqlite: `game_storage`

```sql
CREATE TABLE IF NOT EXISTS game_storage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    blake3_hash TEXT NOT NULL UNIQUE,
    game_size_bytes INTEGER NOT NULL,
    storage_expires_at TEXT NOT NULL,  -- ISO 8601 timestamp
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

This lives alongside `games` and `game_videos` in the user's profile.sqlite. No `user_id`/`profile_id` columns needed — the database IS the user's profile.

#### 2. Lightweight Postgres index: `game_ref_counts`

```sql
CREATE TABLE IF NOT EXISTS game_ref_counts (
    blake3_hash TEXT PRIMARY KEY,
    ref_count INTEGER NOT NULL DEFAULT 0
);
```

- Incremented when a user uploads/imports a game with that hash
- Decremented when a user's game expires and the ref is deleted
- R2 cleanup sweep queries: `SELECT blake3_hash FROM game_ref_counts WHERE ref_count <= 0`
- No per-user data in this table — just a count

#### 3. Refactored functions

Per-user reads/writes → SQLite (via user's tracked connection):
- `insert_game_storage_ref` → writes to `game_storage` in SQLite + increments `game_ref_counts` in Postgres (only on new hash, not on upsert-update)
- `get_game_storage_ref` → reads from SQLite `game_storage`
- `get_storage_refs_for_user` → reads from SQLite `game_storage`
- `get_all_ref_hashes` → reads from SQLite `game_storage`
- `delete_ref` → deletes from SQLite `game_storage` + decrements `game_ref_counts` in Postgres

Global sweep functions → Postgres ref counts:
- `has_remaining_refs(blake3_hash)` → `SELECT ref_count FROM game_ref_counts WHERE blake3_hash = %s`
- `get_expired_refs()` → This changes fundamentally. Instead of querying Postgres for expired per-user refs, the admin migration endpoint or a periodic sweep iterates users' SQLite DBs. Alternatively, the R2 cleanup only cares about zero-ref hashes — it queries `game_ref_counts WHERE ref_count <= 0` and checks `r2_grace_deletions`.

#### 4. Data migration

Write a migration that:
1. For **each user**: downloads their profile.sqlite from R2, creates `game_storage` table, copies their rows from Postgres `game_storage_refs` into it, re-uploads
2. Builds `game_ref_counts` from existing `game_storage_refs` data: `INSERT INTO game_ref_counts SELECT blake3_hash, COUNT(*) FROM game_storage_refs GROUP BY blake3_hash`
3. After validation, drops `game_storage_refs` from Postgres (or marks deprecated)

This uses the T2920 migration infrastructure: profile_db migration for SQLite schema + postgres migration for the new table + custom migration script for data transfer.

---

### Audit Checklist (Required Output)

For each Postgres table, document in the design doc:

| Table | Per-user? | Cross-user need? | Verdict | Rationale |
|-------|-----------|-------------------|---------|-----------|
| `users` | One row per user | Login, admin lookups | **STAYS** | Auth is inherently cross-user |
| `sessions` | Yes | Validation from any machine | **STAYS** | Must be accessible pre-sync |
| `otp_codes` | Yes | Email verification | **STAYS** | Ephemeral auth |
| `admin_users` | No | Yes | **STAYS** | Global admin list |
| `impersonation_audit` | Yes | Admin audit queries | **STAYS** | Cross-user admin oversight |
| `game_storage_refs` | **Yes** | R2 cleanup sweep | **MOVE** | Per-user expiry → SQLite; lightweight ref count stays in Postgres |
| `r2_grace_deletions` | No (per-hash) | Cleanup sweep | **STAYS** | Global R2 lifecycle |
| `shares` | Yes (sharer) | Token + recipient email lookup | **STAYS** | Recipients find shares before having a profile |
| `share_videos` | Yes | Share token lookup | **STAYS** | Follows shares |
| `share_games` | Yes | Share token lookup | **STAYS** | Follows shares |
| `pending_teammate_shares` | Yes | Recipient signup flow | **STAYS** | Must be queryable by email pre-signup |
| `schema_migrations` | No | Yes | **STAYS** | Operational |
| `credit_summary` | Yes | Admin analytics | **DOCUMENT** | Per-user but used for cross-user aggregation; document exception |

---

### Key Files to Read/Modify

**Read first (Code Expert):**
- `src/backend/app/services/pg.py` — Postgres schema DDL (lines 20-161)
- `src/backend/app/services/auth_db.py` — game_storage_refs CRUD (lines 323-470)
- `src/backend/app/database.py` — SQLite schema DDL, `ensure_database()` (lines 461-975)
- `src/backend/app/routers/games.py` — Cross-DB query patterns (lines 683-696, 740-814, 960-983)
- `src/backend/app/services/storage_credits.py` — Pure calculation, no changes needed
- `src/backend/app/services/sharing_db.py` — Shares CRUD, verify stays in Postgres
- `src/backend/.claude/skills/persistence-model/SKILL.md` — Current persistence rules
- `src/backend/app/migrations/` — All existing migration files (all at v001 baseline)
- `docs/plans/tasks/T2930-postgres-data-locality-audit.md` — Full task spec

**Modify (Implementation):**
- `src/backend/app/database.py` — Add `game_storage` table to SQLite schema DDL
- `src/backend/app/services/pg.py` — Add `game_ref_counts` table; mark `game_storage_refs` for deprecation
- `src/backend/app/services/auth_db.py` — Refactor CRUD functions: per-user reads/writes → SQLite, global ref count → Postgres
- `src/backend/app/routers/games.py` — Remove cross-DB joins, read expiry from SQLite directly
- `src/backend/app/migrations/profile_db/v002_game_storage.py` — SQLite migration to create `game_storage` table
- `src/backend/app/migrations/postgres/v002_game_ref_counts.py` — Postgres migration to create `game_ref_counts` + populate from existing data
- `src/backend/.claude/skills/persistence-model/SKILL.md` — Add data locality boundary rules

---

### Technical Constraints

1. **Upsert semantics**: `game_storage_refs` currently uses `ON CONFLICT (user_id, profile_id, blake3_hash) DO UPDATE`. The SQLite equivalent for `game_storage` is `ON CONFLICT (blake3_hash) DO UPDATE` (no user_id/profile_id needed since the DB is per-profile).

2. **Ref count atomicity**: Incrementing/decrementing `game_ref_counts` in Postgres must handle concurrent updates. Use `INSERT ... ON CONFLICT DO UPDATE SET ref_count = ref_count + 1` for increment and `UPDATE ... SET ref_count = ref_count - 1` for decrement.

3. **Migration ordering**: Postgres migration (create `game_ref_counts` + populate) must run BEFORE profile_db migration (create `game_storage` + populate from Postgres). The admin migrate endpoint runs Postgres first, then iterates users — this ordering is already correct.

4. **R2 sync**: After the profile_db migration writes `game_storage` rows, the tracked connection automatically syncs to R2. This is handled by the existing sync infrastructure.

5. **`get_expired_refs()` redesign**: This currently returns all expired refs across all users from a single Postgres query. After migration, expired refs live in individual SQLite DBs. Options:
   - The R2 cleanup sweep iterates users' SQLite DBs (via admin migrate endpoint pattern)
   - OR: Keep a "last known expiry" in Postgres `game_ref_counts` and update it when refs are created/extended — allows centralized expiry queries but adds staleness risk
   - Recommendation: Iterate users' SQLite DBs for expiry checks. The sweep already runs periodically and the user count is small.

6. **`get_next_expiry()` redesign**: Currently queries both `game_storage_refs` and `r2_grace_deletions` in Postgres. After migration, it needs to query all users' SQLite DBs for the minimum expiry. This is only called for scheduling the next sweep — can iterate users' DBs or use a cached value.

7. **`credit_summary` table**: Contains per-user credit balance in Postgres as JSONB. Read the schema — it may be another locality violation candidate. Document your finding in the audit.

---

### Acceptance Criteria

- [ ] Every Postgres table has a documented rationale for being in Postgres vs SQLite (in design doc)
- [ ] `game_storage_refs` expiry data lives in user's profile.sqlite (`game_storage` table)
- [ ] R2 cleanup sweep works with lightweight Postgres `game_ref_counts`
- [ ] Storage extension UI reads expiry from SQLite (no Postgres round-trip for display)
- [ ] `persistence-model` skill documents the data locality boundary
- [ ] Migration script moves existing `game_storage_refs` data for all users
- [ ] `game_ref_counts` populated correctly from existing data
- [ ] Tests verify: migration correctness, ref count consistency, expiry reads from SQLite, R2 sweep with new index

---

### Workflow Reminders

- Follow the full workflow: Classify → Code Expert → Architect (design doc, **approval gate**) → Tester Phase 1 → Implement → Migration → Reviewer → Tester Phase 2 → Manual Testing → Complete
- Create branch: `git checkout -b feature/T2930-postgres-data-locality-audit`
- AI sets status to TESTING after implementation — never DONE
- Commit with co-author line
- Update PLAN.md status after commit
