"""T8110: admin panel — hide test accounts + global (whole-DB) sort.

Covers the four behaviours the task calls out plus the mark endpoint:
  - global ordering across page boundaries (page-1-row-1 is the true DB max),
  - hard sort whitelist (unknown key/dir -> 422, never interpolated),
  - `exclude_test` threaded through the list, the funnel totals, and a
    population analytics endpoint (platforms),
  - a segment-less user (T4970) still lists and sorts sanely (NULLS last),
  - last_step sorts by FUNNEL_STEPS progression, not alphabetically,
  - POST /users/{id}/test-account marks/unmarks and the exclusion reflects it.

Direct sync-call convention (T8020): list_users / analytics_* are plain `def`,
called directly with every param explicit. `_require_admin` and
`credit_ledger.stats_for_admin` are patched; the mark endpoint's admin-id log
needs `get_current_user_id` patched too.
"""

from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.analytics import create_user_segment
from app.routers import admin
from app.services import pg as pg_service
from app.services.auth_db import create_user


def _add_action(user_id, action, count, platform="web"):
    # Resolve get_pg via the module at call time so the pg_conn monkeypatch
    # (which replaces app.services.pg.get_pg) is honored -- a top-level
    # `from ... import get_pg` would bind the unpatched pool-less original.
    with pg_service.get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO user_actions (user_id, action, platform, count) "
            "VALUES (%s, %s, %s, %s) "
            "ON CONFLICT (user_id, action, platform) DO UPDATE SET count = EXCLUDED.count",
            (user_id, action, platform, count),
        )


def _mark_test(user_id, is_test):
    with pg_service.get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE users SET is_test_account = %s WHERE user_id = %s",
            (is_test, user_id),
        )


def _list(**kwargs):
    """Call list_users with sane explicit defaults; kwargs override."""
    params = dict(
        page=1, page_size=10, origin=None, acquired_from=None,
        acquired_to=None, filter=None, sort="last_active_at",
        sort_dir="desc", exclude_test=True,
    )
    params.update(kwargs)
    with patch.object(admin, "_require_admin", return_value=None), \
         patch.object(admin.credit_ledger, "stats_for_admin", return_value={}):
        return admin.list_users(**params)


# ---------------------------------------------------------------------------
# Part 2 — global sort across the whole user set
# ---------------------------------------------------------------------------

def test_global_sort_ranks_whole_db_across_page_boundaries(pg_conn):
    """page-1-row-1 is the true DB max for the column; paging continues the
    ordering with no repeats (not a page-local re-sort)."""
    for uid, clips in [("user-a", 5), ("user-b", 500), ("user-c", 50)]:
        create_user(uid, email=f"{uid}@test.local")
        create_user_segment(uid, origin="organic", referrer_id=None, signup_method="google")
        _add_action(uid, "clip_created", clips)

    seen = []
    for page in (1, 2, 3):
        resp = _list(page=page, page_size=1, sort="clip_created_count",
                     sort_dir="desc", exclude_test=False)
        ids = [u["user_id"] for u in resp["users"]]
        # restrict to our three seeded users (dev DB may hold others)
        seen.extend([i for i in ids if i in {"user-a", "user-b", "user-c"}])

    # The full descending ranking, discovered one page at a time:
    assert seen == ["user-b", "user-c", "user-a"], seen
    assert len(seen) == len(set(seen)), "a row repeated across page boundaries"


def test_ascending_sort_flips_order(pg_conn):
    for uid, clips in [("user-a", 5), ("user-b", 500)]:
        create_user(uid, email=f"{uid}@test.local")
        create_user_segment(uid, origin="organic", referrer_id=None, signup_method="google")
        _add_action(uid, "clip_created", clips)

    # page_size=50 captures the whole (small) dev set so NULLS-FIRST zero-clip
    # users can't push our two off the page in ascending order.
    desc = _list(sort="clip_created_count", sort_dir="desc", exclude_test=False, page_size=50)
    asc = _list(sort="clip_created_count", sort_dir="asc", exclude_test=False, page_size=50)
    desc_ids = [u["user_id"] for u in desc["users"] if u["user_id"] in {"user-a", "user-b"}]
    asc_ids = [u["user_id"] for u in asc["users"] if u["user_id"] in {"user-a", "user-b"}]
    assert desc_ids == ["user-b", "user-a"]
    assert asc_ids == ["user-a", "user-b"]


def test_unknown_sort_key_is_422_never_interpolated(pg_conn):
    with pytest.raises(HTTPException) as ei:
        _list(sort="clip_created_count; DROP TABLE users")
    assert ei.value.status_code == 422

    with pytest.raises(HTTPException) as ei2:
        _list(sort="email", sort_dir="sideways")
    assert ei2.value.status_code == 422


def test_segmentless_user_still_lists_and_sorts_nulls_last(pg_conn):
    """T4970 regression: a user with no user_segments row is enumerated and,
    under a descending metric sort, sits at the bottom (NULLS LAST), never lost."""
    create_user("user-a", email="a@test.local")
    create_user_segment("user-a", origin="organic", referrer_id=None, signup_method="google")
    _add_action("user-a", "clip_created", 42)
    create_user("user-b", email="b@test.local")  # NO segment row, no actions

    resp = _list(sort="clip_created_count", sort_dir="desc", exclude_test=False, page_size=50)
    ids = [u["user_id"] for u in resp["users"]]
    assert "user-b" in ids, "segment-less user dropped from the sorted list"
    # user-a (42 clips) ranks above user-b (0), and user-b's clip count is 0 not None.
    assert ids.index("user-a") < ids.index("user-b")
    by_id = {u["user_id"]: u for u in resp["users"]}
    assert by_id["user-b"]["clip_created_count"] == 0
    assert by_id["user-b"]["origin"] is None


