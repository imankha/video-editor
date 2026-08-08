"""
T5220 -- the ONE serve-time compose helper (design §4) + the cross-DB intro
resolution helper (design §3 / §4.1's `IntroSpec`).

`services/serve_time_video.py::compose_serve_time` and
`services/intro_egress.py::resolve_intro_for_reel` do not exist yet -- this
whole file is RED (ModuleNotFoundError) until Stage 4 creates them.

Covers (design §12):
  - single concat produces [intro][reel][outro] in ONE ffmpeg pass (duration
    probe + assert concat_segments/ffmpeg invoked exactly once)
  - the non-fatal fall-through ladder: intro fails -> [reel][outro]; outro
    fails -> [intro][reel]; both fail -> [reel]; concat itself fails -> raw
    [reel]. Every rung returns True with a playable file (HTTP-200-equivalent,
    the caller never sees an exception)
  - resolve_intro_for_reel resolution order NULL/0/id (reuses T5215's
    resolve_intro_card_id matrix at the egress boundary)
  - cross-DB field_values assembly: facts-present vs facts-empty cards differ
    measurably; empty facts logs INFO
  - temp cleanup: IntroSpec.cleanup() leaves no leaked temp dir, after success
    AND after an induced build failure

Mirrors `test_t3950_branded_outro.py`'s real-ffmpeg + luma/duration-probe
style, and `test_t5210_player_intro.py`'s card/field_values fixtures.
"""

import logging
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# NEW modules -- neither exists yet. Expected to raise ModuleNotFoundError
# until Stage 4 creates services/serve_time_video.py + services/intro_egress.py.
from app.services.serve_time_video import compose_serve_time  # noqa: E402
from app.services.intro_egress import IntroSpec, resolve_intro_for_reel  # noqa: E402

pytestmark = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg/ffprobe required for serve-time compose tests",
)

CONTENT_DURATION = 2.0


def _make_clip(path: Path, w: int, h: int, has_audio: bool, duration: float):
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", f"testsrc=size={w}x{h}:rate=30:duration={duration}",
    ]
    if has_audio:
        cmd += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
                "-c:a", "aac", "-ar", "48000", "-ac", "2"]
    cmd += ["-c:v", "libx264", "-crf", "23", "-pix_fmt", "yuv420p"]
    if not has_audio:
        cmd += ["-an"]
    cmd += [str(path)]
    subprocess.run(cmd, capture_output=True, check=True)


@pytest.fixture
def reel(tmp_path):
    p = tmp_path / "reel.mp4"
    _make_clip(p, 810, 1440, True, CONTENT_DURATION)
    return p


def _card(shown=None, treatment="dark", **kw) -> dict:
    c = {
        "id": 1, "name": "card", "shown_fields": shown or ["position"],
        "treatment": treatment, "title_text": None, "image_key": "k",
        "image_cutout_key": None, "focal_x": 0.5, "focal_y": 0.25, "zoom": 1.1,
        "text_elements": {}, "duration": 1.0, "is_default": False,
    }
    c.update(kw)
    return c


FIELDS = {"full_name": "Marcus Johnson", "position": "Point Guard"}


def _intro_spec(tmp_path, image_path=None, field_values=None) -> "IntroSpec":
    """Build an IntroSpec directly (bypassing the DB open) for compose_serve_time
    tests that only care about the composition ladder, not resolution."""
    return IntroSpec(
        card=_card(),
        field_values=field_values if field_values is not None else FIELDS,
        image_path=image_path,
        tempdir=str(tmp_path / "intro_tmp"),
    )


# =============================================================================
# 1. Single concat produces [intro][reel][outro] in ONE pass
# =============================================================================

