"""T5250 spotlight reveal envelope — backend canonical + Modal-inline parity.

The reveal envelope is the shared spec that keeps the editor preview and the exported
video in lockstep. These cases mirror the frontend Vitest cases in
src/frontend/src/utils/spotlightReveal.test.js number-for-number, and they also assert the
Modal-inline copy (video_processing._spotlight_reveal) produces identical output to the
canonical module — the anti-drift guard for the three mirrored copies.
"""

import pytest

from app.modal_functions.video_processing import _spotlight_reveal as modal_reveal
from app.services.spotlight_reveal import (
    ENTRANCE_SEC,
    ENTRANCE_START_SCALE,
    EXIT_SEC,
    compute_spotlight_reveal,
)


class TestComputeSpotlightReveal:
    def test_invisible_at_region_start_scaled_to_entrance_start(self):
        opacity, scale = compute_spotlight_reveal(0, 0, 5)
        assert opacity == 0
        assert scale == pytest.approx(ENTRANCE_START_SCALE)

    def test_fully_revealed_after_entrance_ramp(self):
        opacity, scale = compute_spotlight_reveal(ENTRANCE_SEC, 0, 5)
        assert opacity == 1
        assert scale == 1

    def test_noop_in_steady_middle(self):
        assert compute_spotlight_reveal(2.5, 0, 5) == (1.0, 1.0)

    def test_entrance_is_ease_out(self):
        opacity, scale = compute_spotlight_reveal(ENTRANCE_SEC / 2, 0, 5)
        assert opacity == pytest.approx(0.75)  # 1 - 0.25, past linear 0.5
        assert scale == pytest.approx(ENTRANCE_START_SCALE + (1 - ENTRANCE_START_SCALE) * 0.75)

    def test_fades_to_zero_at_end_no_scale_change(self):
        opacity, scale = compute_spotlight_reveal(5, 0, 5)
        assert opacity == 0
        assert scale == 1

    def test_exit_is_ease_in(self):
        opacity, scale = compute_spotlight_reveal(5 - EXIT_SEC / 2, 0, 5)
        assert opacity == pytest.approx(0.25)  # 0.5**2, below linear 0.5
        assert scale == 1

    def test_short_region_caps_ramps_at_half(self):
        dur = 0.4
        assert compute_spotlight_reveal(0, 0, dur)[0] == 0
        assert compute_spotlight_reveal(dur, 0, dur)[0] == 0
        mid_opacity, mid_scale = compute_spotlight_reveal(0.2, 0, dur)
        assert mid_opacity == 1
        assert mid_scale == 1

    def test_degenerate_bounds_are_noop(self):
        assert compute_spotlight_reveal(1, None, 5) == (1.0, 1.0)
        assert compute_spotlight_reveal(1, 5, 5) == (1.0, 1.0)  # zero-length
        assert compute_spotlight_reveal(1, 5, 2) == (1.0, 1.0)  # inverted


class TestModalInlineParity:
    """The Modal image can't import app.services, so video_processing.py inlines a copy.
    It must match the canonical module byte-for-byte in output across the ramp."""

    @pytest.mark.parametrize(
        "t,start,end",
        [
            (0, 0, 5),
            (0.1, 0, 5),
            (ENTRANCE_SEC / 2, 0, 5),
            (ENTRANCE_SEC, 0, 5),
            (2.5, 0, 5),
            (5 - EXIT_SEC / 2, 0, 5),
            (5, 0, 5),
            (0.2, 0, 0.4),  # short region, capped ramps
            (1, None, 5),
            (1, 5, 5),
        ],
    )
    def test_matches_canonical(self, t, start, end):
        assert modal_reveal(t, start, end) == compute_spotlight_reveal(t, start, end)
