"""T6345 — postgres migration runner must fill version GAPS, not compare to MAX.

Root cause: get_pending computed pending as `version > MAX(applied)`. A migration
numbered BELOW an already-applied version (branches merging out of numeric order:
T5770's v022 landed before v020/v021 were merged) was skipped silently and
permanently while run_all_migrations() reported success. Fix: pending is now
`registered version NOT IN the applied SET` for the postgres track.

The real incident state on dev + staging (2026-08-02):
    applied: [1 .. 19, 22]   max: 22   GAPS: [20, 21]

Two layers of coverage:
  * Pure-logic tests with a synthetic cursor — no DB required, prove the set
    membership semantics and that the sqlite branch is unchanged.
  * Real dev-Postgres tests (pg_conn) — seed the exact [1..19, 22] gap and prove
    v020/v021 report pending AND get applied by RUNNER.run(), and that a
    contiguous [1..22] history reports nothing pending (no common-case change).
"""

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

from app.migrations.base import BaseMigration, MigrationRunner


# ---------------------------------------------------------------------------
# Synthetic migrations + a fake postgres cursor (no DB) for pure-logic coverage
# ---------------------------------------------------------------------------

class _FakeMig(BaseMigration):
    def __init__(self, version):
        self.version = version
        self.description = f"fake v{version}"

    def up(self, conn):  # pragma: no cover - not exercised in logic tests
        pass


class _FakeCursor:
    """Returns applied versions as TUPLE rows (exercises the isinstance branch)."""

    def __init__(self, applied):
        self._applied = applied
        self._rows = []

    def execute(self, sql, params=None):
        if "MAX(version)" in sql:
            self._rows = [(max(self._applied) if self._applied else None,)]
        else:  # SELECT version FROM schema_migrations
            self._rows = [(v,) for v in self._applied]

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._rows[0] if self._rows else None


class _FakeConn:
    def __init__(self, applied):
        self._applied = applied

    def cursor(self):
        return _FakeCursor(self._applied)


class TestGetPendingSetMembership:
    def test_gap_below_max_is_pending(self):
        """[1..19, 22] applied -> v20 and v21 (below max=22) are pending."""
        runner = MigrationRunner([_FakeMig(v) for v in range(1, 23)])
        conn = _FakeConn(applied=list(range(1, 20)) + [22])
        pending = [m.version for m in runner.get_pending(conn, "postgres")]
        assert pending == [20, 21]

    def test_contiguous_history_reports_nothing(self):
        """A fully-migrated [1..22] env reports nothing pending (no common-case change)."""
        runner = MigrationRunner([_FakeMig(v) for v in range(1, 23)])
        conn = _FakeConn(applied=list(range(1, 23)))
        assert runner.get_pending(conn, "postgres") == []

    def test_fresh_db_reports_all_pending(self):
        runner = MigrationRunner([_FakeMig(v) for v in range(1, 23)])
        conn = _FakeConn(applied=[])
        pending = [m.version for m in runner.get_pending(conn, "postgres")]
        assert pending == list(range(1, 23))

    def test_pending_is_ascending(self):
        """Determinism: pending stays ascending even with a scattered ledger."""
        runner = MigrationRunner([_FakeMig(v) for v in range(1, 23)])
        conn = _FakeConn(applied=[22, 1, 5, 3])  # unordered ledger
        pending = [m.version for m in runner.get_pending(conn, "postgres")]
        assert pending == [2, 4] + list(range(6, 22))
        assert pending == sorted(pending)

    def test_get_applied_versions_returns_set(self):
        runner = MigrationRunner([_FakeMig(1)])
        conn = _FakeConn(applied=[1, 2, 5])
        assert runner.get_applied_versions(conn) == {1, 2, 5}


class TestSqliteBranchUnchanged:
    """The PRAGMA user_version tracks still use '> current' (a single integer
    cannot express a gap). Assessed in T6345: a migration numbered BELOW the
    stored user_version is <= current and never runs — a numbering-discipline
    hazard, not a runner bug the set test could recover (no per-version ledger)."""

    def test_sqlite_uses_greater_than_current(self):
        import sqlite3
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            db_path = f.name
        try:
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA user_version = 19")
            runner = MigrationRunner([_FakeMig(v) for v in range(1, 23)])
            pending = [m.version for m in runner.get_pending(conn, "sqlite")]
            assert pending == [20, 21, 22]  # strictly > 19; a below-19 gap is NOT recovered
            conn.close()
        finally:
            os.unlink(db_path)


# ---------------------------------------------------------------------------
# Real dev-Postgres: seed the exact incident gap and prove it heals
# ---------------------------------------------------------------------------

def _seed_versions(conn, versions):
    cur = conn.cursor()
    cur.execute("DELETE FROM schema_migrations")
    for v in versions:
        cur.execute(
            "INSERT INTO schema_migrations (version, description) VALUES (%s, %s)",
            (v, f"seed v{v}"),
        )
    conn.commit()


def _applied_versions(conn):
    cur = conn.cursor()
    cur.execute("SELECT version FROM schema_migrations ORDER BY version")
    return [r["version"] for r in cur.fetchall()]


class TestRealPostgresGapHeals:
    def test_gap_below_max_reported_pending_and_applied(self, pg_conn, preserve_schema_migrations):
        """[1..19, 22] -> v020/v021 pending AND applied by RUNNER.run(); ledger becomes 1..22.

        T6750: `_seed_versions` wipes the whole ledger; `preserve_schema_migrations`
        restores it in teardown so a mid-test failure can't poison later tests.
        """
        from app.migrations.postgres import RUNNER

        conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
        try:
            _seed_versions(conn, list(range(1, 20)) + [22])

            # Direct proof of the ledger BEFORE (the reproduced incident state).
            before = _applied_versions(conn)
            assert 20 not in before and 21 not in before and 22 in before

            pending = [m.version for m in RUNNER.get_pending(conn, "postgres")]
            assert pending == [20, 21], f"expected [20, 21] pending, got {pending}"

            applied = RUNNER.run(conn, "postgres")
            conn.commit()
            assert [m.version for m in applied] == [20, 21]

            after = _applied_versions(conn)
            assert after == list(range(1, 23)), f"ledger not contiguous 1..22: {after}"
        finally:
            conn.close()

    def test_contiguous_history_reports_nothing_pending(self, pg_conn, preserve_schema_migrations):
        """A fully-migrated [1..22] env still reports nothing pending (AC #4).

        T6750: `_seed_versions` wipes the whole ledger; `preserve_schema_migrations`
        restores it in teardown so a mid-test failure can't poison later tests.
        """
        from app.migrations.postgres import RUNNER

        conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
        try:
            _seed_versions(conn, list(range(1, 23)))
            pending = RUNNER.get_pending(conn, "postgres")
            assert pending == [], f"contiguous history should be pending-free, got {[m.version for m in pending]}"

            applied = RUNNER.run(conn, "postgres")
            conn.commit()
            assert applied == []
        finally:
            conn.close()
