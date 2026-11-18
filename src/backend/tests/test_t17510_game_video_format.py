"""T17510: record each game video's format.

C1: probe_r2_video returns codec, pixel format and color transfer (real ffprobe on
    an HEVC 10-bit HLG fixture and an H.264 fixture).
C2: activating a game records its format ONCE (pending->ready flip), as a
    `capability_impression:game_format_*` row in the in-house `user_actions`
    aggregate -- the same storage and vocabulary as the client's shrink_decode
    census beacons (families avc/hevc8/hevc10, buckets le1080/le4k/gt4k).
C3: GET /api/admin/analytics/game-formats reports the format mix and the share of
    HEVC census probes whose browser could not decode them.
"""
import shutil
import subprocess
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

needs_ffmpeg = pytest.mark.skipif(
    not (shutil.which("ffmpeg") and shutil.which("ffprobe")), reason="needs ffmpeg"
)


def _make(path: Path, vcodec_args: list[str]) -> Path:
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error",
         "-f", "lavfi", "-i", "testsrc=size=160x90:rate=30:duration=1",
         "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         *vcodec_args, "-c:a", "aac", str(path)],
        check=True,
    )
    return path


class _LocalPresigner:
    """Stands in for the R2 client: the presigned 'URL' is the local file path."""

    def __init__(self, path: Path):
        self.path = path

    def generate_presigned_url(self, *_a, **_k):
        return str(self.path)


# --- C1 ----------------------------------------------------------------------

@needs_ffmpeg
def test_probe_r2_video_reads_hevc_10bit_hlg_format(tmp_path):
    from app.services.video_probe import probe_r2_video

    src = _make(tmp_path / "hevc.mp4", [
        "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p10le",
        # HLG tagged in the HEVC bitstream (VUI), the way an iPhone writes it.
        "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
        "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
    ])
    info = probe_r2_video(_LocalPresigner(src), "bucket", "games/x.mp4")
    assert info["codec"] == "hevc"
    assert info["pix_fmt"] == "yuv420p10le"
    assert info["color_transfer"] == "arib-std-b67"
    assert (info["width"], info["height"]) == (160, 90)


@needs_ffmpeg
def test_probe_r2_video_reads_h264_format(tmp_path):
    from app.services.video_probe import probe_r2_video

    src = _make(tmp_path / "avc.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    info = probe_r2_video(_LocalPresigner(src), "bucket", "games/y.mp4")
    assert info["codec"] == "h264"
    assert info["pix_fmt"] == "yuv420p"
    # An untagged SDR file has no color transfer in ffprobe's output.
    assert info["color_transfer"] is None


# --- C2 ----------------------------------------------------------------------

HEVC_META = {"duration": 60.0, "fps": 30.0, "width": 3840, "height": 2160,
             "codec": "hevc", "pix_fmt": "yuv420p10le", "color_transfer": "arib-std-b67"}
H264_META = {"duration": 60.0, "fps": 30.0, "width": 1920, "height": 1080,
             "codec": "h264", "pix_fmt": "yuv420p", "color_transfer": None}


def _format_counts(user_id):
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT action, SUM(count) AS n FROM user_actions "
            "WHERE user_id = %s AND action LIKE 'capability_impression:game_format_%%' "
            "GROUP BY action",
            (user_id,),
        )
        return {r["action"]: r["n"] for r in cur.fetchall()}


@pytest.mark.parametrize("meta,expected", [
    (H264_META, "capability_impression:game_format_avc_sdr_le1080"),
    (HEVC_META, "capability_impression:game_format_hevc10_hlg_le4k"),
])
def test_activate_records_game_format_once(pg_conn, tmp_path, monkeypatch, meta, expected):
    import app.routers.games as games
    from app.constants import GameStatus
    from app.database import get_db_connection
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id

    user_id = f"test_t17510_{uuid.uuid4().hex[:8]}"
    _init_cache[user_id] = {"profile_id": "testdefault", "is_new_user": False}
    monkeypatch.setattr(games, "_validate_video_in_r2", lambda *a, **k: None)
    monkeypatch.setattr(games, "_probe_video_metadata", lambda *a, **k: dict(meta))
    monkeypatch.setattr(games, "insert_game_storage_ref", lambda *a, **k: None)
    monkeypatch.setattr(games, "calculate_upload_cost", lambda *a, **k: 1)
    monkeypatch.setattr(games, "deduct_credits", lambda *a, **k: {"success": True, "balance": 100})
    monkeypatch.setattr(games, "_maybe_send_game_ready_email", lambda *a, **k: None)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        set_current_user_id(user_id)
        set_current_profile_id("testdefault")
        with get_db_connection() as conn:
            cur = conn.cursor()
            cur.execute("INSERT INTO games (name, status) VALUES ('T17510', ?)", (GameStatus.PENDING,))
            game_id = cur.lastrowid
            cur.execute(
                "INSERT INTO game_videos (game_id, blake3_hash, sequence, video_size, fps) "
                "VALUES (?, 'h1t17510', 1, 1000, NULL)",
                (game_id,),
            )
            conn.commit()

        from app.main import app
        client = TestClient(app, headers={"X-User-ID": user_id})
        assert client.post(f"/api/games/{game_id}/activate").status_code == 200
        # A repeat activation (already ready) must not count the game again.
        assert client.post(f"/api/games/{game_id}/activate").status_code == 200

    try:
        assert _format_counts(user_id) == {expected: 1}
    finally:
        from app.services.pg import get_pg
        with get_pg() as conn:
            conn.cursor().execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))


