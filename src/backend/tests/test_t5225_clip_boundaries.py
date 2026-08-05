"""T5225: `clip_boundaries` on GET /overlay-data (design SS0.2 / SS2).

FAILING BY DESIGN: `/overlay-data`'s response dict (overlay.py:1852-1870) has no
`clip_boundaries` key yet, and `app/services/poster.py` has no
`clip_boundary_offsets` helper. These tests pin the intended contract:

- single-clip project -> clip_boundaries == [] (no interior cut-points)
- multi-clip project -> cumulative cut-points on the concatenated timeline
- a published reel whose working_clips were pruned (publish prunes them) ->
  degrades to [] (O2's BINDING resolution: never 500)

DB fixture mirrors test_t5090_slowmo_poster.py's `db` fixture (tmp_path +
patched USER_DATA_BASE), and clip-seeding mirrors its `_seed_slowmo_project` /
`_seed_full_project` helpers.
"""

import sqlite3
from unittest.mock import patch

import pytest

from app.utils.encoding import encode_data

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


def _seed_project_with_working_video(db_path, clip_segments: list[dict], duration: float | None = None):
    """clip_segments: list of segments_data dicts, one per working clip, in
    concatenation order (sort_order 0..N-1). Mirrors test_t5090_slowmo_poster.py's
    _seed_full_project but supports multiple clips."""
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T5225 CB', '9:16')")
    pid = cur.lastrowid
    cur.execute(
        "INSERT INTO working_videos (project_id, filename, version, duration) VALUES (?, 'wv.mp4', 1, ?)",
        (pid, duration),
    )
    wv_id = cur.lastrowid
    cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (wv_id, pid))

    for i, segments in enumerate(clip_segments):
        # source_duration derived from raw_clips (end_time - start_time), matching
        # read_clip_segments_for_project's join (poster.py:345).
        src_end = segments["boundaries"][-1]
        cur.execute(
            "INSERT INTO raw_clips (filename, rating, start_time, end_time) VALUES (?, 5, 0.0, ?)",
            (f"clip{i}.mp4", src_end),
        )
        rc = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order, segments_data) "
            "VALUES (?, ?, 1, ?, ?)",
            (pid, rc, i, encode_data(segments)),
        )
    conn.commit()
    conn.close()
    return pid


class TestClipBoundaryOffsetsHelper:
    """Unit coverage of the intended `poster.clip_boundary_offsets(project_id)`
    helper (design SS2.1) -- reuses the SAME per-clip output-duration walk
    `first_slowmo_section` already does, per O2's binding "do not write a second
    walk" resolution."""

    def test_single_clip_has_no_interior_boundaries(self, db):
        from app.services import poster

        segments = {"boundaries": [0, 6], "segmentSpeeds": {}}
        pid = _seed_project_with_working_video(db, [segments])

        assert poster.clip_boundary_offsets(pid) == []

    def test_multi_clip_returns_cumulative_cutpoints(self, db):
        from app.services import poster

        # clip0: 4.10s output (no speed change). clip1: 5.45s output. clip2: 2.45s output.
        # Interior cut-points: [4.10, 9.55]; the trivial 0.0 and final total (12.00)
        # are excluded -- the client adds those itself (design SS2.2).
        clip0 = {"boundaries": [0, 4.10], "segmentSpeeds": {}}
        clip1 = {"boundaries": [0, 5.45], "segmentSpeeds": {}}
        clip2 = {"boundaries": [0, 2.45], "segmentSpeeds": {}}
        pid = _seed_project_with_working_video(db, [clip0, clip1, clip2])

        boundaries = poster.clip_boundary_offsets(pid)
        assert boundaries == pytest.approx([4.10, 9.55])

    def test_multi_clip_with_slowmo_uses_output_duration_not_source_duration(self, db):
        from app.services import poster

        # clip0: source 0-2s @1.0x (2s out), 2-4s @0.5x (4s out) -> 6s total output.
        # clip1: source 0-3s @1.0x -> 3s output.
        clip0 = {"boundaries": [0, 2, 4], "segmentSpeeds": {"1": 0.5}}
        clip1 = {"boundaries": [0, 3], "segmentSpeeds": {}}
        pid = _seed_project_with_working_video(db, [clip0, clip1])

        boundaries = poster.clip_boundary_offsets(pid)
        assert boundaries == pytest.approx([6.0])

    def test_leading_unknown_duration_bails_to_empty(self, db):
        """Mirrors first_slowmo_section's guard (poster.py:271-279): a leading
        clip with unresolvable output length must not fabricate an offset for
        the clips after it -> bail to []."""
        from app.services import poster

        conn = _connect(db)
        cur = conn.cursor()
        cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('T5225 CB unknown', '9:16')")
        pid = cur.lastrowid
        cur.execute(
            "INSERT INTO working_videos (project_id, filename, version) VALUES (?, 'wv.mp4', 1)",
            (pid,),
        )
        cur.execute("UPDATE projects SET working_video_id = ? WHERE id = ?", (cur.lastrowid, pid))
        # Leading clip: no raw_clips row backing it (no segments_data, no source
        # duration) -> (None, None) in read_clip_segments_for_project's walk.
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, version, sort_order) VALUES (?, NULL, 1, 0)",
            (pid,),
        )
        conn.commit()
        conn.close()

        assert poster.clip_boundary_offsets(pid) == []

    def test_no_project_id_returns_empty(self, db):
        from app.services import poster

        assert poster.clip_boundary_offsets(None) == []
        assert poster.clip_boundary_offsets(999999) == []