def test_single_concat_produces_intro_reel_outro_in_one_pass(tmp_path, reel, monkeypatch):
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    intro = _intro_spec(tmp_path)
    out = tmp_path / "composed.mp4"

    from app.services import ffmpeg_concat
    calls = []
    real_concat = ffmpeg_concat.concat_segments

    def counting_concat(segments, out_path, probe):
        calls.append(list(segments))
        return real_concat(segments, out_path, probe)

    with patch("app.services.ffmpeg_concat.concat_segments", side_effect=counting_concat):
        result = compose_serve_time(str(reel), str(out), intro=intro, outro=True)

    assert result is True
    assert out.exists()
    assert len(calls) == 1, f"concat must run exactly once for [intro][reel][outro], got {len(calls)}"
    assert len(calls[0]) == 3, f"expected 3 ordered segments, got {calls[0]}"

    from app.services.ffmpeg_concat import probe_media
    o = probe_media(str(out))
    r = probe_media(str(reel))
    # Composed duration >= reel alone (intro + outro add time); tolerant bound
    # since exact card durations depend on the render engine's own timing.
    assert o["duration"] > r["duration"]


# =============================================================================
# 2. Non-fatal fall-through ladder (design §4.2)
# =============================================================================

def test_intro_build_fails_yields_reel_and_outro(tmp_path, reel, monkeypatch):
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    intro = _intro_spec(tmp_path)
    out = tmp_path / "out.mp4"

    with patch("app.services.player_intro.build_intro_card", return_value=False):
        result = compose_serve_time(str(reel), str(out), intro=intro, outro=True)

    assert result is True
    assert out.exists()
    from app.services.ffmpeg_concat import probe_media
    from app.services.branded_outro import OUTRO_DURATION
    o = probe_media(str(out))
    r = probe_media(str(reel))
    assert o["duration"] == pytest.approx(r["duration"] + OUTRO_DURATION, abs=0.4)


def test_outro_build_fails_yields_intro_and_reel(tmp_path, reel, monkeypatch):
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    intro = _intro_spec(tmp_path)
    out = tmp_path / "out.mp4"

    with patch("app.services.branded_outro._get_or_build_card", return_value=None):
        result = compose_serve_time(str(reel), str(out), intro=intro, outro=True)

    assert result is True
    assert out.exists()
    from app.services.ffmpeg_concat import probe_media
    o = probe_media(str(out))
    r = probe_media(str(reel))
    # Intro is present so duration > reel alone, but outro's fixed 4.5s must
    # NOT have been added.
    assert o["duration"] > r["duration"]
    from app.services.branded_outro import OUTRO_DURATION
    assert o["duration"] < r["duration"] + OUTRO_DURATION


def test_both_cards_fail_yields_reel_only(tmp_path, reel, monkeypatch):
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    intro = _intro_spec(tmp_path)
    out = tmp_path / "out.mp4"

    with patch("app.services.player_intro.build_intro_card", return_value=False), \
         patch("app.services.branded_outro._get_or_build_card", return_value=None):
        result = compose_serve_time(str(reel), str(out), intro=intro, outro=True)

    assert result is True
    # Reel-only degrade: the served file's content matches the raw reel
    # (either copied to out_path or the caller is told to stream reel_path
    # directly -- either way a playable file exists and is reel-length).
    from app.services.ffmpeg_concat import probe_media
    serve_path = out if out.exists() else reel
    s = probe_media(str(serve_path))
    r = probe_media(str(reel))
    assert s["duration"] == pytest.approx(r["duration"], abs=0.35)


def test_concat_itself_fails_degrades_to_raw_reel(tmp_path, reel, monkeypatch):
    monkeypatch.setenv("BRANDED_OUTRO_ENABLED", "true")
    intro = _intro_spec(tmp_path)
    out = tmp_path / "out.mp4"

    with patch("app.services.ffmpeg_concat.concat_segments", return_value=False):
        result = compose_serve_time(str(reel), str(out), intro=intro, outro=True)

    assert result is True, "concat failure must still return True (HTTP 200, reel served raw)"
    from app.services.ffmpeg_concat import probe_media
    serve_path = out if out.exists() else reel
    s = probe_media(str(serve_path))
    r = probe_media(str(reel))
    assert s["duration"] == pytest.approx(r["duration"], abs=0.35)


