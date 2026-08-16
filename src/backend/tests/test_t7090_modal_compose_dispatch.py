"""T7090 Phase 3 -- move download-time compose to Modal (dispatch seam).

Covers the FOUR in-container-verifiable contracts of the Modal move (the live
Modal function body/image/redeploy is a staging-only verification GAP, same
posture as T6360):

  1. `build_intro_card_cmd` (the PURE shared ffmpeg builder) renders a valid MP4
     from a plan + layer_dir round-tripped through `_plan_card_render`.
  2. Local fallback (Modal OFF): `compose_serve_time_dispatched` behaves EXACTLY
     like `compose_serve_time` -- the ONLY path exercised in-container (T4180).
  3. Modal dispatch contract (mocked): with Modal ON and `call_modal_compose` +
     the R2 helpers mocked, the prefix resolves BEFORE dispatch, the intro layers
     render app-side + upload, the call is awaited, the result downloads to
     out_path, the report is populated from the result dict, and a Modal error
     falls back to the local compose.
  4. Cache preservation: a collection-download-style flow caches ONLY when
     full_fidelity and streams its own bytes (the T4947 invariants, exercised
     through the dispatched seam).
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import player_intro as P
from app.services import serve_time_video as S
from app.services.card_compose_plan import build_intro_card_cmd

pytestmark = pytest.mark.filterwarnings("ignore")

FRAME_W, FRAME_H = 480, 270


def _info(audio: bool = False) -> dict:
    return {"width": FRAME_W, "height": FRAME_H, "fps_str": "30/1",
            "pix_fmt": "yuv420p", "sar": "1/1", "timescale": 15360,
            "duration": 0.0, "has_audio": audio, "a_codec": "aac",
            "a_rate": 48000, "a_channels": 2}


def _card(**kw) -> dict:
    c = {"id": 9, "name": "card", "shown_fields": ["position", "height", "class_year"],
         "treatment": "dark", "title_text": None, "subtitle_text": "State Finals",
         "image_key": "k", "image_cutout_key": None, "focal_x": 0.5, "focal_y": 0.25,
         "zoom": 1.1, "text_elements": {}, "duration": 1.0, "is_default": False}
    c.update(kw)
    return c


FIELDS = {"full_name": "Marcus Johnson", "position": "Point Guard",
          "height": "6'2\"", "class_year": "2026"}


@pytest.fixture
def photo(tmp_path):
    from PIL import Image
    p = tmp_path / "photo.png"
    img = Image.new("RGB", (600, 800), (30, 80, 160))
    img.paste((240, 60, 60), (150, 120, 450, 700))
    img.save(p)
    return str(p)


def _make_reel(path: str, *, w=FRAME_W, h=FRAME_H, dur=1.0, audio=False):
    """A tiny valid MP4 matching the probe used above, so concat can join it."""
    cmd = ["ffmpeg", "-y", "-f", "lavfi", "-i",
           f"color=c=green:s={w}x{h}:r=30:d={dur}"]
    if audio:
        cmd += ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
    cmd += ["-c:v", "libx264", "-crf", "23", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-video_track_timescale", "15360"]
    if audio:
        cmd += ["-c:a", "aac", "-shortest"]
    cmd += ["-t", str(dur), path]
    subprocess.run(cmd, capture_output=True, text=True, check=True)


ffmpeg_present = os.path.exists("/usr/bin/ffmpeg")
requires_ffmpeg = pytest.mark.skipif(not ffmpeg_present, reason="ffmpeg required")


# =============================================================================
# 1. build_intro_card_cmd (PURE) -> valid MP4 from a plan + layer_dir round-trip
# =============================================================================
@requires_ffmpeg
def test_plan_round_trip_builds_valid_mp4(tmp_path, photo):
    """`_plan_card_render` writes the PNG layers + returns a JSON plan; the PURE
    `build_intro_card_cmd` turns that into an ffmpeg command that renders the same
    card the local `_build_card` would -- proving the shared builder is runnable
    and the plan is layer_dir-relative (the Modal side downloads the same layers)."""
    import json

    layer_dir = tmp_path / "layers"
    layer_dir.mkdir()
    plan = P._plan_card_render(_card(), FIELDS, photo, _info(), str(layer_dir))

    # The plan is JSON-serializable (it crosses the Modal wire).
    json.dumps(plan)
    # Every referenced layer PNG was written into layer_dir by basename.
    for layer in plan["layers"]:
        assert (layer_dir / layer["file"]).exists(), layer["file"]
    assert plan["layers"][0]["kind"] == "bg"

    out = tmp_path / "card.mp4"
    cmd = build_intro_card_cmd(plan, str(layer_dir), str(out))
    assert cmd[0] == "ffmpeg"
    subprocess.run(cmd, capture_output=True, text=True, check=True)
    assert out.exists() and out.stat().st_size > 0

    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)],
        capture_output=True, text=True, check=True).stdout.strip()
    w, h = probe.split(",")
    assert (int(w), int(h)) == (FRAME_W, FRAME_H)


@requires_ffmpeg
def test_plan_cmd_matches_local_build_card_cmd(tmp_path, photo, monkeypatch):
    """The dispatched (plan -> builder) command is byte-identical to the command
    the local `_build_card` emits -- the anti-drift guarantee (design §7)."""
    monkeypatch.setattr(P, "_CARD_CACHE_DIR", tmp_path / "cards")
    captured = {}
    real_run = P._run

    def capturing(cmd):
        captured["cmd"] = list(cmd)
        return real_run(cmd)

    monkeypatch.setattr(P, "_run", capturing)
    P._build_card(_card(), FIELDS, photo, _info(), str(tmp_path / "local.mp4"))
    local_cmd = captured["cmd"]

    # The local cmd's paths point at a throwaway build dir; normalise both cmds to
    # their filtergraph + encode args (everything except the absolute -i/-out paths),
    # which is exactly what the shared builder guarantees stays identical.
    def _graph_and_encode(cmd):
        return [a for a in cmd if not a.endswith(".png") and not a.endswith(".mp4")]

    layer_dir = tmp_path / "layers"
    layer_dir.mkdir()
    plan = P._plan_card_render(_card(), FIELDS, photo, _info(), str(layer_dir))
    plan_cmd = build_intro_card_cmd(plan, str(layer_dir), str(tmp_path / "plan.mp4"))

    assert _graph_and_encode(plan_cmd) == _graph_and_encode(local_cmd)


# =============================================================================
# 2. Local fallback (Modal OFF) == compose_serve_time, incl. degraded signal
# =============================================================================
@requires_ffmpeg
def test_dispatch_modal_off_matches_local_compose(tmp_path, monkeypatch):
    """With modal_enabled() False, the dispatched seam produces the SAME
    [reel(+outro)] compose the local path does, non-fatally, and populates the
    report the same way. This is the in-container-verifiable path (T4180)."""
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: False)
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "false")  # keep the compose to [reel]

    reel = tmp_path / "reel.mp4"
    _make_reel(str(reel))
    out = tmp_path / "out.mp4"

    report: dict = {}
    ok = S.compose_serve_time_dispatched(
        str(reel), str(out), user_id="u1", intro=None, outro=True, report=report,
    )
    assert ok is True
    # No intro, outro flag off -> nothing to concat -> full fidelity, reel served.
    assert report["full_fidelity"] is True


def test_dispatch_modal_off_delegates_to_patched_compose(monkeypatch):
    """The Modal-off branch calls `compose_serve_time` through the module attribute
    so existing patches (e.g. T4947's stub) still intercept it."""
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: False)
    calls = {}

    def _fake_compose(reel_path, out_path, *, intro=None, outro=True, report=None):
        calls["args"] = (reel_path, out_path, intro, outro)
        if report is not None:
            report["full_fidelity"] = True
        return True

    monkeypatch.setattr(S, "compose_serve_time", _fake_compose)
    report: dict = {}
    ok = S.compose_serve_time_dispatched(
        "reel.mp4", "out.mp4", user_id="u1", intro="INTRO", outro=True, report=report,
    )
    assert ok is True
    assert calls["args"] == ("reel.mp4", "out.mp4", "INTRO", True)
    assert report["full_fidelity"] is True