# --- C3 ----------------------------------------------------------------------

ADMIN = "t17510-admin"


@pytest.fixture()
def admin_client(pg_conn, tmp_path, monkeypatch):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    _cleanup_users()
    create_user(ADMIN, email="t17510-admin@test.local")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO admin_users (email) VALUES ('t17510-admin@test.local') ON CONFLICT DO NOTHING")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)
    _cleanup_users()


def _cleanup_users():
    from app.services.pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM user_actions WHERE user_id LIKE 't17510-%%'")
        cur.execute("DELETE FROM users WHERE user_id LIKE 't17510-%%'")


def _actions(user_id, counts: dict[str, int]):
    from app.services.auth_db import create_user
    from app.services.pg import get_pg

    create_user(user_id, email=f"{user_id}@test.local")
    with get_pg() as conn:
        cur = conn.cursor()
        for action, n in counts.items():
            cur.execute(
                "INSERT INTO user_actions (user_id, action, platform, count) VALUES (%s, %s, 'web', %s)",
                (user_id, f"capability_impression:{action}", n),
            )


def _cleanup_actions():
    from app.services.pg import get_pg
    with get_pg() as conn:
        conn.cursor().execute("DELETE FROM user_actions WHERE user_id LIKE 't17510-u%%'")


def _game_formats(client):
    resp = client.get("/api/admin/analytics/game-formats", headers={"X-User-ID": ADMIN})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _delta(after, before):
    """The DB is shared with the dev stack: compare the seeded delta, not totals."""
    if isinstance(after, dict):
        keys = set(after) | set(before)
        return {k: _delta(after.get(k, 0), before.get(k, 0)) for k in keys
                if _delta(after.get(k, 0), before.get(k, 0)) != 0}
    return after - before


def test_admin_game_formats_reports_mix_and_cannot_decode_share(admin_client):
    _cleanup_actions()
    before = _game_formats(admin_client)
    _actions("t17510-u1", {
        "game_format_hevc10_hlg_le4k": 3,
        "game_format_avc_sdr_le1080": 1,
        "shrink_decode_no_hevc10_le4k": 2,
        "shrink_decode_yes_hevc10_le4k": 1,
        "shrink_decode_yes_avc_le1080": 5,
    })
    _actions("t17510-u2", {
        "game_format_hevc8_sdr_le1080": 1,
        "game_format_hevc10_pq_le4k": 1,
        "shrink_decode_unavailable_hevc8_le1080": 1,
    })
    try:
        after = _game_formats(admin_client)
    finally:
        _cleanup_actions()

    assert after["games"] - before["games"] == 6
    assert after["hevc_games"] - before["hevc_games"] == 5
    assert after["hdr_games"] - before["hdr_games"] == 4
    assert _delta(after["by_res"], before["by_res"]) == {"le4k": 4, "le1080": 2}

    def mix(body):
        return {f"{f['family']}_{f['transfer']}_{f['res']}": f["games"] for f in body["formats"]}
    assert _delta(mix(after), mix(before)) == {
        "hevc10_hlg_le4k": 3, "avc_sdr_le1080": 1, "hevc8_sdr_le1080": 1, "hevc10_pq_le4k": 1,
    }
    # HEVC census probes only (the avc probes are not counted): 1 yes, 2 no, 1 unavailable.
    assert _delta(after["hevc_decode"], before["hevc_decode"]) == {"yes": 1, "no": 2, "unavailable": 1}
    if before["hevc_decode"] == {"yes": 0, "no": 0, "unavailable": 0}:
        # Share of HEVC probes with a known answer that said no ("unavailable" =
        # no WebCodecs, so the browser's ability is unknown, reported apart).
        assert after["hevc_cannot_decode_share"] == pytest.approx(2 / 3)