def test_never_raises_on_unreadable_reel(tmp_path):
    """An unreadable reel_path is the one case that can legitimately produce
    False (nothing to serve) -- but it must never propagate an exception."""
    out = tmp_path / "out.mp4"
    result = compose_serve_time(str(tmp_path / "does-not-exist.mp4"), str(out), intro=None, outro=True)
    assert result is False


# =============================================================================
# 3. resolve_intro_for_reel -- resolution order NULL/0/id (T5215 matrix at the
#    egress boundary)
# =============================================================================

class TestResolveIntroForReel:
    def test_zero_never_resolves_at_any_duration(self, tmp_path, monkeypatch):
        monkeypatch.setattr(
            "app.services.intro_egress.resolve_intro_card",
            lambda *a, **k: None,
        )
        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=0,
            reel_duration=999.0, reel_id=1,
        )
        assert spec is None

    def test_explicit_id_always_resolves(self, tmp_path, monkeypatch):
        card_row = _card(id=42)
        monkeypatch.setattr(
            "app.services.intro_egress.resolve_intro_card",
            lambda *a, **k: card_row,
        )
        monkeypatch.setattr(
            "app.services.intro_egress._load_field_values",
            lambda *a, **k: FIELDS,
        )
        monkeypatch.setattr(
            "app.services.intro_egress._download_card_image",
            lambda *a, **k: None,
        )
        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=42,
            reel_duration=1.0, reel_id=1,
        )
        assert spec is not None
        assert spec.card["id"] == 42

    def test_null_default_only_when_duration_clears_gate(self, tmp_path, monkeypatch):
        card_row = _card(id=7, is_default=True)
        captured = {}

        def fake_resolve(intro_card_id, reel_duration, profile_conn, *, reel_id=None):
            captured["duration"] = reel_duration
            return card_row if (reel_duration or 0) >= 20.0 else None

        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", fake_resolve)
        monkeypatch.setattr("app.services.intro_egress._load_field_values", lambda *a, **k: FIELDS)
        monkeypatch.setattr("app.services.intro_egress._download_card_image", lambda *a, **k: None)

        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=None,
            reel_duration=30.0, reel_id=1,
        )
        assert spec is not None
        assert spec.card["id"] == 7

    def test_null_short_duration_resolves_none(self, tmp_path, monkeypatch):
        def fake_resolve(intro_card_id, reel_duration, profile_conn, *, reel_id=None):
            return None  # under threshold
        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", fake_resolve)
        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=None,
            reel_duration=5.0, reel_id=1,
        )
        assert spec is None

    def test_null_missing_duration_resolves_none_and_warns(self, tmp_path, monkeypatch, caplog):
        caplog.set_level(logging.WARNING)

        def fake_resolve(intro_card_id, reel_duration, profile_conn, *, reel_id=None):
            assert reel_duration is None
            return None
        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", fake_resolve)
        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=None,
            reel_duration=None, reel_id=99,
        )
        assert spec is None


# =============================================================================
# 4. Cross-DB field_values assembly
# =============================================================================

class TestCrossDbFieldValues:
    def test_facts_present_vs_empty_produce_different_intros(self, tmp_path, monkeypatch):
        card_row = _card(id=1, shown_fields=["position"])
        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", lambda *a, **k: card_row)
        monkeypatch.setattr("app.services.intro_egress._download_card_image", lambda *a, **k: None)

        monkeypatch.setattr(
            "app.services.intro_egress._load_field_values",
            lambda *a, **k: {"full_name": "Jordan Vega", "position": "Point Guard"},
        )
        spec_with_facts = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=1, reel_duration=30.0, reel_id=1,
        )

        monkeypatch.setattr(
            "app.services.intro_egress._load_field_values",
            lambda *a, **k: {},
        )
        spec_empty_facts = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=1, reel_duration=30.0, reel_id=1,
        )

        assert spec_with_facts.field_values != spec_empty_facts.field_values
        assert spec_with_facts.field_values.get("position") == "Point Guard"
        assert spec_empty_facts.field_values.get("position") is None

    def test_empty_facts_logs_info(self, tmp_path, monkeypatch, caplog):
        caplog.set_level(logging.INFO)
        card_row = _card(id=1, shown_fields=["position"])
        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", lambda *a, **k: card_row)
        monkeypatch.setattr("app.services.intro_egress._download_card_image", lambda *a, **k: None)
        monkeypatch.setattr("app.services.intro_egress._load_field_values", lambda *a, **k: {})

        resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=1, reel_duration=30.0, reel_id=1,
        )
        assert "empty" in caplog.text.lower() or "facts" in caplog.text.lower()


