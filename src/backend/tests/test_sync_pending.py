"""Tests for T930 sync pending marker functions.

T5081 (review round 3): `mark_sync_pending`/`clear_sync_pending` now require an
explicit scope (no more `scope=None` bare-marker default) — see the INV-P
comment in database.py. `has_sync_pending` stays the untargeted aggregate
check (also covers a stray legacy bare marker, see test_t5081_pending_scoping.py).
"""

from unittest.mock import patch

import app.database as db_module
from app.database import clear_sync_pending, has_sync_pending, mark_sync_pending

SCOPE = "prof1"


def _patch_base(tmp_path):
    """Return a patch context that sets USER_DATA_BASE to tmp_path."""
    return patch.object(db_module, "USER_DATA_BASE", tmp_path)


def test_mark_creates_file(tmp_path):
    """mark_sync_pending creates a per-scope .sync_pending.{scope} file."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1", SCOPE)
    assert (tmp_path / "user1" / f".sync_pending.{SCOPE}").exists()


def test_mark_requires_a_scope(tmp_path):
    """T5081: no more bare-marker default — an empty scope is a caller bug."""
    with _patch_base(tmp_path):
        try:
            mark_sync_pending("user1", "")
            assert False, "expected ValueError"
        except ValueError:
            pass
        try:
            mark_sync_pending("user1", None)
            assert False, "expected ValueError"
        except (ValueError, TypeError):
            pass


def test_has_sync_pending_false_initially(tmp_path):
    """has_sync_pending returns False when no marker exists."""
    with _patch_base(tmp_path):
        (tmp_path / "user1").mkdir()
        assert has_sync_pending("user1") is False


def test_has_sync_pending_true_after_mark(tmp_path):
    """has_sync_pending returns True after mark_sync_pending."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1", SCOPE)
        assert has_sync_pending("user1") is True


def test_clear_removes_file(tmp_path):
    """clear_sync_pending removes the file, has_sync_pending returns False."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1", SCOPE)
        assert has_sync_pending("user1") is True
        clear_sync_pending("user1", SCOPE)
        assert has_sync_pending("user1") is False
        assert not (tmp_path / "user1" / f".sync_pending.{SCOPE}").exists()


def test_clear_nonexistent_no_error(tmp_path):
    """clear_sync_pending on non-existent file doesn't raise."""
    with _patch_base(tmp_path):
        (tmp_path / "user1").mkdir()
        clear_sync_pending("user1", SCOPE)  # Should not raise


def test_mark_idempotent(tmp_path):
    """Calling mark_sync_pending twice doesn't error."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1", SCOPE)
        mark_sync_pending("user1", SCOPE)  # Should not raise
        assert has_sync_pending("user1") is True


def test_different_users_isolated(tmp_path):
    """Different user_ids are isolated."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1", SCOPE)
        assert has_sync_pending("user1") is True
        assert has_sync_pending("user2") is False
        mark_sync_pending("user2", SCOPE)
        assert has_sync_pending("user2") is True
        clear_sync_pending("user1", SCOPE)
        assert has_sync_pending("user1") is False
        assert has_sync_pending("user2") is True


def test_different_scopes_of_same_user_are_independent(tmp_path):
    """T5081: two scopes of the same user must not share state."""
    with _patch_base(tmp_path):
        mark_sync_pending("user1", "prof1")
        mark_sync_pending("user1", "prof2")
        clear_sync_pending("user1", "prof1")
        from app.database import has_sync_pending_scope
        assert has_sync_pending_scope("user1", "prof1") is False
        assert has_sync_pending_scope("user1", "prof2") is True
