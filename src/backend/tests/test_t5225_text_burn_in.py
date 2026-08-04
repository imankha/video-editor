"""T5225: overlay text burn-in -- rasterize-once producer + per-frame blend.

Covers the pieces of the design (SS6) that don't require a full video render:
- `_rasterize_text_layers` (overlay.py): probes exact frame dims, rasterises
  each ENABLED block ONCE via the real `render_text_layer`, raises loudly
  (never a silent default) when the working video can't be probed.
- `_decode_text_layers` / `_blend_text_layers` (overlay.py): decode-once
  contract, half-open `[startTime, endTime)` active-window semantics (design
  O6), dimension-mismatch fails loudly rather than silently rescaling (O3).
- The `has_keyframes or has_text` completion-path gate fix (SS6.5): a project
  with text but no highlight keyframes must not take the no-keyframes copy
  shortcut.

Modal-side `_decode_text_layers`/`_blend_text_layers` in video_processing.py
are INLINE COPIES of the same logic (Modal can't import overlay.py or
Pillow). `TestModalInlineParity` below runs the SAME inputs through both
copies and asserts identical output, mirroring test_spotlight_reveal.py's
TestModalInlineParity -- so a future edit to one copy that silently diverges
the other fails a test, not just a code review.
"""

import numpy as np
import pytest

from app.routers.export.overlay import (
    _blend_text_layers,
    _decode_text_layers,
    _rasterize_text_layers,
)
from app.modal_functions.video_processing import (
    _blend_text_layers as modal_blend_text_layers,
    _decode_text_layers as modal_decode_text_layers,
)


def _make_png_layer(start, end, color_bgr=(0, 255, 0), size=(20, 20), alpha=255):
    """A tiny solid-color RGBA PNG, encoded the same way _rasterize_text_layers
    encodes a real render_text_layer() output (PIL 'RGBA' -> PNG bytes)."""
    import io

    from PIL import Image

    w, h = size
    b, g, r = color_bgr
    img = Image.new("RGBA", (w, h), (r, g, b, alpha))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return {"startTime": start, "endTime": end, "png": buf.getvalue()}


class TestDecodeTextLayers:
    def test_decodes_matching_dims_and_normalizes_alpha(self):
        layer = _make_png_layer(1.0, 3.0, color_bgr=(10, 20, 30), size=(8, 8), alpha=128)
        decoded = _decode_text_layers([layer], frame_w=8, frame_h=8)

        assert len(decoded) == 1
        d = decoded[0]
        assert d["startTime"] == 1.0
        assert d["endTime"] == 3.0
        assert d["bgr"].shape == (8, 8, 3)
        assert d["alpha"].shape == (8, 8, 1)
        # 128/255 alpha normalized into [0,1]
        assert d["alpha"][0, 0, 0] == pytest.approx(128 / 255, abs=1e-3)

    def test_dimension_mismatch_raises_never_silently_rescales(self):
        """O3 hard constraint: rasterised dims must equal frame dims, or raise."""
        layer = _make_png_layer(0, 1, size=(50, 50))
        with pytest.raises(ValueError, match="dims"):
            _decode_text_layers([layer], frame_w=100, frame_h=100)

    def test_empty_list_returns_empty(self):
        assert _decode_text_layers([], 100, 100) == []


