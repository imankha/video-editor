"""T5089: prune already-applied migrations behind a hard floor.

Two load-bearing properties this task rests on:

1. **DDL-vs-migrated schema equivalence** (Step 1, the prerequisite for deleting
   anything): a fresh account is built by the head DDL and stamped straight to
   head, skipping migrations entirely (`is_fresh_db` branches in
   database.py / user_db.py). So the DDL — not the migration chain — is ALREADY
   the source of truth for every new DB. Pruning removes the only cross-check
   between the two, so we add one first: build a DB the migrated way and a DB
   the fresh-DDL way and assert the schemas are byte-identical. Any drift is a
   live bug (a migration adds a column the DDL forgot, or vice versa) that this
   test surfaces BEFORE a prune makes it unrecoverable.

   The migration chain CANNOT build a schema from empty (the ~22 core tables
   live only in the head DDL; the v001 baselines are NoOp and later migrations
   ALTER DDL-owned tables). So the "migrated" DB is built as: head DDL, then
   DROP exactly what the surviving migration range adds, stamp down to that
   range's floor, and let the runner re-create the dropped objects. If the DDL
   is missing something a migration creates, the two diverge. This reuses
   T6030's audited `POST_V023_COLUMNS` drop-map for profile_db (refactoring
   rule 1: 2nd use justifies sharing the map rather than duplicating it).

   NOTE the guarantee is CONDITIONAL on fresh DBs being built by the DDL (not by
   replaying migrations). If fresh-DB construction ever changes to replay the
   chain, this test's assumption breaks and must be revisited. (Greppable
   dependency marker: fresh_db_uses_ddl_not_chain.)

2. **Below-floor refusal** (Step 3): once v001..vF are deleted, a DB at v<F can
   no longer be lifted to head, so `MigrationRunner.run` must refuse it LOUDLY
   (CRITICAL + a non-retryable failure), never apply the surviving tail onto a
   schema those deleted migrations never expected. The mechanism ships INERT
   (floor=0 on every track) until the cross-env floor sweep proves a real F.
"""

import sqlite3
import uuid

import pytest

from app.migrations.base import (
    BaseMigration,
    BelowMigrationFloor,
    MigrationRunner,
    NoOpMigration,
)


# ---------------------------------------------------------------------------
# Schema-snapshot helper: structural, order-insensitive, name-decoupled.
# ---------------------------------------------------------------------------

def _norm_default(dflt):
    """Normalize a PRAGMA table_info default so a DDL `DEFAULT 0` and a migration
    `DEFAULT 0` compare equal regardless of SQLite's storage quirks.

    An explicit `DEFAULT NULL` (stored as the literal string 'NULL') is
    SEMANTICALLY IDENTICAL to no default at all (both make the column default to
    NULL), so both normalize to None. This collapses the one benign, greppable
    inconsistency between the head DDL (`projects.poster_marker_time REAL DEFAULT
    NULL`) and its migration (v032 `ADD COLUMN poster_marker_time REAL`, no
    default) — not a schema drift, just two spellings of the same thing.
    """
    if dflt is None:
        return None
    s = str(dflt).strip()
    if s.upper() == "NULL":
        return None
    return s


def snapshot_schema(conn) -> dict:
    """Structural schema of every user table: columns (name->type/notnull/default/pk),
    named indexes (columns + unique), and the SHAPE of auto-indexes (UNIQUE/PK
    constraints) WITHOUT their position-generated names.

    Deliberately NOT a `sqlite_master.sql` text compare: whitespace/quoting/column
    ordering differ between a DDL CREATE and an ALTER-built table, and SQLite does
    not surface ALTER-added columns as separate `sqlite_master` rows. Introspection
    via PRAGMA is the faithful comparison.
    """
    tables = [
        r[0]
        for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    ]
    schema = {}
    for t in tables:
        cols = {
            r[1]: {
                "type": (r[2] or "").upper(),
                "notnull": r[3],
                "default": _norm_default(r[4]),
                "pk": r[5],
            }
            for r in conn.execute(f"PRAGMA table_info({t})").fetchall()
        }
        named_indexes = {}
        auto_shapes = []
        for ir in conn.execute(f"PRAGMA index_list({t})").fetchall():
            iname = ir[1]
            unique = ir[2]
            idx_cols = [c[2] for c in conn.execute(f"PRAGMA index_info({iname})").fetchall()]
            if iname.startswith("sqlite_autoindex_"):
                # Auto-index names are position-generated and differ DDL-vs-ALTER;
                # compare the CONSTRAINT SHAPE (unique, columns) without the name so
                # a real UNIQUE drift is still caught but the name is not a false diff.
                auto_shapes.append((unique, tuple(idx_cols)))
            else:
                named_indexes[iname] = {"unique": unique, "columns": idx_cols}
        schema[t] = {
            "columns": cols,
            "indexes": named_indexes,
            "auto_constraints": sorted(auto_shapes),
        }
    return schema