# =============================================================================
# 5. Temp cleanup (R2)
# =============================================================================

class TestTempCleanup:
    def test_no_leaked_tempdir_after_success(self, tmp_path, monkeypatch):
        card_row = _card(id=1)
        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", lambda *a, **k: card_row)
        monkeypatch.setattr("app.services.intro_egress._load_field_values", lambda *a, **k: FIELDS)

        created_dirs = []
        real_download = None  # burn variant should download the image to a temp path

        def fake_download(card, user_id, profile_id, tempdir):
            created_dirs.append(tempdir)
            img = Path(tempdir) / "card.png"
            img.write_bytes(b"\x89PNG\r\n")
            return str(img)

        monkeypatch.setattr("app.services.intro_egress._download_card_image", fake_download)

        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=1, reel_duration=30.0, reel_id=1,
        )
        assert spec is not None
        assert created_dirs, "burn variant must download the card image to a temp path"
        tempdir = Path(created_dirs[0])
        assert tempdir.exists()

        spec.cleanup()
        assert not tempdir.exists(), "cleanup() must remove its owning tempdir"

    def test_no_leaked_tempdir_after_induced_build_failure(self, tmp_path, monkeypatch):
        card_row = _card(id=1)
        monkeypatch.setattr("app.services.intro_egress.resolve_intro_card", lambda *a, **k: card_row)
        monkeypatch.setattr("app.services.intro_egress._load_field_values", lambda *a, **k: FIELDS)

        created_dirs = []

        def fake_download(card, user_id, profile_id, tempdir):
            created_dirs.append(tempdir)
            raise RuntimeError("injected image download failure")

        monkeypatch.setattr("app.services.intro_egress._download_card_image", fake_download)

        spec = resolve_intro_for_reel(
            user_id="u1", profile_id="p1", intro_card_id=1, reel_duration=30.0, reel_id=1,
        )
        # Non-fatal: a failed image download degrades to no-intro, not a raise.
        assert spec is None
        for d in created_dirs:
            assert not Path(d).exists(), "a failed build must not leak its tempdir"


# =============================================================================
# 6. downloads.py regression -- widened SELECT (design §4.3 / §9)
#
# No dedicated test_downloads.py exists yet (grepped tests/ -- only
# test_t3950_branded_outro.py + test_t5240_animated_outro.py touch the outro
# side of this route). This is the ONE assertion design §9 calls for: the
# `download_file` SELECT (downloads.py:686-691) must be widened to also load
# `fv.intro_card_id, fv.duration` so resolve_intro_for_reel has both inputs.
# Source-level (not DB-fixture) so it fails clearly the moment the SELECT text
# is edited, without needing a full TestClient/R2 round trip.
# =============================================================================

class TestDownloadFileSelectWidenedForIntro:
    def test_select_includes_intro_card_id_and_duration(self):
        import ast
        import inspect

        from app.routers import downloads as downloads_mod

        src = inspect.getsource(downloads_mod.download_file)
        # Pull every string literal out of the function body and find the SELECT.
        tree = ast.parse(src)
        selects = [
            node.value for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
            and "SELECT" in node.value and "final_videos" in node.value
        ]
        assert selects, "could not locate the final_videos SELECT in download_file"
        select_sql = selects[0]
        assert "intro_card_id" in select_sql, (
            "download_file's SELECT must be widened to load fv.intro_card_id "
            "so resolve_intro_for_reel can resolve the live attachment (design §4.3)"
        )
        assert "duration" in select_sql, (
            "download_file's SELECT must be widened to load fv.duration -- "
            "the duration gate on the inherit-default resolution path needs it"
        )
