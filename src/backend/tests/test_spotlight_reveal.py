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
    def test_invisible_at_region_start_starts_larger_than_fitting(self):
        opacity, scale = compute_spotlight_reveal(0, 0, 5)
        assert opacity == 0
        # Entrance is a focus-pull: the ring begins oversized (>1) and contracts to 1.0.
        assert ENTRANCE_START_SCALE > 1
        assert scale == pytest.approx(ENTRANCE_START_SCALE)

    def test_fully_revealed_after_entrance_ramp(self):
        opacity, scale = compute_spotlight_reveal(ENTRANCE_SEC, 0, 5)
        assert opacity == 1
        assert scale == 1  # contracted to form-fitting

    def test_radius_contracts_monotonically_from_oversized_to_one(self):
        scales = [
            compute_spotlight_reveal(ENTRANCE_SEC * f, 0, 5)[1]
            for f in (0, 0.25, 0.5, 0.75, 1)
        ]
        # Strictly decreasing: big -> fitting. Every intermediate scale stays > 1.
        assert all(scales[i] < scales[i - 1] for i in range(1, len(scales)))
        assert scales[0] == pytest.approx(ENTRANCE_START_SCALE)
        assert all(s > 1 for s in scales[:-1])
        assert scales[-1] == 1

    def test_noop_in_steady_middle(self):
        assert compute_spotlight_reveal(2.5, 0, 5) == (1.0, 1.0)

    def test_entrance_opacity_ease_out_leads_contraction(self):
        opacity, scale = compute_spotlight_reveal(ENTRANCE_SEC / 2, 0, 5)
        # Opacity is ease-out CUBIC: 1 - 0.5**3 = 0.875, well past linear 0.5.
        assert opacity == pytest.approx(0.875)
        # Radius contracts on ease-out QUAD (trails opacity): START + (1-START)*0.75, > 1.
        assert scale == pytest.approx(ENTRANCE_START_SCALE + (1 - ENTRANCE_START_SCALE) * 0.75)
        assert scale > 1
        assert opacity > 0.75  # opacity leads the contraction progress (0.75)

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


class TestEnabledGate:
    """T5250 follow-up: the reveal is an opt-in per-project setting (working_videos.
    reveal_enabled), default OFF. `enabled` lives as a 4th param ON the shared spec
    itself (not a pre-check at each call site) so preview and backend render paths
    decide "off" identically -- mirrored in spotlightReveal.test.js."""

    def test_omitted_enabled_defaults_true_backcompat(self):
        assert compute_spotlight_reveal(ENTRANCE_SEC / 2, 0, 5) == \
            compute_spotlight_reveal(ENTRANCE_SEC / 2, 0, 5, True)

    @pytest.mark.parametrize("t", [0, ENTRANCE_SEC / 2, ENTRANCE_SEC, 2.5, 5 - EXIT_SEC / 2, 5])
    def test_disabled_is_identity_at_every_point_in_the_cycle(self, t):
        assert compute_spotlight_reveal(t, 0, 5, False) == (1.0, 1.0)

    def test_disabled_at_region_start_does_not_pop_invisible(self):
        # "Off" must skip the envelope entirely, not evaluate it and hide the result.
        assert compute_spotlight_reveal(0, 0, 5, enabled=False) == (1.0, 1.0)


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

    @pytest.mark.parametrize("t", [0, ENTRANCE_SEC / 2, 2.5, 5 - EXIT_SEC / 2, 5])
    def test_matches_canonical_when_disabled(self, t):
        assert modal_reveal(t, 0, 5, False) == compute_spotlight_reveal(t, 0, 5, False) == (1.0, 1.0)