def _assert_schemas_equal(migrated: dict, ddl: dict, track: str):
    """Compare and, on failure, name the exact diverging table/column/index and
    whether the DDL or the migration is behind (mirrors T6030's message discipline)."""
    if migrated == ddl:
        return
    diffs = []
    all_tables = sorted(set(migrated) | set(ddl))
    for t in all_tables:
        if t not in ddl:
            diffs.append(f"table {t!r} exists in the MIGRATED DB but NOT in the fresh DDL "
                         f"(a migration creates it; add it to the DDL)")
            continue
        if t not in migrated:
            diffs.append(f"table {t!r} exists in the fresh DDL but NOT in the MIGRATED DB "
                         f"(the DDL has drifted ahead of the chain)")
            continue
        m, d = migrated[t], ddl[t]
        for col in sorted(set(m["columns"]) | set(d["columns"])):
            mc, dc = m["columns"].get(col), d["columns"].get(col)
            if mc != dc:
                diffs.append(f"{t}.{col}: migrated={mc} vs ddl={dc}")
        if m["indexes"] != d["indexes"]:
            diffs.append(f"{t} named indexes: migrated={m['indexes']} vs ddl={d['indexes']}")
        if m["auto_constraints"] != d["auto_constraints"]:
            diffs.append(f"{t} unique/pk constraints: migrated={m['auto_constraints']} "
                         f"vs ddl={d['auto_constraints']}")
    raise AssertionError(
        f"[{track}] fresh DDL and migrate-from-floor schemas DIVERGE — this is a live "
        f"bug to fix (align the DDL and the migration) BEFORE pruning:\n  "
        + "\n  ".join(diffs)
    )


# ===========================================================================
# Part 1a — floor-enforcement mechanism (inert until a real floor is set).
# ===========================================================================

def _sqlite_at(version: int) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute(f"PRAGMA user_version = {version}")
    return conn


def _runner_with_floor(floor: int) -> MigrationRunner:
    class _V5(NoOpMigration):
        version = 5
        description = "surviving head"

    return MigrationRunner([_V5()], floor=floor)


class TestFloorEnforcement:
    def test_below_floor_refuses_loud(self):
        runner = _runner_with_floor(5)
        with pytest.raises(BelowMigrationFloor) as exc:
            runner.run(_sqlite_at(3), "sqlite")
        assert exc.value.current == 3 and exc.value.floor == 5
        assert exc.value.db_type == "sqlite"

    def test_at_floor_is_allowed(self):
        # A DB exactly at the floor has already run every pruned migration; only
        # the surviving tail (> floor) can be pending, all of which still exist.
        runner = _runner_with_floor(5)
        applied = runner.run(_sqlite_at(5), "sqlite")
        assert applied == []  # nothing pending at head (v5), no refusal

    def test_above_floor_is_allowed(self):
        runner = _runner_with_floor(5)
        assert runner.run(_sqlite_at(5), "sqlite") == []

    def test_floor_zero_is_inert(self):
        # The shipped default: no DB can be below v0, so the gate never fires and
        # a below-"floor" DB migrates normally instead of being refused.
        runner = _runner_with_floor(0)
        applied = runner.run(_sqlite_at(1), "sqlite")  # would raise if floor enforced
        assert len(applied) == 1  # v5 applied normally, no refusal

    def test_postgres_is_exempt_even_with_floor(self):
        # A fresh postgres DB has an EMPTY schema_migrations ledger (current=0);
        # a floor gate would refuse every fresh deploy. `_check_floor` hard-skips
        # postgres, so even a mistaken nonzero pg floor cannot brick a deploy.
        runner = _runner_with_floor(5)

        class _FakeCur:
            def execute(self, *a):
                return self

            def fetchone(self):
                return (0,)  # empty ledger -> MAX(version) is 0

            def fetchall(self):
                return []

        class _FakePg:
            def cursor(self):
                return _FakeCur()

        # Would raise if the floor were enforced (current=0 < 5); must NOT.
        runner._check_floor(_FakePg(), "postgres")  # no exception = exempt

    def test_shipped_runners_are_inert(self):
        from app.migrations.postgres import RUNNER as PG
        from app.migrations.profile_db import RUNNER as PROFILE
        from app.migrations.user_db import RUNNER as USER

        assert PROFILE.floor == 0 and USER.floor == 0 and PG.floor == 0


