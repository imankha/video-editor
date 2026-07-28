"""
Tests for T940: Export Worker R2 Sync.

Covers:
- sync_db_to_r2_explicit: explicit (non-context-var) sync for background workers
- sync_user_db_to_r2_explicit: same pattern for user.sqlite
- _sync_after_export: orchestrates both syncs after export job completion
"""

from pathlib import Path
from unittest.mock import patch

from app.database import SyncResult


def _patch_path_exists(target_path):
    """Return a patch that makes Path.exists() return True for any path matching target_path."""
    original_exists = Path.exists

    def _exists(self):
        if str(self) == str(target_path):
            return True
        return original_exists(self)

    return patch.object(Path, "exists", _exists)


# ---------------------------------------------------------------------------
# 1. sync_db_to_r2_explicit — calls sync_database_to_r2_with_version correctly
# ---------------------------------------------------------------------------

class TestSyncDbToR2Explicit:
    """Tests for the explicit profile-DB sync (no ContextVar dependency)."""

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=5)
    @patch("app.database.check_database_size")
    def test_calls_with_correct_args(self, mock_check_size, mock_get_ver, mock_sync):
        """sync_db_to_r2_explicit passes user_id, db_path, and current version."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (True, 6)
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path):
            result = sync_db_to_r2_explicit("u1", "p1")

        # T5340: profile_id is threaded through so the R2 upload key is derived
        # from the ARG (profile_r2_key), never get_current_profile_id().
        # T4310: CAS is ON by default for background-worker callers.
        mock_sync.assert_called_once_with(
            "u1", db_path, 5, skip_version_check=False, lock_timeout=None, profile_id="p1")
        assert result is SyncResult.OK

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=3)
    @patch("app.database.check_database_size")
    def test_returns_true_on_success_and_updates_version(self, mock_check, mock_get_ver, mock_sync):
        """On success, returns True and updates the local version cache."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (True, 4)
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path), \
             patch("app.database.set_local_db_version") as mock_set_ver:
            result = sync_db_to_r2_explicit("u1", "p1")

        assert result is SyncResult.OK
        mock_set_ver.assert_called_once_with("u1", "p1", 4)

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=3)
    @patch("app.database.check_database_size")
    def test_conflict_returns_conflict_and_invalidates_baseline(
        self, mock_check, mock_get_ver, mock_sync, tmp_path,
    ):
        """T6160: CAS refusal returns SyncResult.CONFLICT and INVALIDATES the
        loaded-from baseline (set to None) so the NEXT request performs a
        first-access re-pull of R2's newer copy (self-heal) instead of
        conflicting forever on a running machine (staging 2026-07-27).

        SAFETY (unchanged from the old frozen-baseline contract): the stale
        upload is still REFUSED and the stale copy NEVER lands on R2 -- proven
        two ways here:
          * mock_sync returns (False, 9): storage.py refused the upload; the
            result is CONFLICT (not OK), so nothing this call did made the write
            succeed.
          * the baseline is set to None, NOT advanced to R2's v9. None does NOT
            disarm CAS: the T4315 BLOCKING-2 unconfirmed-baseline branch in
            storage.sync_database_to_r2_with_version refuses whenever
            `r2_version > 0 and current_version is None`, exactly as it refuses a
            stale version. So if the next-access re-pull has not yet healed the
            local copy, a second upload attempt is refused identically -- a
            None baseline can never force a stale copy over newer R2 content.
        The one thing that changes vs. the old contract is that recovery is now
        possible (re-pull on next access) instead of impossible (frozen until
        process restart)."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (False, 9)  # conflict: refused, R2 is at v9
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path), \
             patch("app.database.USER_DATA_BASE", tmp_path), \
             patch("app.database.set_local_db_version") as mock_set_ver:
            result = sync_db_to_r2_explicit("u1", "p1")

        assert result is SyncResult.CONFLICT
        assert result == "conflict"  # str-Enum: comparable to the raw status string
        assert not result  # falsy, same as a plain failure for legacy bool callers
        # New contract: baseline is INVALIDATED to None (self-heal on next access),
        # and critically NOT advanced to R2's v9 -- advancing to v9 would let the
        # next write compare stale local data against a "confirmed" v9 and silently
        # force-push it. None re-arms first-access restore AND still trips the
        # unconfirmed-baseline CAS refusal until the local copy is healed.
        mock_set_ver.assert_called_once_with("u1", "p1", None)

    @patch("app.database.R2_ENABLED", True)
    @patch("app.database.sync_database_to_r2_with_version")
    @patch("app.database.get_local_db_version", return_value=3)
    @patch("app.database.check_database_size")
    def test_returns_false_on_failure_no_version_update(self, mock_check, mock_get_ver, mock_sync):
        """On failure, returns False and does NOT update the local version."""
        from app.database import sync_db_to_r2_explicit

        mock_sync.return_value = (False, None)
        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "profiles" / "p1" / "profile.sqlite"

        with patch("app.database.get_user_data_path_explicit", return_value=db_path.parent), \
             _patch_path_exists(db_path), \
             patch("app.database.set_local_db_version") as mock_set_ver:
            result = sync_db_to_r2_explicit("u1", "p1")

        assert result is SyncResult.FAILED
        assert not result
        mock_set_ver.assert_not_called()

    @patch("app.database.R2_ENABLED", False)
    def test_returns_true_if_r2_disabled(self):
        """When R2 is not enabled, sync is a no-op returning True."""
        from app.database import sync_db_to_r2_explicit

        result = sync_db_to_r2_explicit("u1", "p1")
        assert result is SyncResult.OK
        assert result


# ---------------------------------------------------------------------------
# 2. sync_user_db_to_r2_explicit — same pattern for user.sqlite
# ---------------------------------------------------------------------------

class TestSyncUserDbToR2Explicit:
    """Tests for the explicit user-DB sync (no ContextVar dependency)."""

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_calls_with_correct_args(self, mock_get_ver):
        """sync_user_db_to_r2_explicit passes user_id, db_path, and version."""
        from app.database import sync_user_db_to_r2_explicit

        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", fake_base), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version") as mock_sync:
            mock_sync.return_value = (True, 3)
            result = sync_user_db_to_r2_explicit("u1")

        # T4310: CAS is ON by default for background-worker callers.
        mock_sync.assert_called_once_with("u1", db_path, 2, skip_version_check=False, lock_timeout=None)
        assert result is SyncResult.OK

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_returns_true_on_success_updates_version(self, mock_get_ver):
        """On success, returns True and updates the local user-db version."""
        from app.database import sync_user_db_to_r2_explicit

        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", fake_base), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version", return_value=(True, 3)), \
             patch("app.database.set_local_user_db_version") as mock_set_ver:
            result = sync_user_db_to_r2_explicit("u1")

        assert result is SyncResult.OK
        mock_set_ver.assert_called_once_with("u1", 3)

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_conflict_returns_conflict_and_invalidates_baseline(self, mock_get_ver, tmp_path):
        """T6160: user.sqlite twin of the profile-DB test above. CAS refusal
        returns SyncResult.CONFLICT and INVALIDATES the loaded-from baseline
        (set to None) so the next ensure_user_database re-pulls R2's newer copy
        (self-heal via schedule_user_db_reheal, which also drops the
        _initialized_user_dbs init flag).

        SAFETY (unchanged): the stale upload is REFUSED (mock returns (False, 9))
        and the stale copy NEVER lands on R2. The baseline is set to None, NOT
        advanced to R2's v9 -- and None still refuses: the T4315 BLOCKING-2
        unconfirmed-baseline branch in storage.sync_user_db_to_r2_with_version
        refuses whenever `r2_version > 0 and current_version is None`, so a second
        attempt before the re-pull heals is refused identically. None enables
        recovery; it never enables a stale force-push."""
        from app.database import sync_user_db_to_r2_explicit

        db_path = tmp_path / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", tmp_path), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version", return_value=(False, 9)), \
             patch("app.database.set_local_user_db_version") as mock_set_ver:
            result = sync_user_db_to_r2_explicit("u1")

        assert result is SyncResult.CONFLICT
        assert not result
        # New contract: baseline INVALIDATED to None (self-heal), NOT advanced to v9.
        mock_set_ver.assert_called_once_with("u1", None)

    @patch("app.database.get_local_user_db_version", return_value=2)
    def test_returns_false_on_failure_no_version_update(self, mock_get_ver):
        """On failure, returns False and does NOT update the local version."""
        from app.database import sync_user_db_to_r2_explicit

        fake_base = Path("/fake/user_data")
        db_path = fake_base / "u1" / "user.sqlite"

        with patch("app.database.R2_ENABLED", True), \
             patch("app.database.USER_DATA_BASE", fake_base), \
             _patch_path_exists(db_path), \
             patch("app.storage.sync_user_db_to_r2_with_version", return_value=(False, None)), \
             patch("app.database.set_local_user_db_version") as mock_set_ver:
            result = sync_user_db_to_r2_explicit("u1")

        assert result is SyncResult.FAILED
        assert not result
        mock_set_ver.assert_not_called()

    @patch("app.database.R2_ENABLED", False)
    def test_returns_true_if_r2_disabled(self):
        """When R2 is not enabled, sync is a no-op returning True."""
        from app.database import sync_user_db_to_r2_explicit

        result = sync_user_db_to_r2_explicit("u1")
        assert result is SyncResult.OK
        assert result


# ---------------------------------------------------------------------------
# 3. _sync_after_export — orchestrates both syncs
# ---------------------------------------------------------------------------

class TestSyncAfterExport:
    """Tests for the export worker's post-export sync orchestrator (reads from config dict)."""

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit")
    def test_calls_both_syncs_when_config_complete(self, mock_db_sync, mock_user_sync):
        """When config has credit_user_id and profile_id, syncs both DBs."""
        from app.services.export_worker import _sync_after_export

        config = {"credit_user_id": "credit_u1", "profile_id": "p1"}
        _sync_after_export(config)

        mock_db_sync.assert_called_once_with("credit_u1", "p1")
        mock_user_sync.assert_called_once_with("credit_u1")

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit")
    def test_skips_sync_when_missing_user_id(self, mock_db_sync, mock_user_sync):
        """When config is missing credit_user_id, skips sync entirely."""
        from app.services.export_worker import _sync_after_export

        config = {"profile_id": "p1"}
        _sync_after_export(config)

        mock_db_sync.assert_not_called()
        mock_user_sync.assert_not_called()

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit")
    def test_skips_sync_when_missing_profile_id(self, mock_db_sync, mock_user_sync):
        """When config is missing profile_id, skips sync entirely."""
        from app.services.export_worker import _sync_after_export

        config = {"credit_user_id": "u1"}
        _sync_after_export(config)

        mock_db_sync.assert_not_called()
        mock_user_sync.assert_not_called()

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit")
    def test_no_typeerror_with_dict_config(self, mock_db_sync, mock_user_sync):
        """Regression: calling with a dict config must not raise TypeError."""
        from app.services.export_worker import _sync_after_export

        config = {"credit_user_id": "u1", "profile_id": "p1", "video_path": "/tmp/test.mp4"}
        _sync_after_export(config)

    @patch("app.database.sync_user_db_to_r2_explicit")
    @patch("app.database.sync_db_to_r2_explicit", side_effect=OSError("R2 upload failed"))
    def test_profile_sync_oserror_does_not_crash(self, mock_db_sync, mock_user_sync):
        """OSError from profile sync is caught; user sync still attempted."""
        from app.services.export_worker import _sync_after_export

        config = {"credit_user_id": "credit_u1", "profile_id": "p1"}
        _sync_after_export(config)

        mock_user_sync.assert_called_once_with("credit_u1")