# =============================================================================
# 3. Modal dispatch contract (mocked) -- prefix resolved, layers uploaded,
#    call awaited, result downloaded, report populated; error -> local fallback
# =============================================================================
class _FakeIntro:
    """Stand-in IntroSpec: enough surface for `_plan_card_render`."""

    def __init__(self, photo):
        self.card = _card()
        self.field_values = FIELDS
        self.image_path = photo


@requires_ffmpeg
def test_modal_dispatch_uploads_layers_awaits_and_populates_report(
    tmp_path, monkeypatch, photo,
):
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: True)
    monkeypatch.setattr(
        "app.services.modal_client._resolve_modal_user_id",
        lambda uid: f"env/users/{uid}/profiles/default",
    )

    uploaded: list[str] = []
    downloaded: list[str] = []
    deleted: list[str] = []
    dispatch: dict = {}

    def _upload(key, local_path, *, content_type=None):
        uploaded.append(key)
        assert Path(local_path).exists(), f"uploaded a missing file for {key}"
        return True

    def _download(key, local_path, progress_callback=None):
        downloaded.append(key)
        # Materialize a real composed file at out_path so the caller can stream it.
        _make_reel(str(local_path))
        return True

    def _delete(key):
        deleted.append(key)
        return True

    async def _fake_call(user_prefix, reel_key, card_plan, intro_layer_keys,
                         outro_enabled, out_key):
        dispatch.update(
            user_prefix=user_prefix, reel_key=reel_key, card_plan=card_plan,
            intro_layer_keys=list(intro_layer_keys), outro_enabled=outro_enabled,
            out_key=out_key,
        )
        return {"out_key": out_key, "duration": 1.0,
                "full_fidelity": True, "degraded_reason": None}

    monkeypatch.setattr("app.storage.upload_file_to_r2_global", _upload)
    monkeypatch.setattr("app.storage.download_from_r2_global", _download)
    monkeypatch.setattr("app.storage.r2_delete_object_global", _delete)
    monkeypatch.setattr("app.services.modal_client.call_modal_compose", _fake_call)

    reel = tmp_path / "reel.mp4"
    _make_reel(str(reel))
    out = tmp_path / "out.mp4"

    report: dict = {}
    ok = S.compose_serve_time_dispatched(
        str(reel), str(out), user_id="u1", intro=_FakeIntro(photo),
        outro=True, report=report,
    )

    assert ok is True
    # Prefix resolved BEFORE dispatch, and it is what Modal received.
    assert dispatch["user_prefix"] == "env/users/u1/profiles/default"
    # The reel + every intro-card layer were rendered app-side and uploaded.
    assert any(k.endswith("/reel.mp4") for k in uploaded)
    assert dispatch["card_plan"] is not None
    assert len(dispatch["intro_layer_keys"]) == len(dispatch["card_plan"]["layers"])
    assert len(dispatch["intro_layer_keys"]) >= 1
    # The composed result was downloaded to out_path and the report mirrors Modal.
    assert downloaded, "the composed output must be downloaded"
    assert out.exists()
    assert report["full_fidelity"] is True
    # Scratch keys (reel + layers + composed) were best-effort deleted.
    assert deleted, "scratch keys must be cleaned up"