class TestSeamReraisesBelowFloor:
    """The MANDATORY guard the expert flagged (the single most likely way to get
    this wrong): both seam primitives wrap `RUNNER.run` in a broad `except
    Exception` that turns failures into a retryable `MigrateResult`. A
    below-floor DB is UNRECOVERABLE, so `BelowMigrationFloor` MUST escape that
    funnel un-transformed — otherwise it becomes a 503 pending_migration and the
    client retries forever against a DB that can never be lifted.
    """

    @staticmethod
    def _make_db(path):
        """A minimal real sqlite file (no WAL sidecars) so the primitive gets past
        its `if not db_path.exists()` guard and reaches RUNNER.run."""
        path.parent.mkdir(parents=True, exist_ok=True)
        c = sqlite3.connect(str(path))
        c.execute("PRAGMA user_version = 3")
        c.commit()
        c.close()

    def _cleanup(self, user_id):
        import shutil

        from app.database import USER_DATA_BASE

        p = USER_DATA_BASE / user_id
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)

    def test_profile_primitive_reraises(self, monkeypatch):
        import app.migrations as m
        from app.database import USER_DATA_BASE

        uid = f"u_belowfloor_{uuid.uuid4().hex[:8]}"
        pid = "pbf"
        self._make_db(USER_DATA_BASE / uid / "profiles" / pid / "profile.sqlite")

        def _raise(conn, db_type):
            raise BelowMigrationFloor("sqlite", 3, 5)

        monkeypatch.setattr(m.PROFILE_DB_RUNNER, "run", _raise)
        try:
            with pytest.raises(BelowMigrationFloor):
                m.migrate_local_profile_db_at_seam(uid, pid)
        finally:
            self._cleanup(uid)

    def test_user_primitive_reraises(self, monkeypatch):
        import app.migrations as m
        from app.services.user_db import _get_user_db_path

        uid = f"u_belowfloor2_{uuid.uuid4().hex[:8]}"
        self._make_db(_get_user_db_path(uid))

        def _raise(conn, db_type):
            raise BelowMigrationFloor("sqlite", 3, 5)

        monkeypatch.setattr(m.USER_DB_RUNNER, "run", _raise)
        try:
            with pytest.raises(BelowMigrationFloor):
                m.migrate_local_user_db_at_seam(uid)
        finally:
            self._cleanup(uid)


# ===========================================================================
# Part 1b — DDL-vs-migrated schema equivalence (the load-bearing prerequisite).
# ===========================================================================

USER_ID_PREFIX = "test_t5089"


def _fresh_profile_db(user_id: str):
    """Build a head-schema profile.sqlite on disk via the real head DDL, exactly as
    a fresh signup does (ensure_database, is_fresh_db -> stamp head, no migrations)."""
    from app.database import ensure_database, get_database_path
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(user_id)
    set_current_profile_id("testdefault")
    ensure_database()
    return get_database_path()


