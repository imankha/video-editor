"""GET /overlay-data on a published reel whose working_clips were pruned.

T5225 added per-clip cut-points to /overlay-data; T11260 removed them
(single-clip editor: text snaps to the start and end only). What survives is
T5225's O2 binding: publish prunes working_clips, and /overlay-data must still
answer 200 for that reel -- never 500.

DB fixture mirrors test_t5090_slowmo_poster.py's `db` fixture (tmp_path +
patched USER_DATA_BASE).
"""

import sqlite3
from unittest.mock import patch

import pytest

USER_ID = "test-user-t5225-boundaries"
PROFILE_ID = "t5225prof"


@pytest.fixture()
def db(tmp_path):
    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id(USER_ID)
    set_current_profile_id(PROFILE_ID)
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        yield get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


class TestOverlayDataPrunedWorkingClips:
    """End-to-end: GET /overlay-data on a published reel whose working clips were pruned."""

    @pytest.fixture(autouse=True)
    def _client(self, db):
        from fastapi.testclient import TestClient

        from app.main import app
        from app.session_init import _init_cache

        # Use the SAME user id the `db` fixture computed `get_database_path()`
        # under (USER_ID). The test seeds via a raw sqlite3 connection straight
        # to that path, so the HTTP request must resolve to the IDENTICAL
        # (user_id, profile_id) pair or it opens a separate, empty profile.sqlite.
        self.test_user_id = USER_ID
        _init_cache[self.test_user_id] = {"profile_id": PROFILE_ID, "is_new_user": False}
        self.client = TestClient(app, headers={"X-User-ID": self.test_user_id})
        self.db_path = db

    def test_published_reel_with_pruned_working_clips_never_500(self):
        """BINDING per O2: publish prunes working_clips; /overlay-data must still
        200 -- never 500. Simulates the prune by
        creating a project + working_video with NO working_clips rows at all
        (the live-reconstruction path used by read_clip_segments_for_project
        returns [] for a project with no resolvable working clips, same as the
        existing first_slowmo_section fallback, design SS2.1)."""
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(self.test_user_id)
        set_current_profile_id(PROFILE_ID)
        conn = _connect(self.db_path)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('T5225 pruned', '9:16')"
        )
        pid = cur.lastrowid
        cur.execute(
            "INSERT INTO working_videos (project_id, filename, version) VALUES (?, 'wv.mp4', 1)",
            (pid,),
        )
        cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (cur.lastrowid, pid))
        # Deliberately NO working_clips rows inserted (publish-time prune).
        conn.commit()
        conn.close()

        resp = self.client.get(f"/api/export/projects/{pid}/overlay-data")
        assert resp.status_code == 200, resp.text
