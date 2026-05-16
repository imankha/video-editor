# T2920: Migration System Infrastructure

**Status:** TESTING
**Impact:** 8
**Complexity:** 5
**Created:** 2026-05-15
**Updated:** 2026-05-15

## Problem

The project previously used throwaway migration scripts (12 scripts in `scripts/`, now deleted). When schema changes land, there's no structured way to migrate existing user databases. AI has been manually migrating accounts with ad-hoc scripts -- error-prone, unrepeatable, and unversioned.

The app has three database types that need migration support:
1. **user.sqlite** (per-user) -- credits, profiles, settings, stripe
2. **Profile SQLite** (per-user-per-profile) -- clips, projects, games, exports
3. **Fly Postgres** (shared) -- auth, sessions, shares, storage refs

## Solution

Build a permanent, versioned migration system with:
- **DB version tracking** via `PRAGMA user_version` (SQLite) and `schema_migrations` table (Postgres)
- **Polymorphic migration classes** -- stable runner, swappable migration logic
- **Admin endpoint** `POST /api/admin/migrate` that iterates all users one-by-one
- **Migration agent** for the Claude workflow that automatically writes migration files when tasks change schema
- **Claude memory updates** (CLAUDE.md, agent definitions, classification, orchestration)

AI never manually migrates accounts. AI writes migration code. Admin hits the endpoint.

## Context

### Architecture: Three Migration Tracks

| Track | DB Type | Version Mechanism | Scope |
|-------|---------|-------------------|-------|
| `user_db` | `user.sqlite` (per-user) | `PRAGMA user_version` | Credits, profiles, settings, stripe |
| `profile_db` | Profile SQLite (per-user-per-profile) | `PRAGMA user_version` | Clips, projects, games, exports |
| `postgres` | Fly Postgres (shared) | `schema_migrations` table | Auth, sessions, shares, storage refs |

Each track has its own version sequence (v1, v2, v3...) independent of the others.

### File Structure to Create

```
src/backend/app/migrations/
  __init__.py              # Public API: run_all_migrations(), get_migration_status()
  base.py                  # BaseMigration ABC + MigrationRunner
  user_db/
    __init__.py            # Auto-discovers migrations, exports MIGRATIONS list
    v001_baseline.py       # Sets version=1, no schema changes (marks "migrated")
  profile_db/
    __init__.py
    v001_baseline.py
  postgres/
    __init__.py
    v001_baseline.py
```

### Base Migration Class Design

```python
# src/backend/app/migrations/base.py

from abc import ABC, abstractmethod

class BaseMigration(ABC):
    version: int           # Sequential, must match filename vXXX
    description: str       # Human-readable, e.g. "Add sport column to profiles"

    @abstractmethod
    def up(self, conn) -> None:
        """Apply schema change. conn is sqlite3.Connection or psycopg2 connection."""
        pass

class NoOpMigration(BaseMigration):
    """Baseline migration that establishes version tracking without schema changes."""
    def up(self, conn) -> None:
        pass
```

### Migration Runner Design

```python
# Also in base.py

class MigrationRunner:
    def __init__(self, migrations: list[BaseMigration]):
        self.migrations = sorted(migrations, key=lambda m: m.version)
        self.latest_version = migrations[-1].version if migrations else 0

    def get_current_version(self, conn, db_type: str) -> int:
        if db_type == 'postgres':
            cur = conn.cursor()
            cur.execute("SELECT MAX(version) FROM schema_migrations")
            row = cur.fetchone()
            return row[0] or 0 if row else 0
        else:
            return conn.execute("PRAGMA user_version").fetchone()[0]

    def get_pending(self, conn, db_type: str) -> list[BaseMigration]:
        current = self.get_current_version(conn, db_type)
        return [m for m in self.migrations if m.version > current]

    def run(self, conn, db_type: str) -> list[BaseMigration]:
        """Run all pending migrations. Returns list of applied migrations."""
        pending = self.get_pending(conn, db_type)
        for migration in pending:
            migration.up(conn)
            if db_type == 'postgres':
                cur = conn.cursor()
                cur.execute(
                    "INSERT INTO schema_migrations (version, description) VALUES (%s, %s)",
                    (migration.version, migration.description)
                )
            else:
                conn.execute(f"PRAGMA user_version = {migration.version}")
        if db_type != 'postgres':
            conn.commit()
        return pending
```