@requires_ffmpeg
def test_modal_dispatch_error_falls_back_to_local_compose(tmp_path, monkeypatch):
    """A Modal dispatch failure (e.g. the function undeployed -> RuntimeError, an
    EXTERNAL dependency) must degrade to the local compose, never sink the
    download."""
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: True)
    monkeypatch.setattr(
        "app.services.modal_client._resolve_modal_user_id", lambda uid: f"env/{uid}",
    )
    monkeypatch.setattr(
        "app.storage.upload_file_to_r2_global",
        lambda *a, **k: True,
    )
    monkeypatch.setattr("app.storage.r2_delete_object_global", lambda k: True)

    async def _boom(*a, **k):
        raise RuntimeError("Modal compose_serve_time_modal not available")

    monkeypatch.setattr("app.services.modal_client.call_modal_compose", _boom)

    local_called = {}

    def _fake_local(reel_path, out_path, *, intro=None, outro=True, report=None):
        local_called["yes"] = True
        if report is not None:
            report["full_fidelity"] = True
        with open(out_path, "wb") as f:
            f.write(b"LOCAL")
        return True

    monkeypatch.setattr(S, "compose_serve_time", _fake_local)

    reel = tmp_path / "reel.mp4"
    _make_reel(str(reel))
    out = tmp_path / "out.mp4"
    report: dict = {}
    ok = S.compose_serve_time_dispatched(
        str(reel), str(out), user_id="u1", intro=None, outro=True, report=report,
    )
    assert ok is True
    assert local_called.get("yes") is True, "must fall back to the local compose"
    assert report["full_fidelity"] is True


