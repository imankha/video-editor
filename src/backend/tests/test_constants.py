"""
Tests for shared constants module.

These tests ensure that:
1. Constants have all required values for ratings 1-5
2. Helper functions return correct defaults
3. Constants are consistent with each other
"""

import pytest
from app.constants import (
    RATING_ADJECTIVES,
    RATING_NOTATION,
    RATING_COLORS_HEX,
    RATING_COLORS_CSS,
    OVERLAY_STYLE_VERSION,
    MIN_RATING,
    MAX_RATING,
    DEFAULT_RATING,
    get_rating_adjective,
    get_rating_notation,
    get_rating_color_hex,
    get_rating_color_css,
    is_valid_rating,
)


class TestRatingAdjectives:
    """Test RATING_ADJECTIVES constant and helper."""

    def test_has_all_ratings(self):
        """RATING_ADJECTIVES should have entries for ratings 1-5."""
        for rating in range(1, 6):
            assert rating in RATING_ADJECTIVES
            assert isinstance(RATING_ADJECTIVES[rating], str)
            assert len(RATING_ADJECTIVES[rating]) > 0

    def test_expected_values(self):
        """RATING_ADJECTIVES should have the expected values."""
        assert RATING_ADJECTIVES[5] == 'Brilliant'
        assert RATING_ADJECTIVES[4] == 'Good'
        assert RATING_ADJECTIVES[3] == 'Interesting'
        assert RATING_ADJECTIVES[2] == 'Unfortunate'
        assert RATING_ADJECTIVES[1] == 'Bad'

    def test_get_rating_adjective_valid(self):
        """get_rating_adjective returns correct values for valid ratings."""
        assert get_rating_adjective(5) == 'Brilliant'
        assert get_rating_adjective(1) == 'Bad'

    def test_get_rating_adjective_invalid(self):
        """get_rating_adjective returns default for invalid ratings."""
        assert get_rating_adjective(0) == 'Interesting'
        assert get_rating_adjective(6) == 'Interesting'
        assert get_rating_adjective(-1) == 'Interesting'


class TestRatingNotation:
    """Test RATING_NOTATION constant and helper."""

    def test_has_all_ratings(self):
        """RATING_NOTATION should have entries for ratings 1-5."""
        for rating in range(1, 6):
            assert rating in RATING_NOTATION
            assert isinstance(RATING_NOTATION[rating], str)

    def test_expected_values(self):
        """RATING_NOTATION should have chess-inspired notation."""
        assert RATING_NOTATION[5] == '!!'
        assert RATING_NOTATION[4] == '!'
        assert RATING_NOTATION[3] == '!?'
        assert RATING_NOTATION[2] == '?'
        assert RATING_NOTATION[1] == '??'

    def test_get_rating_notation_valid(self):
        """get_rating_notation returns correct values for valid ratings."""
        assert get_rating_notation(5) == '!!'
        assert get_rating_notation(1) == '??'

    def test_get_rating_notation_invalid(self):
        """get_rating_notation returns default for invalid ratings."""
        assert get_rating_notation(0) == '!?'
        assert get_rating_notation(6) == '!?'


class TestRatingColorsHex:
    """Test RATING_COLORS_HEX constant and helper."""

    def test_has_all_ratings(self):
        """RATING_COLORS_HEX should have entries for ratings 1-5."""
        for rating in range(1, 6):
            assert rating in RATING_COLORS_HEX
            assert isinstance(RATING_COLORS_HEX[rating], str)

    def test_ffmpeg_format(self):
        """Colors should be in 0xRRGGBB format for FFmpeg."""
        for color in RATING_COLORS_HEX.values():
            assert color.startswith('0x')
            assert len(color) == 8  # 0x + 6 hex digits

    def test_expected_values(self):
        """RATING_COLORS_HEX should have expected color values."""
        assert RATING_COLORS_HEX[1] == '0xC62828'  # Red
        assert RATING_COLORS_HEX[5] == '0x66BB6A'  # Green

    def test_get_rating_color_hex_invalid(self):
        """get_rating_color_hex returns default for invalid ratings."""
        default = RATING_COLORS_HEX[DEFAULT_RATING]
        assert get_rating_color_hex(0) == default
        assert get_rating_color_hex(6) == default


class TestRatingColorsCss:
    """Test RATING_COLORS_CSS constant and helper."""

    def test_has_all_ratings(self):
        """RATING_COLORS_CSS should have entries for ratings 1-5."""
        for rating in range(1, 6):
            assert rating in RATING_COLORS_CSS
            assert isinstance(RATING_COLORS_CSS[rating], str)

    def test_css_format(self):
        """Colors should be in #RRGGBB format for CSS."""
        for color in RATING_COLORS_CSS.values():
            assert color.startswith('#')
            assert len(color) == 7  # # + 6 hex digits

    def test_matches_hex_colors(self):
        """CSS colors should match HEX colors (different prefix only)."""
        for rating in range(1, 6):
            hex_color = RATING_COLORS_HEX[rating]
            css_color = RATING_COLORS_CSS[rating]
            # 0xRRGGBB -> #RRGGBB
            assert css_color[1:].upper() == hex_color[2:].upper()


class TestIsValidRating:
    """Test is_valid_rating helper function."""

    def test_valid_ratings(self):
        """Ratings 1-5 should be valid."""
        for rating in range(1, 6):
            assert is_valid_rating(rating) is True

    def test_invalid_ratings(self):
        """Ratings outside 1-5 should be invalid."""
        assert is_valid_rating(0) is False
        assert is_valid_rating(6) is False
        assert is_valid_rating(-1) is False
        assert is_valid_rating(100) is False


class TestConstantsConsistency:
    """Test that all constant dictionaries are consistent."""

    def test_all_dicts_same_keys(self):
        """All rating dictionaries should have the same keys."""
        expected_keys = set(range(1, 6))
        assert set(RATING_ADJECTIVES.keys()) == expected_keys
        assert set(RATING_NOTATION.keys()) == expected_keys
        assert set(RATING_COLORS_HEX.keys()) == expected_keys
        assert set(RATING_COLORS_CSS.keys()) == expected_keys

    def test_default_rating_valid(self):
        """DEFAULT_RATING should be within valid range."""
        assert MIN_RATING <= DEFAULT_RATING <= MAX_RATING

    def test_min_max_rating_range(self):
        """MIN_RATING should be less than MAX_RATING."""
        assert MIN_RATING < MAX_RATING
        assert MIN_RATING == 1
        assert MAX_RATING == 5
