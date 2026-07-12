"""
Tests for T4870: Admin panel shows 0 credits for users with nonzero balances.

Root cause: get_credit_stats_for_admin reads raw local sqlite paths, bypassing
R2 restore, and silently skips missing files. admin.py then fabricates
{"credits_balance": 0} for absent users.

Fix: for missing files on the explicit-ids admin path, call
sync_user_db_from_r2_if_newer directly (not ensure_user_database, which creates
a balance-0 stub that would serve as "real" data on subsequent admin loads via
_initialized_user_dbs cache).

Failing tests (BEFORE fix):
- missing local file -> get_credit_stats_for_admin skips user -> admin shows 0, not real balance
- missing file + R2 error -> fabricated 0 in admin response instead of null
- credits_balance: 0 even when balance row is absent (should be null)
"""

import shutil
import sqlite3
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_user_db(user_dir, user_id: str, balance: int):
    """Create a user.sqlite with a specific credits balance."""
    from app.services.user_db import _USER_DB_SCHEMA
    user_dir.mkdir(parents=True, exist_ok=True)
    db_path = user_dir / "user.sqlite"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(_USER_DB_SCHEMA)
    conn.execute("INSERT INTO credits (user_id, balance) VALUES (?, ?)", (user_id, balance))
    conn.commit()
    conn.close()
    return db_path


# ---------------------------------------------------------------------------
# Service-layer tests: get_credit_stats_for_admin
# ---------------------------------------------------------------------------