# =============================================================================
# 4. Cache preservation through the dispatched seam (T4947 invariants)
# =============================================================================
def test_dispatched_seam_preserves_full_fidelity_cache_gate(monkeypatch):
    """The dispatched compose still sets `report["full_fidelity"]`, which is what
    the T4947 collection cache gates the write on. A degraded (not full_fidelity)
    dispatched result must be observable so the caller skips the cache write --
    exactly as the local compose behaved."""
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: False)

    # Degraded local compose (intro dropped) still serves but is NOT full fidelity.
    def _degraded(reel_path, out_path, *, intro=None, outro=True, report=None):
        if report is not None:
            report["full_fidelity"] = False
            report["degraded_reason"] = "intro_card_render_killed"
        with open(out_path, "wb") as f:
            f.write(b"DEGRADED")
        return True

    monkeypatch.setattr(S, "compose_serve_time", _degraded)
    report: dict = {}
    ok = S.compose_serve_time_dispatched(
        "reel.mp4", "/tmp/t7090_out.mp4", user_id="u1", intro="I", outro=True,
        report=report,
    )
    assert ok is True
    assert report["full_fidelity"] is False, "the cache gate must see the degradation"
    assert report["degraded_reason"] == "intro_card_render_killed"


@requires_ffmpeg
def test_modal_intro_render_drop_is_not_full_fidelity(tmp_path, monkeypatch):
    """MAJOR-fix regression: an EXPECTED intro whose app-side PIL render fails
    non-fatally (card_plan=None) is dropped BEFORE dispatch, so Modal composes
    intro-less and reports full_fidelity=True for its (no-intro) result. The seam
    MUST still report full_fidelity=False -- matching the LOCAL path -- or the
    T4947 collection cache would freeze an intro-less video under the normal key.
    """
    monkeypatch.setattr("app.services.modal_client.modal_enabled", lambda: True)
    monkeypatch.setattr(
        "app.services.modal_client._resolve_modal_user_id", lambda uid: f"env/{uid}")
    monkeypatch.setattr("app.storage.upload_file_to_r2_global", lambda *a, **k: True)
    monkeypatch.setattr("app.storage.r2_delete_object_global", lambda k: True)

    def _download(key, local_path, progress_callback=None):
        _make_reel(str(local_path))
        return True

    monkeypatch.setattr("app.storage.download_from_r2_global", _download)

    # Force the app-side intro render to fail non-fatally -> card_plan is None.
    monkeypatch.setattr(S, "_render_intro_layers_to_dir", lambda *a, **k: None)

    async def _fake_call(user_prefix, reel_key, card_plan, intro_layer_keys,
                         outro_enabled, out_key):
        # Modal never saw an intro (card_plan is None) -> it reports a clean
        # no-intro compose as full fidelity. The seam must NOT trust that.
        assert card_plan is None and intro_layer_keys == []
        return {"out_key": out_key, "duration": 1.0,
                "full_fidelity": True, "degraded_reason": None}

    monkeypatch.setattr("app.services.modal_client.call_modal_compose", _fake_call)

    reel = tmp_path / "reel.mp4"
    _make_reel(str(reel))
    out = tmp_path / "out.mp4"
    report: dict = {}
    ok = S.compose_serve_time_dispatched(
        str(reel), str(out), user_id="u1", intro=_FakeIntro(None),
        outro=True, report=report,
    )
    assert ok is True
    assert report["full_fidelity"] is False, (
        "an expected intro dropped app-side must NOT cache as full fidelity")
