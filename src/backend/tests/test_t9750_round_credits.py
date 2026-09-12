"""T9750 -- render/export credits are round-half-up (+ 1-credit floor), not ceil.

The product owner switched the charging rule on 2026-09-12 from `ceil(seconds)`
to round-to-nearest ("personally i rather round"), with a 1-credit floor for any
positive duration (mirrors storage_credits' `max(1, ceil(...))`).

These tests pin:
  * the boundary behavior of the shared `round_credits_half_up` helper (this is
    billing -- the .5 case must round UP, which is exactly where Python's
    banker's-rounding `round()` would silently do the WRONG thing),
  * that BOTH charge sites go through the ONE shared helper (framing/multi-clip
    via `compute_export_credits`, and the legacy multipart path in
    `routers/exports.py` via a direct import of the SAME function object).
"""

import math

import pytest

from app.highlight_transform import compute_export_credits, round_credits_half_up


class TestRoundCreditsHalfUp:
    """Boundary cases for the shared helper -- this is money, get them right."""

    def test_exactly_half_rounds_up_not_bankers(self):
        """6.5s MUST round UP to 7 (round-half-up). This is the specific case
        that would silently fail if someone used Python's built-in `round()`:
        `round(6.5) == 6` (banker's rounding rounds .5 to the nearest EVEN)."""
        assert round_credits_half_up(6.5) == 7
        # Guard: prove we are NOT using Python's round() (would give 6 / 2 here).
        assert round(6.5) == 6
        assert round_credits_half_up(2.5) == 3
        assert round(2.5) == 2

    def test_just_below_half_rounds_down(self):
        assert round_credits_half_up(6.49) == 6

    def test_just_above_half_rounds_up(self):
        assert round_credits_half_up(6.51) == 7

    def test_sub_one_second_floors_to_one_credit(self):
        """Any positive duration costs at least 1 credit, never a free render."""
        assert round_credits_half_up(0.3) == 1
        assert round_credits_half_up(0.01) == 1

    def test_walkthrough_repro_6027_now_bills_6_not_7(self):
        """The walkthrough's own repro case: 6.027s billed 7 credits under the
        old ceil rule; under round-half-up it MUST now bill 6."""
        assert round_credits_half_up(6.027) == 6
        # And explicitly not the old ceil answer.
        assert round_credits_half_up(6.027) != math.ceil(6.027)

    def test_zero_or_negative_returns_zero(self):
        assert round_credits_half_up(0) == 0
        assert round_credits_half_up(-5) == 0
        assert round_credits_half_up(-0.4) == 0

    def test_whole_numbers_are_identity(self):
        for s in (1, 6, 10, 30, 100):
            assert round_credits_half_up(s) == s


class TestChargeSitesShareOneHelper:
    """AC: both charge sites use ONE shared round-half-up helper, not two
    independently-maintained rounding implementations."""

    def test_framing_charge_site_is_round_half_up_at_fps_30(self):
        """`compute_export_credits(seconds, 30)` (framing + multi-clip charge
        site) is exactly the shared helper -- the identity case post-T9750."""
        for s in (0, 0.3, 6.027, 6.49, 6.5, 6.51, 17.26, 100.0001):
            assert compute_export_credits(s, 30) == round_credits_half_up(s), f"mismatch at {s}s"

    def test_legacy_exports_path_imports_the_same_function_object(self):
        """`routers/exports.py`'s inline reservation must call the SAME helper
        object -- not a second inline `math.ceil`/`round` reimplementation."""
        from app.routers import exports as exports_router

        assert exports_router.round_credits_half_up is round_credits_half_up
        # And there is no stray module-level `math` left to inline a ceil with.
        assert not hasattr(exports_router, "math")

    def test_fractional_second_charge_matches_across_both_sites(self):
        """6.027s and 6.5s resolve to the same credit count through the framing
        helper as through the raw shared helper the exports path uses."""
        for s in (6.027, 6.5):
            assert compute_export_credits(s, 30) == round_credits_half_up(s)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