def test_last_step_sorts_by_funnel_progression_not_alphabetical(pg_conn):
    """"Shared" is further in FUNNEL_STEPS than "Session" though it sorts BEFORE
    it alphabetically — the rank-based sort must order by funnel progression."""
    create_user("user-a", email="a@test.local")
    create_user_segment("user-a", origin="organic", referrer_id=None, signup_method="google")
    _add_action("user-a", "session_started", 1)  # last_step = "Session" (rank 1)

    create_user("user-b", email="b@test.local")
    create_user_segment("user-b", origin="organic", referrer_id=None, signup_method="google")
    _add_action("user-b", "session_started", 1)
    _add_action("user-b", "share_completed", 1)   # last_step = "Shared" (late rank)

    resp = _list(sort="last_step", sort_dir="desc", exclude_test=False, page_size=50)
    ids = [u["user_id"] for u in resp["users"] if u["user_id"] in {"user-a", "user-b"}]
    assert ids[0] == "user-b", "user further in the funnel must rank first on last_step desc"
    by_id = {u["user_id"]: u for u in resp["users"]}
    assert by_id["user-b"]["last_step"] == "Shared"
    assert by_id["user-a"]["last_step"] == "Session"


# ---------------------------------------------------------------------------
# Part 1 + 3 — exclude_test in the list, the funnel totals, and analytics
# ---------------------------------------------------------------------------

def test_exclude_test_hides_flagged_user_in_list_and_funnel(pg_conn):
    create_user("user-a", email="a@test.local")
    create_user_segment("user-a", origin="organic", referrer_id=None, signup_method="google")
    _add_action("user-a", "export_completed", 1)

    create_user("user-b", email="b@test.local")
    create_user_segment("user-b", origin="organic", referrer_id=None, signup_method="google")
    _add_action("user-b", "export_completed", 1)
    _mark_test("user-b", True)

    on = _list(exclude_test=True, page_size=50)
    on_ids = {u["user_id"] for u in on["users"]}
    assert "user-a" in on_ids
    assert "user-b" not in on_ids, "flagged test account leaked into the Real view"

    off = _list(exclude_test=False, page_size=50)
    off_by_id = {u["user_id"]: u for u in off["users"]}
    assert "user-b" in off_by_id
    assert off_by_id["user-b"]["is_test_account"] is True, "badge flag missing from row"
    assert off_by_id["user-a"]["is_test_account"] is False

    # Funnel totals honor the exclusion: only the real user's export counts.
    assert on["funnel_totals"]["exported"] == 1
    assert off["funnel_totals"]["exported"] == 2


def test_exclude_test_applies_to_platforms_aggregate(pg_conn):
    create_user("user-a", email="a@test.local")
    _add_action("user-a", "export_completed", 3, platform="web")
    create_user("user-b", email="b@test.local")
    _add_action("user-b", "export_completed", 7, platform="web")
    _mark_test("user-b", True)

    with patch.object(admin, "_require_admin", return_value=None):
        excluded = admin.analytics_platforms(action="export_completed", exclude_test=True)
        included = admin.analytics_platforms(action="export_completed", exclude_test=False)

    def _web_users(resp):
        return next((p["users"] for p in resp["platforms"] if p["platform"] == "web"), 0)

    def _web_actions(resp):
        return next((p["actions"] for p in resp["platforms"] if p["platform"] == "web"), 0)

    # With exclusion the test account's 7 actions and its user drop out.
    assert _web_users(included) - _web_users(excluded) == 1
    assert _web_actions(included) - _web_actions(excluded) == 7


# ---------------------------------------------------------------------------
# Part 1 — the mark/unmark endpoint
# ---------------------------------------------------------------------------

def test_mark_and_unmark_test_account_endpoint(pg_conn):
    create_user("user-a", email="a@test.local")
    create_user_segment("user-a", origin="organic", referrer_id=None, signup_method="google")

    with patch.object(admin, "_require_admin", return_value=None), \
         patch.object(admin, "get_current_user_id", return_value="admin-user"):
        res = admin.admin_mark_test_account("user-a", admin.TestAccountRequest(is_test=True))
        assert res == {"user_id": "user-a", "is_test_account": True}

    # Flag persisted -> excluded from the Real view.
    assert "user-a" not in {u["user_id"] for u in _list(exclude_test=True, page_size=50)["users"]}

    with patch.object(admin, "_require_admin", return_value=None), \
         patch.object(admin, "get_current_user_id", return_value="admin-user"):
        admin.admin_mark_test_account("user-a", admin.TestAccountRequest(is_test=False))

    assert "user-a" in {u["user_id"] for u in _list(exclude_test=True, page_size=50)["users"]}


def test_mark_test_account_unknown_user_is_404(pg_conn):
    with patch.object(admin, "_require_admin", return_value=None), \
         patch.object(admin, "get_current_user_id", return_value="admin-user"), \
         pytest.raises(HTTPException) as ei:
        admin.admin_mark_test_account("user-c", admin.TestAccountRequest(is_test=True))
    assert ei.value.status_code == 404