### Admin Endpoint Design

```python
# Addition to src/backend/app/routers/admin.py

@router.post("/migrate")
async def run_migrations():
    """Run all pending migrations for all users on this environment."""
    _require_admin()
    result = await asyncio.to_thread(_run_all_migrations)
    return result

def _run_all_migrations() -> dict:
    from app.migrations import run_all_migrations
    return run_all_migrations()
```

### Migration Orchestrator Design

```python
# src/backend/app/migrations/__init__.py

def run_all_migrations() -> dict:
    """Iterate all users, run pending migrations, sync to R2."""
    results = {
        "postgres": {"applied": [], "error": None},
        "users": {"total": 0, "migrated": 0, "skipped": 0, "errors": []}
    }

    # 1. Postgres (run once)
    _migrate_postgres(results)

    # 2. Per-user SQLite DBs
    users = get_all_users_for_admin()
    results["users"]["total"] = len(users)

    for user in users:
        try:
            applied = _migrate_user(user["user_id"])
            if applied:
                results["users"]["migrated"] += 1
            else:
                results["users"]["skipped"] += 1  # Already up-to-date
        except Exception as e:
            results["users"]["errors"].append({
                "user_id": user["user_id"],
                "error": str(e)
            })

    return results

def _migrate_user(user_id: str) -> bool:
    """Migrate one user's DBs. Returns True if any migrations applied."""
    any_applied = False

    # User DB (user.sqlite)
    applied = _migrate_user_db(user_id)
    if applied:
        any_applied = True

    # Profile DBs
    for profile_id in _get_profile_ids(user_id):
        applied = _migrate_profile_db(user_id, profile_id)
        if applied:
            any_applied = True

    return any_applied
```

### R2 Sync After Migration

Each `_migrate_user_db()` and `_migrate_profile_db()` call:
1. Opens the local SQLite (downloading from R2 if needed via `ensure_user_database()` / `ensure_database()`)
2. Runs pending migrations
3. Syncs back to R2 via `sync_user_db_to_r2_with_version()` / `sync_database_to_r2_with_version()`

Uses existing R2 sync infrastructure -- no new sync code needed.

### New User Handling

When `ensure_user_database()` creates a fresh DB, it must also set `PRAGMA user_version = LATEST_VERSION`. This prevents the migration endpoint from running historical migrations on brand-new DBs.

Same for `ensure_database()` (profile DBs).

### Postgres Bootstrap

Add a `schema_migrations` table to `_SCHEMA_DDL` in `pg.py`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Relevant Files (REQUIRED)

**New files to create:**
- `src/backend/app/migrations/__init__.py` -- Public API: `run_all_migrations()`, `get_migration_status()`
- `src/backend/app/migrations/base.py` -- `BaseMigration` ABC, `NoOpMigration`, `MigrationRunner`
- `src/backend/app/migrations/user_db/__init__.py` -- Auto-discovery, exports `MIGRATIONS` and `RUNNER`
- `src/backend/app/migrations/user_db/v001_baseline.py` -- Baseline no-op (version 0 -> 1)
- `src/backend/app/migrations/profile_db/__init__.py` -- Auto-discovery
- `src/backend/app/migrations/profile_db/v001_baseline.py` -- Baseline no-op
- `src/backend/app/migrations/postgres/__init__.py` -- Auto-discovery
- `src/backend/app/migrations/postgres/v001_baseline.py` -- Baseline no-op
- `.claude/agents/migration.md` -- Migration agent definition (see below)