class TestProfileDbEquivalence:
    """profile_db: build the migrated DB by dropping the audited post-floor column
    set (T6030's POST_V023_COLUMNS) off a head DDL, stamping to the floor, and
    letting the runner re-add them; assert it matches a pristine head DDL.

    SCOPE LIMITATION (reviewer MAJOR, 2026-09-02) — the FUTURE prune session must
    heed this: this test independently reconstructs ONLY the v024+ tail. Objects
    at or below v{FLOOR_VERSION} (e.g. v002 game_storage, v007 collection
    metadata, v009 season_rank TABLES) are trusted from the head DDL and NEVER
    replayed from the chain, because the below-23 profile_db migrations are
    side-effecting (pg/context/R2) and can't run headless. So this proves DDL ==
    chain for the TAIL only. If the proven prune floor F turns out to be <=
    {FLOOR_VERSION}, the pruned range includes table-creating migrations this test
    never verified — `test_prune_floor_within_verified_window` below FAILS in that
    case to force widening the reconstruction window first (mirror the user_db
    full-chain test). Unlike side-effect-free user_db, profile_db has no cheap way
    to close this until F is known.
    """

    def test_prune_floor_within_verified_window(self):
        # Structural alarm (greppable, T6030-style): the equivalence test above
        # only independently verifies v(FLOOR_VERSION+1)..head. A profile_db prune
        # floor at/below that window would delete table-creating migrations this
        # test never replays — false safety. This RED-lights that before the prune.
        from app.migrations.profile_db import RUNNER
        from tests.test_t6030_migration_window_structural_guard import FLOOR_VERSION

        assert RUNNER.floor == 0 or RUNNER.floor > FLOOR_VERSION, (
            f"profile_db floor is set to v{RUNNER.floor:03d}, at/below the equivalence "
            f"test's independently-verified window (v{FLOOR_VERSION:03d}). Before pruning "
            f"v001..v{RUNNER.floor:03d}, WIDEN test_fresh_ddl_equals_migrated_from_floor to "
            f"drop+replay the FULL pruned range — including the table-creating migrations "
            f"below v{FLOOR_VERSION + 1:03d} (v002 game_storage, v007, v009) — mirroring the "
            f"user_db full-chain test. Pruning on the current tail-only proof would be unsafe."
        )

    def _cleanup(self, user_id):
        import shutil

        from app.database import USER_DATA_BASE

        p = USER_DATA_BASE / user_id
        if p.exists():
            shutil.rmtree(p, ignore_errors=True)

    def test_fresh_ddl_equals_migrated_from_floor(self):
        from app.migrations.profile_db import RUNNER
        from tests.test_t6030_migration_window_structural_guard import (
            FLOOR_VERSION,
            POST_V023_COLUMNS,
        )

        uid_a = f"{USER_ID_PREFIX}_pa_{uuid.uuid4().hex[:8]}"
        uid_b = f"{USER_ID_PREFIX}_pb_{uuid.uuid4().hex[:8]}"
        try:
            # DB_A: pristine head DDL.
            path_a = _fresh_profile_db(uid_a)
            conn_a = sqlite3.connect(str(path_a))
            ddl_schema = snapshot_schema(conn_a)
            conn_a.close()

            # DB_B: head DDL, drop the post-floor columns, stamp to floor, migrate.
            path_b = _fresh_profile_db(uid_b)
            conn_b = sqlite3.connect(str(path_b))
            for table, cols in POST_V023_COLUMNS.items():
                for col in cols:
                    conn_b.execute(f"ALTER TABLE {table} DROP COLUMN {col}")
            conn_b.execute(f"PRAGMA user_version = {FLOOR_VERSION}")
            conn_b.commit()
            # The real runner re-applies v(FLOOR+1)..head. v033/v047 (the only
            # side-effectors > floor) no-op on an empty DB (no matching rows), so
            # this runs headless; every other tail migration is a schema ALTER
            # that re-creates a dropped column.
            applied = RUNNER.run(conn_b, "sqlite")
            assert applied, "expected the surviving tail to actually run"
            migrated_schema = snapshot_schema(conn_b)
            conn_b.close()

            _assert_schemas_equal(migrated_schema, ddl_schema, "profile_db")
        finally:
            self._cleanup(uid_a)
            self._cleanup(uid_b)


# The user_db objects created by v002..v007. Dropping these off a head DDL and
# re-running the chain must reproduce the DDL exactly. Explicit + greppable
# (refactoring rule 6); the audit alarm below turns a new user_db migration RED
# so this list can't silently rot.
USER_DB_MIGRATION_TABLES = ["user_activity", "user_activity_events", "user_action_log"]
USER_DB_HEAD_AUDITED = 7  # v007 clear_stale_stripe_customers (data-only)


class TestUserDbEquivalence:
    """user_db has NO side-effecting migrations, so this is the stronger test:
    drop every table v002..v007 create off a head _USER_DB_SCHEMA and run the
    FULL chain from v001; it must reproduce the DDL schema exactly."""

    def test_registry_head_is_audited(self):
        from app.migrations.user_db import MIGRATIONS

        head = max(m.version for m in MIGRATIONS)
        assert head == USER_DB_HEAD_AUDITED, (
            f"user_db head is now v{head:03d} but this equivalence test was audited at "
            f"v{USER_DB_HEAD_AUDITED:03d}. If the new migration adds a TABLE, add it to "
            f"USER_DB_MIGRATION_TABLES; then bump USER_DB_HEAD_AUDITED."
        )

    def test_fresh_ddl_equals_full_chain(self):
        from app.migrations.user_db import RUNNER
        from app.services.user_db import _USER_DB_SCHEMA

        # DB_A: pristine head DDL.
        conn_a = sqlite3.connect(":memory:")
        conn_a.executescript(_USER_DB_SCHEMA)
        ddl_schema = snapshot_schema(conn_a)
        conn_a.close()

        # DB_B: head DDL minus the migration-created tables, stamped to the v001
        # baseline, then run the full v002..v007 chain to re-create them.
        conn_b = sqlite3.connect(":memory:")
        conn_b.executescript(_USER_DB_SCHEMA)
        for table in USER_DB_MIGRATION_TABLES:
            conn_b.execute(f"DROP TABLE IF EXISTS {table}")
        conn_b.execute("PRAGMA user_version = 1")
        conn_b.commit()
        applied = RUNNER.run(conn_b, "sqlite")
        assert applied, "expected the full v002..v007 chain to run"
        migrated_schema = snapshot_schema(conn_b)
        conn_b.close()

        _assert_schemas_equal(migrated_schema, ddl_schema, "user_db")
