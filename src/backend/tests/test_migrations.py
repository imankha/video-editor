"""Tests for the migration system infrastructure."""

import sqlite3
import tempfile
import os

import pytest

from app.migrations.base import BaseMigration, MigrationRunner, NoOpMigration


class FakeAddColumn(BaseMigration):
    version = 2
    description = "Add test_col to dummy table"

    def up(self, conn) -> None:
        conn.execute("ALTER TABLE dummy ADD COLUMN test_col TEXT")


class TestMigrationRunner:
    def test_baseline_sets_version(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            db_path = f.name
        try:
            conn = sqlite3.connect(db_path)
            assert conn.execute("PRAGMA user_version").fetchone()[0] == 0

            baseline = NoOpMigration()
            baseline.version = 1
            baseline.description = "baseline"
            runner = MigrationRunner([baseline])

            applied = runner.run(conn, "sqlite")
            assert len(applied) == 1
            assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
            conn.close()
        finally:
            os.unlink(db_path)

    def test_idempotent_run(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            db_path = f.name
        try:
            conn = sqlite3.connect(db_path)

            baseline = NoOpMigration()
            baseline.version = 1
            baseline.description = "baseline"
            runner = MigrationRunner([baseline])

            applied_first = runner.run(conn, "sqlite")
            assert len(applied_first) == 1

            applied_second = runner.run(conn, "sqlite")
            assert len(applied_second) == 0
            assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
            conn.close()
        finally:
            os.unlink(db_path)

    def test_pending_skips_applied(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            db_path = f.name
        try:
            conn = sqlite3.connect(db_path)
            conn.execute("PRAGMA user_version = 1")

            baseline = NoOpMigration()
            baseline.version = 1
            baseline.description = "baseline"

            conn.execute("CREATE TABLE dummy (id INTEGER PRIMARY KEY)")
            conn.commit()

            runner = MigrationRunner([baseline, FakeAddColumn()])
            pending = runner.get_pending(conn, "sqlite")
            assert len(pending) == 1
            assert pending[0].version == 2

            applied = runner.run(conn, "sqlite")
            assert len(applied) == 1
            assert conn.execute("PRAGMA user_version").fetchone()[0] == 2
            conn.close()
        finally:
            os.unlink(db_path)

    def test_latest_version(self):
        baseline = NoOpMigration()
        baseline.version = 1
        baseline.description = "baseline"
        runner = MigrationRunner([baseline, FakeAddColumn()])
        assert runner.latest_version == 2

    def test_empty_migrations(self):
        runner = MigrationRunner([])
        assert runner.latest_version == 0

    def test_get_current_version_fresh_db(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
            db_path = f.name
        try:
            conn = sqlite3.connect(db_path)
            baseline = NoOpMigration()
            baseline.version = 1
            baseline.description = "baseline"
            runner = MigrationRunner([baseline])
            assert runner.get_current_version(conn, "sqlite") == 0
            conn.close()
        finally:
            os.unlink(db_path)


class TestTrackImports:
    def test_user_db_track(self):
        from app.migrations.user_db import RUNNER, MIGRATIONS
        assert len(MIGRATIONS) == 6
        assert MIGRATIONS[0].version == 1
        assert RUNNER.latest_version == 6

    def test_profile_db_track(self):
        from app.migrations.profile_db import RUNNER, MIGRATIONS
        # Dynamic invariants, not a hardcoded count/head (T5640: v028 -> v029
        # broke the old `== 28` literals; this track's head moves often).
        versions = [m.version for m in MIGRATIONS]
        assert versions == sorted(versions), "migrations must be registered in version order"
        assert len(versions) == len(set(versions)), "no duplicate migration versions"
        assert MIGRATIONS[0].version == 1
        assert RUNNER.latest_version == max(versions)

    def test_postgres_track(self):
        from app.migrations.postgres import RUNNER, MIGRATIONS
        assert len(MIGRATIONS) == 18
        assert MIGRATIONS[0].version == 1
        assert RUNNER.latest_version == 18

    def test_orchestrator_imports(self):
        from app.migrations import get_migration_status
        from app.migrations.postgres import RUNNER as POSTGRES_RUNNER
        from app.migrations.profile_db import RUNNER as PROFILE_DB_RUNNER
        from app.migrations.user_db import RUNNER as USER_DB_RUNNER
        status = get_migration_status()
        # Compare against each track's own RUNNER.latest_version (dynamic),
        # not a hardcoded literal that a new migration would break.
        assert status["user_db"]["latest_version"] == USER_DB_RUNNER.latest_version
        assert status["profile_db"]["latest_version"] == PROFILE_DB_RUNNER.latest_version
        assert status["postgres"]["latest_version"] == POSTGRES_RUNNER.latest_version