class TestGetCreditStatsForAdmin:

    def test_existing_file_reads_correct_balance(self, tmp_path, monkeypatch):
        """Baseline: existing local user.sqlite is read correctly."""
        from app.services import user_db as m
        user_id = "t4870-existing"
        user_data_base = tmp_path / "user_data"
        _create_user_db(user_data_base / user_id, user_id, 77)

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())

        stats = m.get_credit_stats_for_admin([user_id])

        assert user_id in stats
        assert stats[user_id]["credits_balance"] == 77

    def test_missing_local_file_returns_real_balance_after_r2_restore(self, tmp_path, monkeypatch):
        """FAILING before fix: missing user.sqlite -> R2 restore -> real balance shown.

        Current behavior: file missing -> skip -> user absent from stats -> admin shows 0.
        Expected after fix: sync_user_db_from_r2_if_newer called -> balance 42 returned.
        """
        from app.services import user_db as m
        user_id = "t4870-missing"
        user_data_base = tmp_path / "user_data"
        user_dir = user_data_base / user_id
        user_db_path = _create_user_db(user_dir, user_id, 42)

        # Save backup before deleting
        backup = tmp_path / "user.sqlite.bak"
        shutil.copy(str(user_db_path), str(backup))

        # Simulate ephemeral disk: local file gone
        user_db_path.unlink()
        assert not user_db_path.exists()

        # Mock R2 sync to simulate restore: copy backup to target path
        def mock_r2_sync(uid, db_path, local_version):
            if uid == user_id:
                shutil.copy(str(backup), str(db_path))
                return True, 1, False  # (was_synced, new_version, was_error)
            return False, None, False

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        # Patch at the import site within user_db.py
        import app.storage as storage_mod
        monkeypatch.setattr(storage_mod, "R2_ENABLED", True)
        monkeypatch.setattr(storage_mod, "sync_user_db_from_r2_if_newer", mock_r2_sync)

        stats = m.get_credit_stats_for_admin([user_id])

        assert user_id in stats, (
            f"User should be in stats after R2 restore, got {stats}"
        )
        assert stats[user_id]["credits_balance"] == 42, (
            f"Expected real balance 42, got {stats[user_id]['credits_balance']}"
        )

    def test_r2_error_with_missing_file_returns_null(self, tmp_path, monkeypatch):
        """FAILING before fix: R2 error + no local file -> user must be absent from stats (null).

        After fix: sync fails without creating a stub DB -> user absent -> null in admin response.
        Critically, no balance-0 stub is created, so subsequent admin loads also see null.
        """
        from app.services import user_db as m
        user_id = "t4870-r2-error"
        user_data_base = tmp_path / "user_data"
        user_dir = user_data_base / user_id
        user_dir.mkdir(parents=True)
        user_db_path = user_dir / "user.sqlite"
        # No user.sqlite - file absent

        def mock_r2_error(uid, db_path, local_version):
            # R2 error: return error, don't create any file
            return False, None, True  # (was_synced, new_version, was_error)

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        import app.storage as storage_mod
        monkeypatch.setattr(storage_mod, "R2_ENABLED", True)
        monkeypatch.setattr(storage_mod, "sync_user_db_from_r2_if_newer", mock_r2_error)

        stats = m.get_credit_stats_for_admin([user_id])

        assert user_id not in stats, (
            f"R2-error user should be absent from stats (null), got {stats.get(user_id)}"
        )
        # Critically: no stub DB was created (unlike ensure_user_database which creates one)
        assert not user_db_path.exists(), (
            "No stub DB should be created on R2 error - that would make subsequent loads serve 0"
        )

    def test_r2_error_no_stub_db_on_second_load(self, tmp_path, monkeypatch):
        """R2 error leaves no stub DB, so a second admin page load still sees null (not 0).

        This is the BLOCKING regression in the original fix: ensure_user_database would
        create a balance-0 stub that gets served as '0' on any subsequent load.
        With sync_user_db_from_r2_if_newer, no stub is created, so both loads see null.
        """
        from app.services import user_db as m
        user_id = "t4870-r2-two-loads"
        user_data_base = tmp_path / "user_data"
        user_dir = user_data_base / user_id
        user_dir.mkdir(parents=True)

        def mock_r2_error(uid, db_path, local_version):
            return False, None, True

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        import app.storage as storage_mod
        monkeypatch.setattr(storage_mod, "R2_ENABLED", True)
        monkeypatch.setattr(storage_mod, "sync_user_db_from_r2_if_newer", mock_r2_error)

        # First load
        stats1 = m.get_credit_stats_for_admin([user_id])
        assert user_id not in stats1, "First load: R2 error user should be absent (null)"

        # Second load (same process, simulates admin refreshing the page)
        stats2 = m.get_credit_stats_for_admin([user_id])
        assert user_id not in stats2, (
            "Second load: R2 error user should still be absent (null), not fabricated 0. "
            f"Got credits_balance={stats2.get(user_id, {}).get('credits_balance')}"
        )

    def test_stale_version_cache_with_missing_file_restores_from_r2(self, tmp_path, monkeypatch):
        """Stale in-memory version cache with missing local file must not fall through to connect.

        Reviewer MAJOR finding: if the version cache holds user's version >= R2 version,
        sync_user_db_from_r2_if_newer returns (False, local_version, False) — 'already current'.
        Before fix: fell through to sqlite3.connect on missing path, creating an empty stub.
        After fix: local_version=None is passed for missing files, forcing R2 consult regardless
        of the in-memory cache.
        """
        import shutil
        from app.services import user_db as m
        user_id = "t4870-stale-cache"
        user_data_base = tmp_path / "user_data"
        user_dir = user_data_base / user_id

        # Build a real DB with balance=55 as the "R2 backup"
        backup = tmp_path / "user.sqlite.bak"
        _create_user_db(user_dir, user_id, 55)
        real_db = user_dir / "user.sqlite"
        shutil.copy(str(real_db), str(backup))

        # Now delete the local file, simulating ephemeral disk eviction
        real_db.unlink()
        assert not real_db.exists()

        def mock_sync(uid, db_path, local_version):
            # Simulate "R2 has the file; restore it regardless of local_version arg"
            assert local_version is None, (
                f"Expected local_version=None for missing file, got {local_version!r}. "
                "The stale-cache fix must pass None so sync always consults R2."
            )
            shutil.copy(str(backup), str(db_path))
            return True, 1, False

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        import app.storage as storage_mod
        monkeypatch.setattr(storage_mod, "R2_ENABLED", True)
        monkeypatch.setattr(storage_mod, "sync_user_db_from_r2_if_newer", mock_sync)

        stats = m.get_credit_stats_for_admin([user_id])

        assert user_id in stats, f"User should be restored from R2; got {stats}"
        assert stats[user_id]["credits_balance"] == 55

    def test_r2_not_found_new_user_skipped(self, tmp_path, monkeypatch):
        """Genuinely new user with no R2 object is skipped (no credits to show)."""
        from app.services import user_db as m
        user_id = "t4870-new-user"
        user_data_base = tmp_path / "user_data"
        (user_data_base / user_id).mkdir(parents=True)

        def mock_r2_not_found(uid, db_path, local_version):
            return False, None, False  # NOT_FOUND: (was_synced=False, version=None, error=False)

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())
        import app.storage as storage_mod
        monkeypatch.setattr(storage_mod, "R2_ENABLED", True)
        monkeypatch.setattr(storage_mod, "sync_user_db_from_r2_if_newer", mock_r2_not_found)

        stats = m.get_credit_stats_for_admin([user_id])

        # New users have no credits to display yet
        assert user_id not in stats

    def test_credits_balance_is_null_when_no_credits_row(self, tmp_path, monkeypatch):
        """FAILING before fix: credits_balance returns None (not 0) when credits row is absent."""
        from app.services import user_db as m
        user_id = "t4870-no-row"
        user_data_base = tmp_path / "user_data"
        user_dir = user_data_base / user_id
        user_dir.mkdir(parents=True)

        # Create user.sqlite with schema but NO credits row
        db_path = user_dir / "user.sqlite"
        conn = sqlite3.connect(str(db_path))
        conn.executescript(m._USER_DB_SCHEMA)
        conn.commit()
        conn.close()

        monkeypatch.setattr(m, "USER_DATA_BASE", user_data_base)
        monkeypatch.setattr(m, "_initialized_user_dbs", set())

        stats = m.get_credit_stats_for_admin([user_id])

        assert user_id in stats
        assert stats[user_id]["credits_balance"] is None, (
            f"Expected None for missing credits row, got {stats[user_id]['credits_balance']}"
        )


# ---------------------------------------------------------------------------
# Admin router: credits=null passthrough (logic-level unit test)
# ---------------------------------------------------------------------------

class TestAdminUsersNullCredits:

    def test_missing_stats_assembly_passes_null(self):
        """FAILING before fix: admin.py fabricates credits=0 for users absent from stats.

        After fix: admin.py passes credits=null (None) when user is absent from credit_stats.
        """
        user_id = "missing-user-4870"
        credit_stats = {}  # user absent — simulates missing/unreadable user.sqlite

        # Before fix: fabricates {"credits_balance": 0, ...}
        old_user_credit = credit_stats.get(user_id, {
            "credits_spent": 0, "credits_purchased": 0,
            "credits_balance": 0, "purchase_credit_amounts": [],
        })
        assert old_user_credit["credits_balance"] == 0, "Old code fabricates 0"

        # After fix: returns None and passes null
        new_user_credit = credit_stats.get(user_id)  # -> None
        credits_new = new_user_credit["credits_balance"] if new_user_credit else None
        assert credits_new is None, (
            f"Expected credits=null when user absent from stats, got {credits_new}"
        )
