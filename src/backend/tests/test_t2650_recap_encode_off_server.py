"""T2650: the recap encode runs on Modal, never on the API server.

With Modal on, `_generate_recap` (sweep auto-export, share-link ensure_recap,
hi-q backfill) and `_generate_recap_from_legacy_slice` hand the ffmpeg work to
the CPU Modal function `encode_recap_modal` and only write the clip mapping
themselves. Server-side ffmpeg is patched to fail loudly, so any encode that
still runs on the server fails the test.
"""

import ast
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.utils.encoding import encode_data
from tests.test_auto_export import (  # noqa: F401  (fixture import)
    PROFILE_ID,
    USER_ID,
    _get_game_status,
    _insert_clip,
    _insert_game,
    isolated_profile_db,
)

M = "app.services.auto_export"
BACKEND_ROOT = Path(__file__).resolve().parent.parent


def _server_ffmpeg_forbidden():
    """Patch every ffmpeg entry point the recap path could use on the server."""
    def boom(*a, **k):
        raise AssertionError("server-side ffmpeg encode ran with Modal enabled")
    return [
        patch("ffmpeg.input", side_effect=boom),
        patch("ffmpeg.probe", side_effect=boom),
        patch("subprocess.run", side_effect=boom),
    ]


def _clips(video_hash="abc123"):
    return [
        {"id": 1, "video_hash": video_hash, "start_time": 0.0, "end_time": 5.0,
         "name": "Goal", "rating": 5, "tags": encode_data(["soccer"]), "notes": "Great shot"},
        {"id": 2, "video_hash": video_hash, "start_time": 10.0, "end_time": 15.0,
         "name": "Save", "rating": 4, "tags": None, "notes": None},
    ]


def _run_with_modal(fn, modal_result):
    modal_call = AsyncMock(return_value=modal_result)
    patches = [
        patch("app.services.modal_client.modal_enabled", return_value=True),
        patch("app.services.modal_client.call_modal_encode_recap", modal_call, create=True),
        patch("app.services.modal_client._resolve_modal_user_id", side_effect=lambda u: f"pfx/{u}"),
        patch(f"{M}.generate_presigned_url_global", side_effect=lambda k: f"https://r2/{k}?sig"),
        patch(f"{M}.generate_presigned_url", side_effect=lambda u, k: f"https://r2/{u}/{k}?sig"),
        patch(f"{M}.upload_to_r2", side_effect=AssertionError("server uploaded an encoded recap")),
        patch(f"{M}.upload_bytes_to_r2", return_value=True),
        *_server_ffmpeg_forbidden(),
    ]
    for p in patches:
        p.start()
    try:
        from app.services import auto_export
        upload_bytes = auto_export.upload_bytes_to_r2
        result = fn()
    finally:
        for p in reversed(patches):
            p.stop()
    return result, modal_call, upload_bytes


def test_generate_recap_dispatches_encode_to_modal(isolated_profile_db):  # noqa: F811
    """T2650:C1 -- sweep/share/backfill recap: Modal encodes, server writes the mapping."""
    from app.services.auto_export import RECAP_CRF, RECAP_PRESET, _generate_recap

    result, modal_call, upload_bytes = _run_with_modal(
        lambda: _generate_recap(USER_ID, PROFILE_ID, 7, _clips(), layer="team"),
        {"recap_key": "recaps/7_team.mp4",
         "segments": [{"id": 1, "duration": 5.0}, {"id": 2, "duration": 4.5}]},
    )

    assert result == "recaps/7_team.mp4"
    modal_call.assert_awaited_once()
    kwargs = modal_call.await_args.kwargs
    assert kwargs["user_prefix"] == f"pfx/{USER_ID}"
    assert kwargs["recap_key"] == "recaps/7_team.mp4"
    assert kwargs["crf"] == RECAP_CRF and kwargs["preset"] == RECAP_PRESET
    assert [(s["id"], s["url"], s["start"], s["end"]) for s in kwargs["segments"]] == [
        (1, "https://r2/games/abc123.mp4?sig", 0.0, 5.0),
        (2, "https://r2/games/abc123.mp4?sig", 10.0, 15.0),
    ]

    upload_bytes.assert_called_once()
    _, mapping_key, body = upload_bytes.call_args.args
    assert mapping_key == "recaps/7_team_clips.json"
    mapping = json.loads(body.decode())
    assert mapping["schema"] == "recap-map/v2" and mapping["layer"] == "team"
    assert [(c["id"], c["recap_start"], c["recap_end"], c["tags"]) for c in mapping["clips"]] == [
        (1, 0.0, 5.0, ["soccer"]), (2, 5.0, 9.5, []),
    ]


def test_legacy_slice_dispatches_encode_to_modal(isolated_profile_db):  # noqa: F811
    """T2650:C1 -- share-link ensure_recap after the game video is gone: slice runs on Modal."""
    from app.services.auto_export import _generate_recap_from_legacy_slice

    entries = [
        {"id": 2, "name": "Save", "rating": 4, "recap_start": 5.0, "recap_end": 9.0},
        {"id": 1, "name": "Goal", "rating": 5, "recap_start": 0.0, "recap_end": 5.0},
    ]
    result, modal_call, upload_bytes = _run_with_modal(
        lambda: _generate_recap_from_legacy_slice(USER_ID, PROFILE_ID, 7, "athlete", entries),
        {"recap_key": "recaps/7.mp4",
         "segments": [{"id": 1, "duration": 5.0}, {"id": 2, "duration": 4.0}]},
    )

    assert result == "recaps/7.mp4"
    segs = modal_call.await_args.kwargs["segments"]
    assert [(s["id"], s["url"], s["start"], s["end"]) for s in segs] == [
        (1, f"https://r2/{USER_ID}/recaps/7.mp4?sig", 0.0, 5.0),
        (2, f"https://r2/{USER_ID}/recaps/7.mp4?sig", 5.0, 9.0),
    ]
    mapping = json.loads(upload_bytes.call_args.args[2].decode())
    assert [(c["id"], c["recap_start"], c["recap_end"]) for c in mapping["clips"]] == [
        (1, 0.0, 5.0), (2, 5.0, 9.0),
    ]


