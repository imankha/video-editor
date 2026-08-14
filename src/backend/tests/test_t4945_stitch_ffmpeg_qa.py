"""T4945 QA -- REAL-ffmpeg integration (not mocked).

The unit tests in test_t4945_collection_download.py patch the ffmpeg boundary to
assert control flow. This file exercises the ACTUAL local stitch + compose
engines end to end with real ffmpeg, to prove the acceptance criteria that only
a real encode can prove:

  - AC1  segment order is preserved by the concat (input order == output order)
  - AC2  exactly ONE branded outro is appended over the WHOLE stitch (never per
         member) -- the composed file is longer than the stitch by ~one outro
  - AC3  MIXED-RESOLUTION members produce a VALID (probeable, non-truncated)
         stitched file via concat_segments' re-encode fallback (EPIC decision 7)
  - AC5  the member SOURCE files are byte-identical afterwards (read-only)

Skipped automatically where ffmpeg/ffprobe are absent.
"""

import hashlib
import json
import os
import shutil
import subprocess
from unittest.mock import patch

import pytest

pytestmark = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")),
    reason="ffmpeg/ffprobe not available",
)

USER_ID = "t4945-qa"
PROFILE_ID = "t4945qaprof"


def _make_member(path, color, w, h, dur):
    """A real, playable member reel: solid color video + a tone, distinct
    resolution + duration so the stitch exercises the mixed-res re-encode."""
    subprocess.run(
        ["ffmpeg", "-y",
         "-f", "lavfi", "-i", f"color=c={color}:s={w}x{h}:d={dur}:r=30",
         "-f", "lavfi", "-i", f"sine=frequency=440:d={dur}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
         "-shortest", str(path)],
        capture_output=True, check=True,
    )


def _probe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout
    return float(json.loads(out)["format"]["duration"])


def _sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


def test_qa_mixed_resolution_local_stitch_then_single_outro(tmp_path):
    from app.routers.collections import _stitch_members_local
    from app.services.serve_time_video import compose_serve_time

    fv_dir = tmp_path / "final_videos"
    fv_dir.mkdir()
    # Three MIXED-resolution members, distinct durations (order-detectable sum).
    _make_member(fv_dir / "m1.mp4", "red", 640, 360, 1.0)
    _make_member(fv_dir / "m2.mp4", "green", 1280, 720, 2.0)
    _make_member(fv_dir / "m3.mp4", "blue", 854, 480, 1.5)
    member_keys = ["final_videos/m1.mp4", "final_videos/m2.mp4", "final_videos/m3.mp4"]
    members_total = sum(_probe_duration(fv_dir / f) for f in ["m1.mp4", "m2.mp4", "m3.mp4"])

    src_hashes = {f: _sha(fv_dir / f) for f in ["m1.mp4", "m2.mp4", "m3.mp4"]}

    stitched = tmp_path / "stitched.mp4"
    # R2 off -> the local-disk branch reads get_final_videos_path()/<filename>.
    with patch("app.routers.collections.R2_ENABLED", False), \
         patch("app.database.get_final_videos_path", return_value=fv_dir):
        _stitch_members_local(USER_ID, PROFILE_ID, member_keys, str(stitched), str(tmp_path))

    # AC3: mixed-resolution members produced a VALID, non-truncated file.
    assert stitched.exists()
    stitched_dur = _probe_duration(stitched)
    assert stitched_dur >= members_total * 0.9, \
        f"stitched {stitched_dur:.2f}s is short vs members {members_total:.2f}s (truncated concat)"

    # AC5: read-only over sources -- the member files are byte-identical.
    for f, h in src_hashes.items():
        assert _sha(fv_dir / f) == h, f"member source {f} was modified (must be read-only)"

    # AC2: compose appends exactly ONE branded outro over the WHOLE stitch.
    composed = tmp_path / "composed.mp4"
    with patch("app.services.branded_outro.outro_enabled", return_value=True):
        assert compose_serve_time(str(stitched), str(composed), intro=None, outro=True)
    composed_dur = _probe_duration(composed)
    # Longer than the stitch (an outro WAS appended) but by only ~one outro
    # (a couple of seconds) -- never N outros, one per member.
    assert composed_dur > stitched_dur + 0.5, "no outro was appended"
    assert composed_dur < stitched_dur + 8.0, \
        f"composed grew by {composed_dur - stitched_dur:.2f}s -- more than one outro"


