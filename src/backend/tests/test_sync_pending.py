"""Tests for T930 sync pending marker functions."""

from unittest.mock import patch

import app.database as db_module
from app.database import clear_sync_pending, has_sync_pending, mark_sync_pending


def _patch_base(tmp_path):
    """Return a patch context that sets USER_DATA_BASE to tmp_path."""
    return patch.object(db_module, "USER_DATA_BASE", tmp_path)


def test_mark_creates_file(tmp_path):
    """mark_sync_pending creates .sync_pending file in user_data/{user_id}/."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1")
    assert (tmp_path / "user1" / ".sync_pending").exists()


def test_has_sync_pending_false_initially(tmp_path):
    """has_sync_pending returns False when no marker exists."""
    with _patch_base(tmp_path):
        (tmp_path / "user1").mkdir()
        assert has_sync_pending("user1") is False


def test_has_sync_pending_true_after_mark(tmp_path):
    """has_sync_pending returns True after mark_sync_pending."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1")
        assert has_sync_pending("user1") is True


def test_clear_removes_file(tmp_path):
    """clear_sync_pending removes the file, has_sync_pending returns False."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1")
        assert has_sync_pending("user1") is True
        clear_sync_pending("user1")
        assert has_sync_pending("user1") is False
        assert not (tmp_path / "user1" / ".sync_pending").exists()


def test_clear_nonexistent_no_error(tmp_path):
    """clear_sync_pending on non-existent file doesn't raise."""
    with _patch_base(tmp_path):
        (tmp_path / "user1").mkdir()
        clear_sync_pending("user1")  # Should not raise


def test_mark_idempotent(tmp_path):
    """Calling mark_sync_pending twice doesn't error."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1")
        mark_sync_pending("user1")  # Should not raise
        assert has_sync_pending("user1") is True


def test_different_users_isolated(tmp_path):
    """Different user_ids are isolated."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1")
        assert has_sync_pending("user1") is True
        assert has_sync_pending("user2") is False
        mark_sync_pending("user2")
        assert has_sync_pending("user2") is True
        clear_sync_pending("user1")
        assert has_sync_pending("user1") is False
        assert has_sync_pending("user2") is True
