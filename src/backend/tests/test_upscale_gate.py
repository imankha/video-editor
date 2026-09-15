"""T10160 -- "skip the GAN for small enlargements" gate.

These tests pin the four guarantees from `docs/plans/tasks/T10160-design.md` §4:

  1. The gate ships INERT: GAN_MIN_ENLARGE == 0.0, so the cheap path is never
     taken and the render output is byte-identical to pre-T10160.
  2. The Modal `_upscale_crop` GAN path is byte-identical to the prior inline
     block while inert -- enhance(outscale=4) is called for every enlargement,
     the cheap path never runs, and the trim-to-target resize is preserved.
  3. When the constant IS flipped (test-only override), the gate skips the GAN
     below the threshold and keeps it at/above -- wired to the right quantity
     (output_w / crop_w) and direction.
  4. The two engines cannot diverge: the constant + should_skip_gan copy in
     video_processing.py agrees with the canonical app.ai_upscaler.upscale_gate
     (the deployed Modal image can't import `app`, so this parity test is the
     only guard), and the local frame_processor uses the canonical gate.

None of these need CUDA or Modal -- they assert the DECISION and the enhance
call args, not GAN output. The one measurement that would justify a non-zero
threshold is a GAN-inclusive CUDA/staging run (design Q2), out of scope here.
"""

import numpy as np
import pytest

from app.ai_upscaler import upscale_gate
from app.modal_functions import video_processing as vp

# out_w / crop_w enlargement ratios spanning the design's table (§1.3 / §b).
# (out_w, crop_w, ratio) -- ratios physically reachable for 9:16 from 1080p are
# 1.33x-2x; 3x/3.95x are the tighter historical crops.
RATIO_CASES = [
    (808, 608, 1.33),   # max-fit wide crop
    (810, 540, 1.50),   # provisional-hypothesis boundary
    (810, 409, 1.98),   # T9950 "wider frame"
    (810, 405, 2.00),
    (810, 270, 3.00),
    (810, 205, 3.95),   # today's default
]


class _RecordingUpsampler:
    """Stand-in for RealESRGANer: records enhance() calls, returns a 4x array."""

    def __init__(self, raise_exc: bool = False):
        self.calls = []
        self.raise_exc = raise_exc

    def enhance(self, img, outscale):
        self.calls.append({"shape": img.shape, "outscale": outscale})
        if self.raise_exc:
            raise RuntimeError("simulated enhance failure")
        h, w = img.shape[:2]
        return np.zeros((h * 4, w * 4, 3), dtype=np.uint8), None


def _crop(crop_w, crop_h=None):
    crop_h = crop_h or crop_w
    return np.zeros((crop_h, crop_w, 3), dtype=np.uint8)


class TestInertDefault:
    def test_constant_is_zero_in_both_copies(self):
        # AC1: the gate ships inert. A non-zero default here would be an
        # un-reviewed behaviour change to every export.
        assert upscale_gate.GAN_MIN_ENLARGE == 0.0
        assert vp.GAN_MIN_ENLARGE == 0.0

    @pytest.mark.parametrize("out_w, crop_w, ratio", RATIO_CASES)
    def test_never_skips_while_inert(self, out_w, crop_w, ratio):
        # With the default 0.0, should_skip_gan is False at every ratio.
        assert upscale_gate.should_skip_gan(out_w, crop_w) is False
        assert vp.should_skip_gan(out_w, crop_w) is False


class TestByteIdenticalGanPath:
    """AC2: while inert, _upscale_crop reproduces the prior inline enhance block."""

    @pytest.mark.parametrize("out_w, crop_w, ratio", RATIO_CASES)
    def test_enhance_called_with_outscale_4_and_cheap_path_never_taken(self, out_w, crop_w, ratio):
        ups = _RecordingUpsampler()
        out_h = out_w * 16 // 9
        result = vp._upscale_crop(ups, _crop(crop_w), out_w, out_h, log_label="t")
        # The GAN ran exactly once, at native 4x -- the byte-identical guarantee.
        assert len(ups.calls) == 1
        assert ups.calls[0]["outscale"] == 4
        # And the output was trimmed to the exact target (4x != target).
        assert result.shape[1] == out_w and result.shape[0] == out_h

    def test_exception_fallback_resizes_to_target(self):
        # The except-branch (enhance raises) still yields a target-sized frame,
        # exactly as the prior inline block did.
        ups = _RecordingUpsampler(raise_exc=True)
        result = vp._upscale_crop(ups, _crop(405), 810, 1440, log_label="t")
        assert len(ups.calls) == 1
        assert result.shape[1] == 810 and result.shape[0] == 1440


class TestCheapPathActivation:
    """AC3: when flipped, the gate skips the GAN below the threshold only."""

    @pytest.mark.parametrize("out_w, crop_w, ratio", RATIO_CASES)
    def test_modal_gate_direction(self, monkeypatch, out_w, crop_w, ratio):
        monkeypatch.setattr(vp, "GAN_MIN_ENLARGE", 1.75)
        ups = _RecordingUpsampler()
        out_h = out_w * 16 // 9
        result = vp._upscale_crop(ups, _crop(crop_w), out_w, out_h, log_label="t")
        if ratio < 1.75:
            # Below threshold -> cheap path: enhance NOT called.
            assert ups.calls == []
        else:
            # At/above threshold -> GAN path unchanged.
            assert len(ups.calls) == 1 and ups.calls[0]["outscale"] == 4
        # Either branch produces a target-sized frame.
        assert result.shape[1] == out_w and result.shape[0] == out_h

    @pytest.mark.parametrize("out_w, crop_w, ratio", RATIO_CASES)
    def test_canonical_gate_direction(self, monkeypatch, out_w, crop_w, ratio):
        monkeypatch.setattr(upscale_gate, "GAN_MIN_ENLARGE", 1.75)
        assert upscale_gate.should_skip_gan(out_w, crop_w) is (ratio < 1.75)

    def test_nonpositive_crop_width_takes_gan_path(self):
        # An impossible upstream state must fall to the GAN path, never divide-by-zero.
        assert upscale_gate.should_skip_gan(810, 0) is False
        assert vp.should_skip_gan(810, 0) is False


class TestTwoEngineParity:
    """AC4: the two copies cannot silently drift; the local engine uses the canonical."""

    def test_constant_copies_agree(self):
        assert vp.GAN_MIN_ENLARGE == upscale_gate.GAN_MIN_ENLARGE

    @pytest.mark.parametrize("out_w, crop_w, ratio", RATIO_CASES)
    @pytest.mark.parametrize("threshold", [0.0, 1.33, 1.5, 2.0, 4.0])
    def test_should_skip_gan_copies_agree(self, monkeypatch, out_w, crop_w, ratio, threshold):
        monkeypatch.setattr(vp, "GAN_MIN_ENLARGE", threshold)
        monkeypatch.setattr(upscale_gate, "GAN_MIN_ENLARGE", threshold)
        assert vp.should_skip_gan(out_w, crop_w) == upscale_gate.should_skip_gan(out_w, crop_w)

    def test_local_engine_uses_canonical_gate(self):
        # frame_processor imports torch at module top; only importable where torch
        # is present (real GPU / prod). Where it is, it must use the SAME gate
        # function object, so the local and Modal engines cannot diverge.
        pytest.importorskip("torch")
        from app.ai_upscaler import frame_processor
        assert frame_processor.should_skip_gan is upscale_gate.should_skip_gan
