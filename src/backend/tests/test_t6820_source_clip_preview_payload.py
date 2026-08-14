"""
T6820 — the projects-list payload carries the first clip's source-window offsets
and a streamable working-clip id, so a Not-Started draft's hover preview can stream
the bounded source-clip proxy and seek into the clip window.

Pins three things the frontend depends on (see DraftTile.jsx / TilePreviewVideo.jsx):
  (a) clips[0].stream_clip_id is the WORKING clip id (working_clips.id), NOT this
      row's `id` (a raw_clips.id) — the bounded endpoint keys on wc.id.
  (b) source_start_time / source_end_time are the clip's per-sequence seconds
      offsets, exposed AS-STORED (rc.start_time/rc.end_time) — no re-derivation,
      so multi-video clips seek into the correct sequence coordinate (T1440).
  (c) the trio is populated only on the FIRST clip (payload discipline).
"""

import uuid

from fastapi.testclient import TestClient

from app.database import get_db_connection
from app.main import app
from app.profile_context import set_current_profile_id
from app.session_init import _init_cache
from app.user_context import set_current_user_id

TEST_PROFILE_ID = "testdefault"


def _new_user():
    uid = f"test_t6820_{uuid.uuid4().hex[:8]}"
    _init_cache[uid] = {"profile_id": TEST_PROFILE_ID, "is_new_user": False}
    return uid


def _ctx(uid):
    set_current_user_id(uid)
    set_current_profile_id(TEST_PROFILE_ID)


def _fetch_project(client, project_id):
    resp = client.get("/api/projects")
    assert resp.status_code == 200, resp.text
    for p in resp.json():
        if p["id"] == project_id:
            return p
    raise AssertionError(f"project {project_id} not in /api/projects payload")


def test_first_clip_carries_stream_id_and_source_window():
    """A Not-Started auto-draft exposes stream_clip_id (=working_clips.id) plus the
    clip's source-window offsets on clips[0]."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('Src Draft', '9:16', 1)"
        )
        project_id = cur.lastrowid
        # Insert a throwaway raw_clip FIRST so the real clip's raw id (2) differs from
        # the working_clips id (1) — this is what proves stream_clip_id is the working
        # id, not the raw id, when they would otherwise collide in a fresh DB.
        cur.execute("INSERT INTO raw_clips (filename, rating, name) VALUES ('', 3, 'decoy')")
        cur.execute(
            """INSERT INTO raw_clips (filename, rating, name, start_time, end_time, auto_project_id)
               VALUES ('', 5, 'Brilliant Goal', 12.5, 20.0, ?)""",
            (project_id,),
        )
        raw_clip_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) VALUES (?, ?, 0, 1)",
            (project_id, raw_clip_id),
        )
        working_clip_id = cur.lastrowid
        conn.commit()

    assert working_clip_id != raw_clip_id, "seed must make ids distinct to prove the source"

    _ctx(uid)
    project = _fetch_project(client, project_id)
    first = project["clips"][0]

    assert first["stream_clip_id"] == working_clip_id, (
        "stream_clip_id must be the working_clips.id the bounded endpoint keys on"
    )
    assert first["stream_clip_id"] != raw_clip_id, "must NOT be the raw_clips.id"
    assert first["source_start_time"] == 12.5
    assert first["source_end_time"] == 20.0


def test_offsets_are_per_sequence_as_stored_for_multi_video_clips():
    """Multi-video clip: start/end are stored relative to the clip's own game_video
    sequence (T1440). The payload exposes them verbatim — no re-derivation — so the
    frontend seek lands in the right sequence's timeline."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO games (name, blake3_hash, video_duration, video_size)
               VALUES ('Game', 'g-hash', 90.0, 100000)"""
        )
        game_id = cur.lastrowid
        # Two sequences; the clip lives in sequence 2 with sequence-relative offsets.
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, video_size) VALUES (?, 's1', 1, 60.0, 60000)",
            (game_id,),
        )
        cur.execute(
            "INSERT INTO game_videos (game_id, blake3_hash, sequence, duration, video_size) VALUES (?, 's2', 2, 90.0, 100000)",
            (game_id,),
        )
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio, is_auto_created) VALUES ('Seq2 Draft', '9:16', 1)"
        )
        project_id = cur.lastrowid
        cur.execute(
            """INSERT INTO raw_clips (filename, rating, name, start_time, end_time, game_id, video_sequence, auto_project_id)
               VALUES ('', 5, 'Seq2 Goal', 8.0, 14.0, ?, 2, ?)""",
            (game_id, project_id),
        )
        raw_clip_id = cur.lastrowid
        cur.execute(
            "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) VALUES (?, ?, 0, 1)",
            (project_id, raw_clip_id),
        )
        conn.commit()

    _ctx(uid)
    project = _fetch_project(client, project_id)
    first = project["clips"][0]
    # Exposed verbatim as the sequence-2-relative seconds, matching how
    # stream_working_clip_bounded consumes rc.start_time/rc.end_time.
    assert first["source_start_time"] == 8.0
    assert first["source_end_time"] == 14.0


def test_only_first_clip_carries_the_window():
    """Payload discipline: the trio rides only clips[0]; later clips stay bare."""
    uid = _new_user()
    client = TestClient(app, headers={"X-User-ID": uid})
    _ctx(uid)
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO projects (name, aspect_ratio) VALUES ('Multi', '9:16')"
        )
        project_id = cur.lastrowid
        for i, (start, end) in enumerate([(1.0, 5.0), (10.0, 15.0)]):
            cur.execute(
                "INSERT INTO raw_clips (filename, rating, name, start_time, end_time) VALUES ('', 3, ?, ?, ?)",
                (f"clip{i}", start, end),
            )
            rc_id = cur.lastrowid
            cur.execute(
                "INSERT INTO working_clips (project_id, raw_clip_id, sort_order, version) VALUES (?, ?, ?, 1)",
                (project_id, rc_id, i),
            )
        conn.commit()

    _ctx(uid)
    project = _fetch_project(client, project_id)
    clips = project["clips"]
    assert len(clips) == 2
    assert clips[0]["stream_clip_id"] is not None
    assert clips[0]["source_start_time"] == 1.0
    assert clips[1]["stream_clip_id"] is None
    assert clips[1]["source_start_time"] is None
    assert clips[1]["source_end_time"] is None
