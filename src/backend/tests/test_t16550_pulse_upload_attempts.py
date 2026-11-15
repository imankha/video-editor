"""T16550: the pulse card's upload success rate divides today's successes by today's
ATTEMPTS, not by successes + failures. An abandoned upload ends with neither outcome,
so the old denominator never saw it and the card read high on exactly the days
uploads went wrong quietly.

Contract pinned here:
  C1. Each game_upload_attempted (booked by prepare_upload) adds one to the user's
      user_usage_daily.game_uploads_attempted for today.
  C2. 3 attempts, 1 success, 1 failure reads 33.33%, on both pulse paths.
  C3. A day the attempts column did not cover (a row from before v049, NULL) or a
      database without the column shows no rate, not a made-up one.

Run with: pytest src/backend/tests/test_t16550_pulse_upload_attempts.py -v
"""
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.analytics import _counter_buffer, create_user_segment, record_milestone
from app.services.auth_db import create_user

# The dev Postgres is shared, so every exact count reads one per-run user through its
# own origin (the per-user path). The unfiltered daily_counters path is global.
USER = f"t16550-{uuid.uuid4().hex[:8]}"
ORIGIN = f"t16550_{uuid.uuid4().hex[:8]}"
PATHS = [f"?origin={ORIGIN}", f"?origin={ORIGIN}&exclude_test=false"]


@pytest.fixture()
def client(pg_conn, tmp_path):
    from app.services.pg import get_pg
    create_user("admin-user", email="test-admin@test.local")
    from tests.conftest import register_test_user_ids
    register_test_user_ids(USER)
    create_user(USER, email=f"{USER}@test.com")
    create_user_segment(USER, ORIGIN, None, "otp")
    _counter_buffer.flush()
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("INSERT INTO admin_users (email) VALUES ('test-admin@test.local') ON CONFLICT DO NOTHING")
        cur.execute(
            "UPDATE daily_counters SET game_uploads_succeeded = 0, game_uploads_failed = 0 "
            "WHERE counter_date = CURRENT_DATE"
        )
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _pulse(client, query):
    resp = client.get(f"/api/admin/analytics/pulse{query}", headers={"X-User-ID": "admin-user"})
    assert resp.status_code == 200
    return resp.json()["cards"]["upload_success_rate"]


def _attempts_today(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT game_uploads_attempted FROM user_usage_daily WHERE user_id = %s AND day = CURRENT_DATE",
            (user_id,),
        )
        row = cur.fetchone()
    return row["game_uploads_attempted"] if row else None


def test_each_upload_start_adds_one_to_todays_attempts(client):
    """C1: record_milestone is the seam prepare_upload books every upload start through."""
    record_milestone(USER, "game_upload_attempted")
    assert _attempts_today(USER) == 1
    record_milestone(USER, "game_upload_attempted")
    assert _attempts_today(USER) == 2


def test_a_clip_upload_start_is_not_a_game_attempt(client):
    record_milestone(USER, "clip_upload_attempted")
    assert not _attempts_today(USER)


@pytest.mark.parametrize("query", PATHS)
def test_rate_is_successes_over_attempts(client, query):
    """C2: one finished, one failed, one abandoned -> 1/3, not 1/2."""
    for _ in range(3):
        record_milestone(USER, "game_upload_attempted")
    record_milestone(USER, "game_upload_succeeded")
    record_milestone(USER, "game_upload_failed", reason="r2_rejected")
    _counter_buffer.flush()
    card = _pulse(client, query)
    assert (card["succeeded"], card["failed"], card["attempts"]) == (1, 1, 3)
    assert card["today"] == 33.33


def test_unfiltered_rate_is_successes_over_attempts(client):
    """C2 on the global daily_counters path: same division, today's attempts from the
    day buckets. A row from before v049 (C3) makes it no rate."""
    from app.services.pg import get_pg
    for _ in range(3):
        record_milestone(USER, "game_upload_attempted")
    record_milestone(USER, "game_upload_succeeded")
    _counter_buffer.flush()
    card = _pulse(client, "?exclude_test=false")
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FILTER (WHERE game_uploads_attempted IS NULL) AS unrecorded "
                    "FROM user_usage_daily WHERE day = CURRENT_DATE")
        unrecorded = cur.fetchone()["unrecorded"]
    if unrecorded:
        assert (card["today"], card["attempts"]) == (None, None)
    else:
        assert card["attempts"] >= 3
        assert card["today"] == round(card["succeeded"] / card["attempts"] * 100, 2)


@pytest.mark.parametrize("query", [*PATHS, "?exclude_test=false"])
def test_a_day_from_before_the_column_shows_no_rate(client, query):
    """C3: a row written before v049 has NULL attempts. Bumping it keeps it NULL, and
    the day it belongs to reads "no rate" rather than successes over a partial count."""
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO user_usage_daily (user_id, day, game_uploads_succeeded, game_uploads_attempted) "
            "VALUES (%s, CURRENT_DATE, 1, NULL)", (USER,)
        )
    record_milestone(USER, "game_upload_attempted")
    assert _attempts_today(USER) is None
    card = _pulse(client, query)
    assert card["today"] is None
    assert card["attempts"] is None


@pytest.mark.parametrize("query", PATHS)
def test_before_the_migration_there_is_no_rate_but_the_alarm_still_works(client, query):
    """C3: without the column there is no attempt count to divide by. The collapse
    alarm reads FINISHED uploads, so a pending migration cannot mute it."""
    for _ in range(8):
        record_milestone(USER, "game_upload_failed", reason="r2_rejected")
    _counter_buffer.flush()
    with patch("app.routers.admin.usage_daily_has_upload_attempts", return_value=False):
        card = _pulse(client, query)
    assert card["today"] is None
    assert card["attempts"] is None
    assert (card["finished"], card["finished_rate"]) == (8, 0.0)
    assert card["alarm"] is True


def test_v049_leaves_existing_rows_unrecorded_and_new_rows_at_zero(client):
    """The migration's whole C3 mechanism: no backfill (old rows NULL), DEFAULT 0 after."""
    from app.migrations.postgres.v049_usage_daily_upload_attempts import V049UsageDailyUploadAttempts
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT column_default, is_nullable FROM information_schema.columns "
                    "WHERE table_schema = current_schema() AND table_name = 'user_usage_daily' "
                    "AND column_name = 'game_uploads_attempted'")
        col = cur.fetchone()
        V049UsageDailyUploadAttempts().up(conn)  # idempotent on a migrated DB
    assert col["column_default"] == "0"
    assert col["is_nullable"] == "YES"
    record_milestone(USER, "game_upload_succeeded")
    assert _attempts_today(USER) == 0