def test_auto_export_game_runs_no_server_encode(isolated_profile_db):  # noqa: F811
    """T2650:C1 -- the nightly sweep's auto_export_game completes with every
    recap encode on Modal (brilliant-clip stream copy stubbed: not an encode)."""
    from app.services.auto_export import auto_export_game

    db = isolated_profile_db["db_path"]
    game_id = _insert_game(db)
    _insert_clip(db, game_id, rating=5, start=0.0, end=5.0)

    with patch(f"{M}._export_brilliant_clip"):
        status, modal_call, _ = _run_with_modal(
            lambda: auto_export_game(USER_ID, PROFILE_ID, game_id),
            {"recap_key": "ignored", "segments": [{"id": 1, "duration": 5.0}]},
        )

    assert status == "complete"
    assert modal_call.await_count >= 1
    assert _get_game_status(db, game_id)["auto_export_status"] == "complete"


def test_modal_failure_raises_instead_of_encoding_locally(isolated_profile_db):  # noqa: F811
    """T2650:C1 -- no silent local fallback: a Modal failure fails the recap
    (the sweep retries it; the share request reports it)."""
    from app.services.auto_export import _generate_recap

    with patch("app.services.modal_client.call_modal_encode_recap",
               AsyncMock(side_effect=RuntimeError("modal down")), create=True), \
         patch("app.services.modal_client.modal_enabled", return_value=True), \
         patch("app.services.modal_client._resolve_modal_user_id", side_effect=lambda u: u), \
         patch(f"{M}.generate_presigned_url_global", return_value="https://r2/x"), \
         patch(f"{M}.upload_bytes_to_r2") as up_bytes, \
         patch("ffmpeg.input", side_effect=AssertionError("local fallback encode")), \
         pytest.raises(RuntimeError, match="modal down"):
        _generate_recap(USER_ID, PROFILE_ID, 7, _clips(), layer="team")
    up_bytes.assert_not_called()


def _modal_functions():
    tree = ast.parse((BACKEND_ROOT / "app/modal_functions/video_processing.py").read_text())
    out = {}
    for node in tree.body:
        if isinstance(node, ast.FunctionDef):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and ast.unparse(dec.func) == "app.function":
                    out[node.name] = {kw.arg: ast.unparse(kw.value) for kw in dec.keywords}
    return out


def test_modal_encode_recap_function_is_cpu_and_uses_shared_encoder():
    """T2650:C2 -- a CPU Modal function runs the shared encoder; the client wraps it."""
    fns = _modal_functions()
    assert "encode_recap_modal" in fns
    assert fns["encode_recap_modal"]["gpu"] == "None"
    src = (BACKEND_ROOT / "app/modal_functions/video_processing.py").read_text()
    body = src[src.index("def encode_recap_modal"):]
    assert "from app.services.recap_encode import encode_recap" in body

    from app.services import modal_client
    assert callable(getattr(modal_client, "call_modal_encode_recap", None))


def test_recap_encoder_import_surface_has_no_database():
    """T2650:C2 -- the Modal image has no DB deps; the shared encoder must not pull them in."""
    script = (
        "import sys; import app.services.recap_encode; "
        "print(','.join(m for m in ('app.database', 'app.migrations', 'msgpack', 'fastapi') "
        "if m in sys.modules))"
    )
    r = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True,
                       cwd=str(BACKEND_ROOT))
    assert r.returncode == 0, r.stderr
    assert r.stdout.strip() == ""


def test_recap_encoder_real_ffmpeg_round_trip(tmp_path):
    """T2650:C2 -- the shared encoder (what Modal runs) cuts, normalizes and concats real media."""
    from app.services.recap_encode import encode_recap

    a = tmp_path / "a.mp4"
    b = tmp_path / "b.mp4"
    for path, size in ((a, "320x240"), (b, "160x120")):
        subprocess.run(
            ["ffmpeg", "-y", "-f", "lavfi", "-i", f"testsrc=size={size}:rate=10:duration=4",
             "-f", "lavfi", "-i", "sine=duration=4", "-shortest",
             "-c:v", "libx264", "-c:a", "aac", str(path)],
            check=True, capture_output=True,
        )
    out = tmp_path / "recap.mp4"
    segments = encode_recap(
        [{"id": 1, "url": str(a), "start": 0.0, "end": 2.0},
         {"id": 2, "url": str(a), "start": 3.0, "end": 2.0},  # inverted -> skipped
         {"id": 3, "url": str(b), "start": 1.0, "end": 2.0}],
        out, crf=30, preset="ultrafast",
    )
    assert [s["id"] for s in segments] == [1, 3]
    assert segments[0]["duration"] == pytest.approx(2.0, abs=0.3)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
         "stream=width,height", "-of", "csv=p=0", str(out)],
        check=True, capture_output=True, text=True,
    )
    assert probe.stdout.strip() == "320,240"


def test_sweep_keepalive_pinger_removed():
    """T2650:C3 -- the sweep no longer needs to keep the Fly machine awake."""
    from app.services import sweep_scheduler
    assert not hasattr(sweep_scheduler, "_ping_health")
    assert "/api/health" not in (BACKEND_ROOT / "app/services/sweep_scheduler.py").read_text()