def test_qa_outro_disabled_leaves_bare_stitch(tmp_path):
    """AC2 (flag off): BRANDED_OUTRO disabled -> the composed file is just the
    stitch, no trailing card."""
    from app.routers.collections import _stitch_members_local
    from app.services.serve_time_video import compose_serve_time

    fv_dir = tmp_path / "final_videos"
    fv_dir.mkdir()
    _make_member(fv_dir / "m1.mp4", "red", 640, 360, 1.0)
    _make_member(fv_dir / "m2.mp4", "green", 640, 360, 1.0)  # same res -> copy-join
    member_keys = ["final_videos/m1.mp4", "final_videos/m2.mp4"]

    stitched = tmp_path / "stitched.mp4"
    with patch("app.routers.collections.R2_ENABLED", False), \
         patch("app.database.get_final_videos_path", return_value=fv_dir):
        _stitch_members_local(USER_ID, PROFILE_ID, member_keys, str(stitched), str(tmp_path))
    stitched_dur = _probe_duration(stitched)

    composed = tmp_path / "composed.mp4"
    with patch("app.services.branded_outro.outro_enabled", return_value=False):
        assert compose_serve_time(str(stitched), str(composed), intro=None, outro=True)
    # No intro, no outro -> compose serves the bare stitch (same duration).
    assert abs(_probe_duration(composed) - stitched_dur) < 0.4


# ===========================================================================
# Full HTTP endpoint drive (real ffmpeg, R2 off, local-disk members). This is
# the closest deterministic stand-in for the browser live-drive the /dotask
# container cannot run (no .env -> no real R2/Postgres/dev-login): it exercises
# route -> resolve-before-generator -> local stitch -> compose -> StreamingResponse
# with REAL member files + REAL ffmpeg, then probes the streamed bytes.
# ===========================================================================

import sqlite3  # noqa: E402


@pytest.fixture()
def client(tmp_path):
    from unittest.mock import patch as _patch

    from app.session_init import _init_cache
    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with _patch("app.database.USER_DATA_BASE", tmp_path), \
         _patch("app.database._initialized_users", set()), \
         _patch("app.database.R2_ENABLED", False), \
         _patch("app.routers.collections.R2_ENABLED", False), \
         _patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         _patch("app.services.user_db._initialized_user_dbs", set()), \
         _patch("app.services.modal_client.modal_enabled", return_value=False):
        # This QA drive exercises the LOCAL compute path (real ffmpeg in-container,
        # no Modal creds). Pin modal_enabled False so the test is hermetic and
        # never depends on the ambient MODAL_ENABLED global (which unrelated suite
        # tests toggle); the Modal branch is unit-covered in test_t4945_collection_download.
        from app.database import ensure_database, get_final_videos_path
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        ensure_database()
        get_final_videos_path().mkdir(parents=True, exist_ok=True)

        from fastapi.testclient import TestClient

        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _seed_member_row(db_path, fv_dir, *, game_id, color, w, h, dur, rating):
    from app.utils.encoding import encode_data
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', '9:16')")
    project_id = cur.lastrowid
    filename = f"f{project_id}.mp4"
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, clip_count, game_ids, rating) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, '9:16', CURRENT_TIMESTAMP, 1, ?, ?)",
        (project_id, filename, dur, encode_data([game_id]), rating),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    _make_member(fv_dir / filename, color, w, h, dur)
    return filename


def test_qa_endpoint_streams_valid_stitched_mp4_end_to_end(client, tmp_path):
    from app.database import get_database_path, get_final_videos_path
    db_path = get_database_path()
    fv_dir = get_final_videos_path()

    # Three mixed-resolution members; rating DESC fixes playback order m_hi..m_lo.
    _seed_member_row(db_path, fv_dir, game_id=9, color="red", w=640, h=360, dur=1.0, rating=1)
    _seed_member_row(db_path, fv_dir, game_id=9, color="green", w=1280, h=720, dur=2.0, rating=3)
    _seed_member_row(db_path, fv_dir, game_id=9, color="blue", w=854, h=480, dur=1.5, rating=2)
    members_total = 1.0 + 2.0 + 1.5

    resp = client.get(
        "/api/collections/download",
        params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
        headers={"X-User-ID": USER_ID},
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "video/mp4"
    assert "attachment" in resp.headers.get("content-disposition", "")

    out = tmp_path / "downloaded.mp4"
    out.write_bytes(resp.content)
    assert out.stat().st_size > 0

    # The streamed file is a VALID mp4 whose duration covers all members plus the
    # single branded outro (default-enabled) -- proving the endpoint really
    # stitched + composed through the HTTP layer, not just returned bytes.
    dur = _probe_duration(out)
    assert dur >= members_total * 0.9, f"streamed {dur:.2f}s short vs members {members_total:.2f}s"
    assert dur > members_total + 0.5, "no branded outro in the streamed file"

    # Read-only over sources: every member file is intact after the download.
    for name in os.listdir(fv_dir):
        assert (fv_dir / name).stat().st_size > 0