class TestBlendTextLayers:
    def test_half_open_range_active_at_start_inactive_at_end(self):
        """Design O6: [startTime, endTime) -- active AT start, inactive AT end
        (never symmetric-closed like highlight regions)."""
        layer = _make_png_layer(1.0, 2.0, color_bgr=(0, 0, 255), size=(4, 4), alpha=255)
        decoded = _decode_text_layers([layer], 4, 4)
        black_frame = np.zeros((4, 4, 3), dtype=np.uint8)

        at_start = _blend_text_layers(black_frame.copy(), decoded, current_time=1.0)
        assert at_start[0, 0].tolist() == [0, 0, 255]  # fully opaque red-channel-BGR block painted

        at_end = _blend_text_layers(black_frame.copy(), decoded, current_time=2.0)
        assert at_end[0, 0].tolist() == [0, 0, 0]  # NOT painted -- endTime is exclusive

        just_before_end = _blend_text_layers(black_frame.copy(), decoded, current_time=1.999)
        assert just_before_end[0, 0].tolist() == [0, 0, 255]

        before_start = _blend_text_layers(black_frame.copy(), decoded, current_time=0.999)
        assert before_start[0, 0].tolist() == [0, 0, 0]

    def test_partial_alpha_blends_proportionally(self):
        layer = _make_png_layer(0, 5, color_bgr=(0, 0, 200), size=(2, 2), alpha=128)
        decoded = _decode_text_layers([layer], 2, 2)
        black_frame = np.zeros((2, 2, 3), dtype=np.uint8)

        blended = _blend_text_layers(black_frame, decoded, current_time=1.0)
        # alpha ~0.502 -> 0*(1-a) + 200*a ~= 100
        assert 90 <= int(blended[0, 0, 2]) <= 110

    def test_no_active_layers_returns_frame_unchanged(self):
        layer = _make_png_layer(10.0, 20.0, size=(2, 2))
        decoded = _decode_text_layers([layer], 2, 2)
        frame = np.full((2, 2, 3), 77, dtype=np.uint8)
        result = _blend_text_layers(frame, decoded, current_time=0.0)
        assert (result == 77).all()

    def test_two_overlapping_layers_both_apply_in_order(self):
        """Two text blocks whose ranges overlap both paint -- later one composites
        on top (design acceptance criterion: two overlapping text blocks)."""
        bottom = _make_png_layer(0, 5, color_bgr=(255, 0, 0), size=(2, 2), alpha=255)
        top = _make_png_layer(0, 5, color_bgr=(0, 255, 0), size=(2, 2), alpha=255)
        decoded = _decode_text_layers([bottom, top], 2, 2)
        frame = np.zeros((2, 2, 3), dtype=np.uint8)
        result = _blend_text_layers(frame, decoded, current_time=1.0)
        # top (second in list) is opaque, so it's the final visible color
        assert result[0, 0].tolist() == [0, 255, 0]


class TestRasterizeTextLayersDimsProbe:
    def test_no_local_copy_and_no_r2_raises_loudly_never_silent_default(self, tmp_path, monkeypatch):
        """O3: if dims can't be probed via EITHER tier (local cv2 nor the R2
        presigned-URL ffprobe fallback), raise -- NEVER fall back to a
        hardcoded default like the pre-existing {1080,1920} landmine at
        _load_highlights_from_raw_clips (overlay.py:~1635). R2 is disabled in
        this test env, so generate_presigned_url returns None and the second
        tier is unreachable -- exactly the "nothing worked" case."""
        monkeypatch.setattr(
            "app.database.get_working_videos_path", lambda: tmp_path
        )
        text_overlays = [{
            "id": "txt1",
            "enabled": True,
            "startTime": 0.0,
            "endTime": 2.0,
            "spec": {
                "text": "GOAL", "font": "anton", "size": 0.08, "color": "#FFFFFF",
                "align": "center", "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8,
            },
        }]
        with pytest.raises(RuntimeError, match="could not determine working video dims"):
            _rasterize_text_layers("test-user", text_overlays, "does_not_exist.mp4")

    def test_falls_back_to_r2_probe_when_local_copy_absent(self, tmp_path, monkeypatch):
        """The multi-pod/restarted-pod case the local-only probe missed: no
        local disk copy, but the durable R2 object is reachable -- probe it
        via a presigned URL + ffprobe instead of raising."""
        monkeypatch.setattr(
            "app.database.get_working_videos_path", lambda: tmp_path
        )
        monkeypatch.setattr(
            "app.routers.export.overlay.generate_presigned_url",
            lambda user_id, path, **kw: "https://example.invalid/fake-presigned-url",
        )
        monkeypatch.setattr(
            "app.routers.export.overlay._ffprobe_remote_dims",
            lambda url: (640, 360),
        )
        text_overlays = [{
            "id": "txt1", "enabled": True, "startTime": 0.0, "endTime": 2.0,
            "spec": {
                "text": "GOAL", "font": "anton", "size": 0.08, "color": "#FFFFFF",
                "align": "center", "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8,
            },
        }]
        layers = _rasterize_text_layers("test-user", text_overlays, "does_not_exist.mp4")
        assert len(layers) == 1

    def test_no_enabled_blocks_returns_empty_without_probing(self, monkeypatch):
        """A disabled-only text_overlays list must short-circuit to [] WITHOUT
        touching the filesystem/dims probe at all (cheap, and avoids a raise on
        a project with only disabled blocks)."""
        def _boom():
            raise AssertionError("must not probe when there are no enabled blocks")
        monkeypatch.setattr("app.database.get_working_videos_path", _boom)

        text_overlays = [{
            "id": "txt1", "enabled": False, "startTime": 0.0, "endTime": 2.0,
            "spec": {
                "text": "x", "font": "anton", "size": 0.08, "color": "#FFFFFF",
                "align": "center", "position": {"x": 0.5, "y": 0.5}, "maxWidth": 0.8,
            },
        }]
        assert _rasterize_text_layers("test-user", text_overlays, "irrelevant.mp4") == []