**Existing files to modify:**
- `src/backend/app/routers/admin.py` -- Add `POST /admin/migrate` endpoint
- `src/backend/app/services/user_db.py` -- Set `PRAGMA user_version` in `ensure_user_database()` (line 167, after `conn.executescript(_USER_DB_SCHEMA)`)
- `src/backend/app/database.py` -- Set `PRAGMA user_version` in `ensure_database()` (after schema creation ~line 540-925)
- `src/backend/app/services/pg.py` -- Add `schema_migrations` table to `_SCHEMA_DDL` (after line 155)
- `CLAUDE.md` -- Add Migration agent to Agents table, classification template, workflow stages, migration rules section
- `.claude/workflows/0-task-classification.md` -- Add Migration agent inclusion criteria
- `.claude/ORCHESTRATION.md` -- Add Migration agent workflow + spawning template

### Key Existing Patterns

**User iteration** (`src/backend/app/services/user_db.py` line 474):
```python
for user_dir in USER_DATA_BASE.iterdir():
    if not user_dir.is_dir():
        continue
    user_id = user_dir.name
```

**All users from Postgres** (`src/backend/app/services/auth_db.py` line 238):
```python
def get_all_users_for_admin() -> list:
    with get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id, email, ... FROM users ORDER BY created_at DESC")
```

**User DB connection** (`src/backend/app/services/user_db.py` line 177):
```python
@contextmanager
def get_user_db_connection(user_id: str = None):
    ensure_user_database(user_id)
    db_path = _get_user_db_path(user_id)
    raw_conn = sqlite3.connect(str(db_path), timeout=30)
    ...
```

**Admin gate** (`src/backend/app/routers/admin.py` line 53):
```python
def _require_admin():
    user_id = get_current_user_id()
    if not is_admin(user_id):
        raise HTTPException(status_code=403, detail="Admin access required")
```

**Background thread pattern** (used by sweep_scheduler, cleanup):
```python
result = await asyncio.to_thread(_run_all_migrations)
```

**R2 sync functions** (`src/backend/app/storage.py`):
- `sync_user_db_to_r2_with_version()` (line 1025) -- user.sqlite -> R2
- `sync_database_to_r2_with_version()` (line 770) -- profile DB -> R2

### Important: Version tracking is NOT schema versioning

The existing `db_version` table in profile DBs (database.py line 905) and R2 metadata `x-amz-meta-db-version` are for **R2 sync conflict detection** (optimistic concurrency), NOT schema versioning. `PRAGMA user_version` is a separate, clean mechanism for tracking schema version.

### Related Tasks
- Depends on: None
- Blocks: Any future task with schema changes will use this system

### Technical Notes

1. **PRAGMA user_version** is atomic with SQLite, separate from R2 sync version, can't be accidentally dropped
2. **Baseline v001 migrations** are no-ops -- they just set version=1 to mark "this DB has been through the migration system"
3. **New users skip all historical migrations** because `ensure_*_database()` sets PRAGMA to latest version on creation
4. **Concurrent access**: Migration endpoint is admin-only, should run during low traffic. R2 version checking handles conflicts if a user is active.
5. **Idempotent**: Running the endpoint twice is safe -- checks version, skips already-migrated DBs

## Claude Memory & Agent Changes

### Migration Agent Definition (`.claude/agents/migration.md`)

**Purpose:** When a task changes database schema (SQLite or Postgres), the Migration agent reads the schema changes made by the Implementor and creates a new versioned migration file.

**When it runs:** After Implementation (Stage 4), before Review (Stage 4.5). The Implementor changes the schema code, then the Migration agent detects what changed and writes the migration file. The Reviewer reviews both.

**What it does:**
1. Reads `src/backend/app/migrations/{track}/` to find the latest version number
2. Reads the git diff to identify schema changes
3. Creates `v{next}_description.py` with the appropriate ALTER TABLE / CREATE TABLE SQL
4. Updates `PRAGMA user_version` default in `ensure_user_database()` or `ensure_database()`

**Classification integration -- add to classification output:**
```
| Migration | Yes/No | {reason} |
```

**Include when:**
- SQLite schema changes (new columns, tables, indexes)
- Postgres schema changes (new columns, tables, indexes)
- Data format changes (e.g., BLOB encoding changes)

**Skip when:**
- No schema changes
- Frontend-only changes
- Backend logic changes with no DB impact

### CLAUDE.md Changes

