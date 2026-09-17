"""
T4390 — aspect_ratio-from-actual-output-file, extended to every publish caller.

Locks in T4160's rule (removes the raw-1080p-in-the-9:16-ranking-pool incident
class) as a property of the shared publish writer's aspect-ratio resolver:

- derive_aspect_ratio_label maps real pixel dims to the two product ratios and
  returns None (never an 'other' bucket) for anything non-standard.
- resolve_output_aspect_ratio probes the ACTUAL output (in-memory bytes OR a
  presigned-URL ffprobe) and, crucially, OVERRIDES a wrong project setting with
  the file-derived value -- that override is the whole point of T4160.
- On any probe failure (R2 disabled in dev/test, ffprobe failure, non-standard
  ratio) it falls back to the project's explicit setting, logged, never silent.

Pure-unit: the two ffprobe seams (ffprobe_bytes / probe_dimensions_via_url) and
generate_presigned_url are patched, so no real ffmpeg or R2 is touched.
"""

from unittest.mock import patch

from app.services import publish_final_video as pub
from app.services.publish_final_video import (
    derive_aspect_ratio_label,
    resolve_output_aspect_ratio,
)

DIMS_16_9 = {"width": 1920, "height": 1080}
DIMS_9_16 = {"width": 1080, "height": 1920}
DIMS_SQUARE = {"width": 1000, "height": 1000}


# --------------------------------------------------------- derive label ----

class TestDeriveAspectRatioLabel:

    def test_16_9_dims_map_to_16_9(self):
        assert derive_aspect_ratio_label(1920, 1080) == "16:9"
        assert derive_aspect_ratio_label(3840, 2160) == "16:9"

    def test_9_16_dims_map_to_9_16(self):
        assert derive_aspect_ratio_label(1080, 1920) == "9:16"
        assert derive_aspect_ratio_label(810, 1440) == "9:16"

    def test_nonstandard_ratio_returns_none_not_other(self):
        # A square (or any out-of-band) ratio must NOT invent an 'other' bucket
        # -- rank.py's ranking-pool filter only knows 16:9/9:16.
        assert derive_aspect_ratio_label(1000, 1000) is None
        assert derive_aspect_ratio_label(1000, 800) is None  # 5:4, ratio 1.25

    def test_zero_dims_return_none(self):
        assert derive_aspect_ratio_label(0, 1080) is None
        assert derive_aspect_ratio_label(1920, 0) is None


# ------------------------------------------------- resolve (bytes path) ----

class TestResolveFromInMemoryBytes:

    def test_bytes_probe_yields_file_derived_label(self):
        with patch.object(pub, "ffprobe_bytes", return_value=DIMS_16_9):
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="16:9", video_bytes=b"xxx") == "16:9"

    def test_file_derived_overrides_wrong_project_setting(self):
        """THE T4160 incident class: the project setting says 9:16 but the actual
        rendered file is 16:9 -> the file wins, so a 16:9 reel never lands in the
        9:16 ranking pool."""
        with patch.object(pub, "ffprobe_bytes", return_value=DIMS_16_9):
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="9:16", video_bytes=b"xxx") == "16:9"

    def test_nonstandard_file_falls_back_to_project_setting(self):
        with patch.object(pub, "ffprobe_bytes", return_value=DIMS_SQUARE):
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="9:16", video_bytes=b"xxx") == "9:16"

    def test_ffprobe_failure_falls_back_to_project_setting(self):
        # ffprobe_bytes returns None on failure (fake bytes, no ffmpeg, etc.)
        with patch.object(pub, "ffprobe_bytes", return_value=None):
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="9:16", video_bytes=b"fake") == "9:16"


# --------------------------------------------------- resolve (R2 path) ----

class TestResolveFromR2PresignedUrl:

    def test_r2_probe_yields_file_derived_label(self):
        with patch("app.storage.generate_presigned_url", return_value="https://r2/x"), \
             patch.object(pub, "probe_dimensions_via_url", return_value=DIMS_9_16):
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="16:9", user_id="u1",
                r2_relative_path="final_videos/x.mp4") == "9:16"

    def test_r2_disabled_presign_none_falls_back(self):
        # generate_presigned_url returns None when R2 is disabled (dev/test) --
        # the exact reason the T4370 goldens need no re-bless for this change.
        with patch("app.storage.generate_presigned_url", return_value=None) as mock_gen, \
             patch.object(pub, "probe_dimensions_via_url") as mock_probe:
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="9:16", user_id="u1",
                r2_relative_path="final_videos/x.mp4") == "9:16"
        mock_gen.assert_called_once()
        mock_probe.assert_not_called()

    def test_r2_probe_failure_falls_back(self):
        with patch("app.storage.generate_presigned_url", return_value="https://r2/x"), \
             patch.object(pub, "probe_dimensions_via_url", return_value=None):
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="16:9", user_id="u1",
                r2_relative_path="final_videos/x.mp4") == "16:9"

    def test_bytes_take_precedence_over_r2_probe(self):
        """When the caller holds bytes, the R2 presign path is never reached."""
        with patch.object(pub, "ffprobe_bytes", return_value=DIMS_16_9), \
             patch("app.storage.generate_presigned_url") as mock_gen:
            assert resolve_output_aspect_ratio(
                project_aspect_ratio="9:16", video_bytes=b"xxx",
                user_id="u1", r2_relative_path="final_videos/x.mp4") == "16:9"
        mock_gen.assert_not_called()

    def test_no_bytes_no_r2_context_falls_back(self):
        # Neither probe input available -> project setting, no crash.
        assert resolve_output_aspect_ratio(project_aspect_ratio="9:16") == "9:16"
