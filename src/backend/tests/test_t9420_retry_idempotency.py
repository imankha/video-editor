"""T9420: game upload fails at ~15% ("Failed to fetch"), succeeds on retry.

The diagnosis (see docs/plans/tasks/T9420-design.md) established the failure is a
transient client-side fetch() reject on the PRE-activation legs (create_game /
prepare-upload), and that retry is already idempotent server-side. These are
regression tests pinning the "retry yields exactly one game" guarantee at the
create_game seam, so a future change can't reintroduce a duplicate-on-retry.

The companion "exactly one charge" guarantee is enforced by deduct_credits'
ON CONFLICT (user_id, idempotency_key) DO NOTHING on key game_upload:{game_id}
(charged ONLY in activate_game, which is downstream of a ~15% failure) and is
covered by tests/test_credit_ledger.py::TestDebit::test_debit_same_key_twice_is_idempotent
and ::test_debit_writes_reference_id.
"""

import sqlite3
import pytest
from unittest.mock import patch

USER_ID = "test-user-t9420"
PROFILE_ID = "testdefault"
HASH = "b" * 64


@pytest.fixture()
def profile_db(tmp_path):
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _game_rows(db_path, h=HASH):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT id, status FROM games WHERE blake3_hash = ?", (h,)
    ).fetchall()
    conn.close()
    return rows


def _make_request(status="pending"):
    from app.routers.games import CreateGameRequest, VideoReference
    return CreateGameRequest(
        opponent_name="Rivals",
        status=status,
        videos=[VideoReference(blake3_hash=HASH, sequence=1, duration=89.0,
                               width=1920, height=1080, file_size=48_000_000)],
    )


@pytest.mark.asyncio
async def test_pending_retry_reuses_same_game(profile_db):
    """A first attempt creates the pending game; a retry after an ambiguous ~15%
    failure re-hashes the SAME file and must resume INTO that game, never spawn a
    second one. One game, one game_id."""
    from app.routers.games import create_game

    first = await create_game(_make_request(status="pending"))
    game_id = first["game_id"]
    assert game_id is not None

    # The retry: identical hash, identical pending create call.
    second = await create_game(_make_request(status="pending"))

    assert second["game_id"] == game_id, "retry must reuse the pending game, not duplicate it"
    rows = _game_rows(profile_db)
    assert len(rows) == 1, f"exactly one game row for the hash, got {len(rows)}: {[dict(r) for r in rows]}"


@pytest.mark.asyncio
async def test_retry_after_upload_failed_resumes_same_game(profile_db):
    """T7490 leaves an 'upload_failed' row as the resume anchor. A retry that
    re-selects the file must resume into it (flipped back to pending), never create
    a duplicate."""
    from app.routers.games import create_game

    first = await create_game(_make_request(status="pending"))
    game_id = first["game_id"]

    # Simulate the honest reap marking the stalled upload as upload_failed.
    conn = sqlite3.connect(str(profile_db))
    conn.execute("UPDATE games SET status = 'upload_failed' WHERE id = ?", (game_id,))
    conn.commit()
    conn.close()

    resumed = await create_game(_make_request(status="pending"))
    assert resumed["game_id"] == game_id
    rows = _game_rows(profile_db)
    assert len(rows) == 1
    assert rows[0]["status"] == "pending", "upload_failed anchor must flip back to pending on resume"