1. **Agents table**: Add `| **Migration** | Write versioned migration files for schema changes | [migration.md](.claude/agents/migration.md) |`
2. **Classification template**: Add `| Migration | Yes/No | {reason} |` row
3. **Workflow stages table**: Add row `| 4.75 | Migration | - | Migration | - |` between Implementation and Review
4. **New section "Migration System"**: Rules about AI never manually migrating, endpoint location, three tracks, versioning mechanisms

### ORCHESTRATION.md Changes

Add to workflow flow diagram (between steps 5 and 6):
```
  5.5 Migration (if schema changes detected)
     Spawn Migration agent --> writes migration file
```

Add spawning template:
```
### Migration
Task tool:
  subagent_type: general-purpose
  prompt: |
    You are the Migration agent for task T{id}: {title}.
    
    Read .claude/agents/migration.md for your full instructions.
    
    ## Schema Changes (from Implementor)
    {git diff of schema changes}
    
    ## Current Migration State
    {ls of src/backend/app/migrations/{track}/ showing latest version}
    
    Create the next versioned migration file.
```

Add agent-skill matrix:
```
### Migration
| Skill | Relevance | Load When |
|-------|-----------|-----------|
| database-schema | CRITICAL | Understanding current schema |
| persistence-model | HIGH | Understanding R2 sync impact |
| api-guidelines | MEDIUM | If migration affects API responses |
```

### Classification Workflow Changes (`.claude/workflows/0-task-classification.md`)

Add new section under "Agent Inclusion Criteria":
```
### Migration

**Include when:**
- SQLite schema changes (new columns, tables, indexes in user_db or profile_db)
- Postgres schema changes (new columns, tables, indexes)
- Data format changes (e.g., BLOB encoding, msgpack changes)

**Skip when:**
- No database schema changes
- Frontend-only changes
- Backend logic changes with no DB impact
- Read-only query changes
```

## Implementation

### Steps
1. [ ] Create `src/backend/app/migrations/base.py` -- BaseMigration ABC, NoOpMigration, MigrationRunner
2. [ ] Create track `__init__.py` files for user_db, profile_db, postgres (auto-discovery)
3. [ ] Create baseline v001 migrations for all three tracks
4. [ ] Create `src/backend/app/migrations/__init__.py` -- orchestrator with run_all_migrations()
5. [ ] Add `schema_migrations` table to Postgres DDL in pg.py
6. [ ] Set `PRAGMA user_version` in `ensure_user_database()` and `ensure_database()` for new DBs
7. [ ] Add `POST /admin/migrate` endpoint to admin.py
8. [ ] Create `.claude/agents/migration.md` agent definition
9. [ ] Update CLAUDE.md (agents table, classification template, workflow stages, migration rules)
10. [ ] Update `.claude/workflows/0-task-classification.md` (Migration agent criteria)
11. [ ] Update `.claude/ORCHESTRATION.md` (workflow flow, spawning template, agent-skill matrix)
12. [ ] Run import check: `cd src/backend && .venv/Scripts/python.exe -c "from app.migrations import run_all_migrations"`
13. [ ] Write `src/backend/tests/test_migrations.py` (temp DB, baseline migration, idempotency)

## Acceptance Criteria

- [ ] `BaseMigration` ABC with `version`, `description`, `up()` interface
- [ ] `MigrationRunner` handles version detection, pending calculation, sequential execution
- [ ] Three tracks (user_db, profile_db, postgres) each with baseline v001 no-op migration
- [ ] `POST /api/admin/migrate` endpoint (admin-only) iterates all users, runs pending migrations, syncs to R2
- [ ] New user DBs start at latest version (skip historical migrations)
- [ ] `schema_migrations` table in Postgres DDL
- [ ] Import check passes
- [ ] Test: baseline migration sets version=1, running again applies nothing (idempotent)
- [ ] Migration agent definition exists at `.claude/agents/migration.md`
- [ ] CLAUDE.md updated with Migration agent in agents table and classification template
- [ ] Classification workflow updated with Migration agent inclusion criteria
- [ ] ORCHESTRATION.md updated with Migration agent in workflow flow and spawning templates
