"""T7530: update_last_seen must skip the write during admin impersonation.

Impersonating a user was updating that user's users.last_seen_at, overstating
retention/WAU. The writer now carries the same T1515 impersonation guard that
keeps user_segments.last_active_at clean (analytics.update_session).
"""

import pytest

from app.services.auth_db import create_user, update_last_seen
from app.user_context import set_current_impersonator_id


def _get_last_seen(user_id: str):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT last_seen_at FROM users WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
        return row["last_seen_at"] if row else None


class TestUpdateLastSeenImpersonationGuard:
    @pytest.fixture(autouse=True)
    def _create_user(self, pg_conn):
        create_user("user-a", email="a@test.com")
        yield
        # Always clear the contextvar so it can't leak into other tests.
        set_current_impersonator_id(None)

    def test_skips_write_during_impersonation(self, pg_conn):
        """A request under an active impersonation session must NOT touch last_seen_at."""
        before = _get_last_seen("user-a")  # NULL for a freshly created user
        set_current_impersonator_id("admin-1")
        update_last_seen("user-a")
        after = _get_last_seen("user-a")
        assert after == before, "last_seen_at changed during impersonation"

    def test_normal_request_still_updates(self, pg_conn):
        """Regression: a normal (non-impersonated) request DOES update last_seen_at."""
        set_current_impersonator_id(None)
        before = _get_last_seen("user-a")  # NULL for a freshly created user
        update_last_seen("user-a")
        after = _get_last_seen("user-a")
        assert after is not None
        assert after != before, "last_seen_at was not updated for a normal request"
