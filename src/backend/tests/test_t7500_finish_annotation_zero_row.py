"""
T7500: finish-annotation must not report success (or record a milestone) on a
zero-row UPDATE.

`POST /api/games/{id}/finish-annotation` runs an UPDATE ... WHERE id = ?. When
the game no longer exists (cascade-deleted after a failed upload, or deleted
mid-annotate — see T7470), the write matches zero rows. Pre-fix the handler
still returned {"success": true} AND fired record_milestone("annotation_completed"),
manufacturing a false activity trail. The fix: zero-row write -> 404, no
milestone, warning log. The happy path and the viewed_duration==0 branch are
unchanged.
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db_connection
from app.user_context import set_current_user_id
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache

TEST_USER_ID = f"test_t7500_{uuid.uuid4().hex[:8]}"
TEST_PROFILE_ID = "testdefault"

_init_cache[TEST_USER_ID] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}

client = TestClient(app, headers={"X-User-ID": TEST_USER_ID})


@pytest.fixture
def game():
    set_current_user_id(TEST_USER_ID)
    set_current_profile_id(TEST_PROFILE_ID)
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO games (name, blake3_hash, video_filename, video_duration, video_size, video_width, video_height)
            VALUES ('T7500 Game', 't7500hash', 't7500.mp4', 600.0, 1000, 1920, 1080)
        """)
        game_id = cursor.lastrowid
        conn.commit()

        yield game_id

        cursor.execute("DELETE FROM games WHERE id = ?", (game_id,))
        conn.commit()


def _viewed_duration(game_id):
    with get_db_connection() as conn:
        row = conn.cursor().execute(
            "SELECT viewed_duration FROM games WHERE id = ?", (game_id,)
        ).fetchone()
        return row["viewed_duration"] if row else None


class TestZeroRowFinishAnnotation:
    def test_missing_game_returns_404_and_records_no_milestone(self):
        """A finish-annotation against a nonexistent game 404s and fires no milestone."""
        missing_id = 999_000_999
        with patch("app.analytics.record_milestone") as spy:
            r = client.post(
                f"/api/games/{missing_id}/finish-annotation",
                json={"viewed_duration": 120.0},
            )
        assert r.status_code == 404, r.text
        spy.assert_not_called()

    def test_missing_game_with_zero_duration_still_succeeds(self):
        """viewed_duration==0 never writes, so it stays a quiet success even for a
        missing game — there is nothing to guard in that branch."""
        missing_id = 999_000_998
        with patch("app.analytics.record_milestone") as spy:
            r = client.post(
                f"/api/games/{missing_id}/finish-annotation",
                json={"viewed_duration": 0},
            )
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        spy.assert_not_called()


class TestHappyPathUnchanged:
    def test_existing_game_records_milestone_and_persists(self, game):
        with patch("app.analytics.record_milestone") as spy:
            r = client.post(
                f"/api/games/{game}/finish-annotation",
                json={"viewed_duration": 300.0},
            )
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        assert _viewed_duration(game) == pytest.approx(300.0)
        spy.assert_called_once()
        args = spy.call_args.args
        assert args[1] == "annotation_completed"
        assert args[2] == {"game_id": game}

    def test_existing_game_zero_duration_no_milestone(self, game):
        """The no-progress branch: success, no write, no milestone."""
        with patch("app.analytics.record_milestone") as spy:
            r = client.post(
                f"/api/games/{game}/finish-annotation",
                json={"viewed_duration": 0},
            )
        assert r.status_code == 200, r.text
        assert r.json()["success"] is True
        spy.assert_not_called()
