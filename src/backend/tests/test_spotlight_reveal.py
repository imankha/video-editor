"""T5250 spotlight exit-fade envelope — backend canonical + Modal-inline parity.

The envelope is the shared spec that keeps the editor preview and the exported video in
lockstep. The spotlight is FULL at the region start and stays full through the region; the
ONLY animation is the exit fade-out (no entrance). These cases mirror the frontend Vitest
cases in src/frontend/src/utils/spotlightReveal.test.js number-for-number, and they also
assert the Modal-inline copy (video_processing._spotlight_reveal) produces identical output
to the canonical module — the anti-drift guard for the three mirrored copies.
"""

import pytest

from app.modal_functions.video_processing import _spotlight_reveal as modal_reveal
from app.services.spotlight_reveal import (
    EXIT_SEC,
    compute_spotlight_reveal,
)


class TestComputeSpotlightReveal:
    def test_full_at_region_start_no_entrance(self):
        # No entrance animation: full opacity + full size immediately at the region start.
        assert compute_spotlight_reveal(0, 0, 5) == (1.0, 1.0)

    def test_full_just_after_region_start(self):
        assert compute_spotlight_reveal(0.2, 0, 5) == (1.0, 1.0)

    def test_noop_in_steady_middle(self):
        assert compute_spotlight_reveal(2.5, 0, 5) == (1.0, 1.0)

    def test_still_full_right_before_exit_ramp(self):
        assert compute_spotlight_reveal(5 - EXIT_SEC - 0.01, 0, 5) == (1.0, 1.0)

    def test_fades_to_zero_at_end_no_scale_change(self):
        opacity, scale = compute_spotlight_reveal(5, 0, 5)
        assert opacity == 0
        assert scale == 1

    def test_exit_is_ease_in(self):
        opacity, scale = compute_spotlight_reveal(5 - EXIT_SEC / 2, 0, 5)
        assert opacity == pytest.approx(0.25)  # 0.5**2, below linear 0.5
        assert scale == 1

    def test_short_region_caps_exit_at_half(self):
        dur = 0.4
        assert compute_spotlight_reveal(0, 0, dur) == (1.0, 1.0)  # full at start
        assert compute_spotlight_reveal(0.2, 0, dur) == (1.0, 1.0)  # full at middle
        assert compute_spotlight_reveal(dur, 0, dur)[0] == 0  # faded to 0 at end

    def test_degenerate_bounds_are_noop(self):
        assert compute_spotlight_reveal(1, None, 5) == (1.0, 1.0)
        assert compute_spotlight_reveal(1, 5, 5) == (1.0, 1.0)  # zero-length
        assert compute_spotlight_reveal(1, 5, 2) == (1.0, 1.0)  # inverted


class TestModalInlineParity:
    """The Modal image can't import app.services, so video_processing.py inlines a copy.
    It must match the canonical module byte-for-byte in output across the region."""

    @pytest.mark.parametrize(
        "t,start,end",
        [
            (0, 0, 5),  # region start (full, no entrance)
            (0.2, 0, 5),  # just after start
            (2.5, 0, 5),  # steady middle
            (5 - EXIT_SEC - 0.01, 0, 5),  # just before exit ramp
            (5 - EXIT_SEC / 2, 0, 5),  # mid exit
            (5, 0, 5),  # region end
            (0.2, 0, 0.4),  # short region, capped exit ramp
            (0.4, 0, 0.4),  # short region end
            (1, None, 5),
            (1, 5, 5),
        ],
    )
    def test_matches_canonical(self, t, start, end):
        assert modal_reveal(t, start, end) == compute_spotlight_reveal(t, start, end)