class TestClipBoundariesOnOverlayData:
    """End-to-end: GET /overlay-data must surface `clip_boundaries` (design SS2.2)."""

    @pytest.fixture(autouse=True)
    def _client(self, db):
        from fastapi.testclient import TestClient

        from app.main import app
        from app.session_init import _init_cache

        # Use the SAME user id the `db` fixture computed `get_database_path()`
        # under (USER_ID). `_seed_project_with_working_video` writes via a raw
        # sqlite3 connection straight to that path, bypassing context-var
        # resolution entirely -- so the HTTP request must resolve to the
        # IDENTICAL (user_id, profile_id) pair, or it opens a separate, empty
        # profile.sqlite (get_user_data_path is keyed by both). A per-test
        # random user id here silently reads an empty DB and would always
        # return `[]`, masking real bugs (single-clip/pruned cases legitimately
        # expect `[]` too, so only the multi-clip assertion would ever catch it).
        self.test_user_id = USER_ID
        _init_cache[self.test_user_id] = {"profile_id": PROFILE_ID, "is_new_user": False}
        self.client = TestClient(app, headers={"X-User-ID": self.test_user_id})
        self.db_path = db

    def _seed(self, clip_segments):
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(self.test_user_id)
        set_current_profile_id(PROFILE_ID)
        return _seed_project_with_working_video(self.db_path, clip_segments)

    def test_single_clip_project_returns_empty_clip_boundaries(self):
        pid = self._seed([{"boundaries": [0, 6], "segmentSpeeds": {}}])
        resp = self.client.get(f"/api/export/projects/{pid}/overlay-data")
        assert resp.status_code == 200, resp.text
        assert resp.json()["clip_boundaries"] == []

    def test_multi_clip_project_returns_cumulative_cutpoints(self):
        clip0 = {"boundaries": [0, 4.10], "segmentSpeeds": {}}
        clip1 = {"boundaries": [0, 5.45], "segmentSpeeds": {}}
        clip2 = {"boundaries": [0, 2.45], "segmentSpeeds": {}}
        pid = self._seed([clip0, clip1, clip2])

        resp = self.client.get(f"/api/export/projects/{pid}/overlay-data")
        assert resp.status_code == 200, resp.text
        assert resp.json()["clip_boundaries"] == pytest.approx([4.10, 9.55])

    def test_published_reel_with_pruned_working_clips_degrades_to_empty_never_500(self):
        """BINDING per O2: publish prunes working_clips; /overlay-data must still
        200 with clip_boundaries == [] -- never 500. Simulates the prune by
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
        assert resp.json()["clip_boundaries"] == []
