"""T6850 -- drop the dead `user_settings.intro_min_duration_seconds` column
(profile_db v043). The threshold gated the inherit-the-default-intro path;
T6680 removed that path entirely, so T5215's v041 addition became dead data.
This migration is v041's mirror in reverse: same column, opposite direction,
same idempotent/absent-column-safe guard shape.

Design: docs/plans/tasks/T6850-design.md.
"""

import sqlite3


def _make_conn_with_column(tmp_path, name="legacy.sqlite"):
    db_path = tmp_path / name
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE user_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            settings_json TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0
        )
    """)
    conn.execute("INSERT INTO user_settings (id) VALUES (1)")
    conn.commit()
    return conn


def _make_conn_without_column(tmp_path, name="fresh.sqlite"):
    db_path = tmp_path / name
    conn = sqlite3.connect(str(db_path))
    conn.execute("""
        CREATE TABLE user_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            settings_json TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("INSERT INTO user_settings (id) VALUES (1)")
    conn.commit()
    return conn


class TestMigrationV043:
    def test_drops_column_when_present(self, tmp_path):
        from app.migrations.profile_db.v043_drop_intro_min_duration import (
            V043DropIntroMinDuration,
        )

        conn = _make_conn_with_column(tmp_path)
        cols_before = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" in cols_before

        V043DropIntroMinDuration().up(conn)
        conn.commit()

        cols_after = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" not in cols_after
        conn.close()

    def test_absent_column_is_a_noop(self, tmp_path):
        """Fresh DBs created after the DDL change never had the column --
        the migration must not error naming a nonexistent column."""
        from app.migrations.profile_db.v043_drop_intro_min_duration import (
            V043DropIntroMinDuration,
        )

        conn = _make_conn_without_column(tmp_path)
        cols_before = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" not in cols_before

        V043DropIntroMinDuration().up(conn)  # must not raise
        conn.commit()

        cols_after = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" not in cols_after
        conn.close()

    def test_idempotent_rerun(self, tmp_path):
        from app.migrations.profile_db.v043_drop_intro_min_duration import (
            V043DropIntroMinDuration,
        )

        conn = _make_conn_with_column(tmp_path)
        m = V043DropIntroMinDuration()
        m.up(conn)
        m.up(conn)  # must not raise
        conn.commit()

        cols = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" not in cols
        conn.close()

    def test_missing_table_is_a_noop(self, tmp_path):
        """No user_settings table at all (pre-v001-baseline edge) -- must not
        error looking up PRAGMA table_info on a table that doesn't exist."""
        from app.migrations.profile_db.v043_drop_intro_min_duration import (
            V043DropIntroMinDuration,
        )

        db_path = tmp_path / "no_table.sqlite"
        conn = sqlite3.connect(str(db_path))
        V043DropIntroMinDuration().up(conn)  # must not raise
        conn.close()

    def test_runner_applies_v043_to_a_below_head_db(self, tmp_path):
        conn = _make_conn_with_column(tmp_path, name="legacy2.sqlite")
        conn.execute("PRAGMA user_version = 42")
        conn.commit()

        from app.migrations.profile_db import MIGRATIONS, RUNNER

        applied = RUNNER.run(conn, "sqlite")
        applied_versions = {m.version for m in applied}
        assert 43 in applied_versions

        # A below-head DB run through the RUNNER sweeps every version above
        # its starting point, reaching the TRUE current head -- this test's
        # original intent, not just v043 in isolation. Assert that dynamically
        # against the registry rather than hardcoding a list of version
        # numbers: this test doesn't own the track's head, and a hardcoded
        # list breaks every time an unrelated later migration lands (this
        # line was itself extended 43->44,45,46 for exactly that reason --
        # see git history).
        expected_versions = {m.version for m in MIGRATIONS if m.version > 42}
        assert applied_versions == expected_versions

        cols = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        assert "intro_min_duration_seconds" not in cols
        assert conn.execute("PRAGMA user_version").fetchone()[0] == RUNNER.latest_version
        conn.close()

    def test_v043_is_still_the_free_version(self):
        """Guards against a future duplicate-version regression (the runner
        silently skips a duplicate). If this fails, someone added another v043."""
        from app.migrations.profile_db import MIGRATIONS

        versions = [m.version for m in MIGRATIONS]
        assert versions.count(43) == 1
        assert versions == sorted(versions)

    def test_registered_in_profile_db_migrations(self):
        """Renamed from test_registered_and_is_the_new_head: v043 must be
        registered in profile_db MIGRATIONS, but this test does not own the
        track's head -- later migrations (v044, v045, v046, v047, ...) have
        since landed above it. The hardcoded head assertion here had already
        been bumped once (43-is-head -> ==46) purely to track unrelated later
        migrations; test_migrations.py::test_profile_db_track owns that
        dynamic check, so this test only asserts registration."""
        from app.migrations.profile_db import MIGRATIONS

        assert 43 in {m.version for m in MIGRATIONS}


class TestFreshDbHasNoColumn:
    def test_fresh_profile_db_omits_column(self, tmp_path):
        from unittest.mock import patch

        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id("t6850-user")
        set_current_profile_id("t6850prof")
        with patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database._initialized_users", set()), \
             patch("app.database.R2_ENABLED", False), \
             patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
             patch("app.services.user_db._initialized_user_dbs", set()):
            from app.database import ensure_database, get_database_path
            ensure_database()
            conn = sqlite3.connect(str(get_database_path()))
            cols = {r[1] for r in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
            assert "intro_min_duration_seconds" not in cols
            conn.close()


class TestEndpointsRemoved:
    def test_intro_min_duration_symbols_no_longer_importable(self):
        """The GET/PATCH routes, the request model, and the service helpers
        are removed outright (not deprecated) -- importing any of them must
        fail, which is how we know the routes are gone (-> 404 at runtime)."""
        import app.routers.profiles as profiles_module

        for name in (
            "get_current_intro_min_duration",
            "update_current_intro_min_duration",
            "UpdateIntroMinDurationRequest",
        ):
            assert not hasattr(profiles_module, name), (
                f"app.routers.profiles.{name} should have been removed by T6850"
            )

        import app.services.intro_cards as intro_cards_module

        for name in (
            "DEFAULT_INTRO_MIN_DURATION_SECONDS",
            "get_intro_min_duration",
            "validate_intro_min_duration",
            "INTRO_MIN_DURATION_LOWER",
            "INTRO_MIN_DURATION_UPPER",
        ):
            assert not hasattr(intro_cards_module, name), (
                f"app.services.intro_cards.{name} should have been removed by T6850"
            )

    def test_no_route_registered_for_intro_min_duration(self):
        from app.main import app

        paths = {route.path for route in app.routes}
        assert "/api/profiles/current/intro-min-duration" not in paths
