"""T4970: admin user enumeration must include users without a user_segments row.

`user_segments` rows are created ONLY in the OAuth/OTP signup flows
(auth.py `create_user_segment`, guarded by `is_new`). Test-login
(auth.py:877), the test seam, and copied accounts create users via
`create_user` with NO segment row — BY DESIGN. So a user legitimately has no
segment (this is the `e2e@test.local` account in the bug report).

The `GET /api/admin/users` endpoint (`list_users`) INNER-joined `user_segments`,
so those users were invisible (5 listed, not 6). Fix = LEFT JOIN with NULL
segment fields (decision option A: enumeration must not depend on the optional
analytics table; frontend already renders NULLs as `—` per the T4870 pattern).

`get_all_users_for_admin()` (the enumerator poster-backfill / migrations iterate)
already has NO join, so it always included segmentless users — pinned here so a
future refactor can't reintroduce a segment dependency and silently under-cover.
"""

import asyncio
from unittest.mock import patch

import pytest

from app.services.auth_db import create_user, get_all_users_for_admin

SEGMENTED_USER = "user-a"      # in _TEST_USER_IDS (conftest cleans these)
SEGMENTLESS_USER = "user-b"    # created without a user_segments row


def _seed_users():
    """user-a has a segment (normal signup); user-b has none (test-login-style)."""
    from app.analytics import create_user_segment

    create_user(SEGMENTED_USER, email="a@test.local")
    create_user_segment(SEGMENTED_USER, origin="organic", referrer_id=None,
                        signup_method="google")
    # user-b: created like test-login / a copied account — NO segment row.
    create_user(SEGMENTLESS_USER, email="b@test.local")


def test_get_all_users_for_admin_includes_segmentless(pg_conn):
    """Enumeration source must not depend on user_segments (backfill coverage)."""
    _seed_users()
    ids = {u["user_id"] for u in get_all_users_for_admin()}
    assert SEGMENTED_USER in ids
    assert SEGMENTLESS_USER in ids, (
        "segmentless user must be enumerated — poster backfill / migrations "
        "iterate this list and would otherwise silently skip the user"
    )


def test_list_users_endpoint_includes_segmentless_with_null_fields(pg_conn):
    """GET /api/admin/users lists the segmentless user with NULL segment fields."""
    _seed_users()

    from app.routers import admin

    with patch.object(admin, "_require_admin", return_value=None), \
         patch.object(admin, "get_credit_stats_for_admin", return_value={}):
        # Pass explicit args: calling the coroutine directly bypasses FastAPI's
        # Query() default resolution, so the filter params must be real None.
        resp = asyncio.run(admin.list_users(
            page=1, page_size=50,
            origin=None, acquired_from=None, acquired_to=None, filter=None,
        ))

    by_id = {u["user_id"]: u for u in resp["users"]}
    assert SEGMENTLESS_USER in by_id, (
        f"segmentless user missing from admin list (inner-join bug); got {list(by_id)}"
    )
    assert SEGMENTED_USER in by_id
    # total_users count must include the segmentless user (COUNT also LEFT JOINed).
    assert resp["total_users"] >= 2

    seg = by_id[SEGMENTLESS_USER]
    # Segment fields are NULL, never fabricated (T4870 null-not-zero pattern).
    assert seg["origin"] is None
    assert seg["acquired_at"] is None
    assert seg["last_active_at"] is None
    assert seg["total_spent_cents"] == 0  # `or 0` display default for the money col

    # The segmented user still carries its real origin.
    assert by_id[SEGMENTED_USER]["origin"] == "organic"