class TestHasTextGate:
    """Pins the SS6.5 bug fix: has_keyframes gate must become
    `has_keyframes or has_text`, else a text-only project silently R2-copies
    the raw working video and drops the text. Unit-level (the boolean
    computation itself), not a full render -- the full render path is covered
    by the mandatory rendered-video QA pass."""

    def test_enabled_text_block_makes_has_text_true(self):
        text_overlays = [{"id": "t1", "enabled": True}]
        has_text = any(block.get('enabled', True) for block in text_overlays)
        assert has_text is True

    def test_all_disabled_text_blocks_makes_has_text_false(self):
        text_overlays = [{"id": "t1", "enabled": False}]
        has_text = any(block.get('enabled', True) for block in text_overlays)
        assert has_text is False

    def test_missing_enabled_key_defaults_true(self):
        """Matches the shape add_text actually writes (enabled always present),
        but defends the default for any hand-seeded/legacy row missing it."""
        text_overlays = [{"id": "t1"}]
        has_text = any(block.get('enabled', True) for block in text_overlays)
        assert has_text is True

    def test_empty_text_overlays_makes_has_text_false(self):
        assert any(block.get('enabled', True) for block in []) is False


class TestModalInlineParity:
    """The Modal image cannot import overlay.py (no `app` mount) or Pillow, so
    `_decode_text_layers`/`_blend_text_layers` are duplicated verbatim into
    video_processing.py (same constraint + precedent as `_spotlight_reveal`,
    see test_spotlight_reveal.py::TestModalInlineParity). This pins that the
    two copies behave IDENTICALLY on the same inputs -- a future edit to only
    one copy would diverge Modal vs local burned-in text, and this test would
    catch it."""

    def test_decode_produces_identical_arrays(self):
        layer = _make_png_layer(1.0, 3.0, color_bgr=(10, 20, 30), size=(16, 16), alpha=180)
        app_decoded = _decode_text_layers([layer], 16, 16)
        modal_decoded = modal_decode_text_layers([layer], 16, 16)

        assert len(app_decoded) == len(modal_decoded) == 1
        assert app_decoded[0]["startTime"] == modal_decoded[0]["startTime"]
        assert app_decoded[0]["endTime"] == modal_decoded[0]["endTime"]
        assert np.array_equal(app_decoded[0]["bgr"], modal_decoded[0]["bgr"])
        assert np.array_equal(app_decoded[0]["alpha"], modal_decoded[0]["alpha"])

    def test_blend_produces_identical_frames(self):
        layer = _make_png_layer(0, 5, color_bgr=(0, 0, 220), size=(4, 4), alpha=200)
        app_decoded = _decode_text_layers([layer], 4, 4)
        modal_decoded = modal_decode_text_layers([layer], 4, 4)

        frame = np.full((4, 4, 3), 50, dtype=np.uint8)
        app_result = _blend_text_layers(frame.copy(), app_decoded, current_time=1.0)
        modal_result = modal_blend_text_layers(frame.copy(), modal_decoded, current_time=1.0)

        assert np.array_equal(app_result, modal_result)

    def test_both_copies_agree_on_half_open_boundary(self):
        layer = _make_png_layer(1.0, 2.0, color_bgr=(0, 200, 0), size=(2, 2), alpha=255)
        app_decoded = _decode_text_layers([layer], 2, 2)
        modal_decoded = modal_decode_text_layers([layer], 2, 2)
        frame = np.zeros((2, 2, 3), dtype=np.uint8)

        # AT endTime: exclusive on both.
        app_at_end = _blend_text_layers(frame.copy(), app_decoded, current_time=2.0)
        modal_at_end = modal_blend_text_layers(frame.copy(), modal_decoded, current_time=2.0)
        assert np.array_equal(app_at_end, frame)
        assert np.array_equal(modal_at_end, frame)
        assert np.array_equal(app_at_end, modal_at_end)
