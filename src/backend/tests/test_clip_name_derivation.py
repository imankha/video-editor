"""
Tests for clip name derivation.

These tests ensure that derive_clip_name produces consistent results
matching the frontend generateClipName() function in soccerTags.js.
"""

import pytest
from app.queries import derive_clip_name


class TestDeriveClipName:
    """Test the derive_clip_name function."""

    def test_returns_stored_name_if_present(self):
        """If a custom name is stored, it should be returned as-is."""
        assert derive_clip_name('Custom Name', 5, ['Goal']) == 'Custom Name'
        assert derive_clip_name('My Clip', 3, []) == 'My Clip'
        assert derive_clip_name('Test', 1, ['Dribble', 'Goal']) == 'Test'

    def test_returns_empty_string_if_no_tags(self):
        """If no tags and no custom name, return empty string."""
        assert derive_clip_name(None, 5, []) == ''
        assert derive_clip_name('', 5, []) == ''
        assert derive_clip_name(None, 3, None) == ''

    def test_single_tag_format(self):
        """Single tag should produce 'Adjective Tag' format."""
        assert derive_clip_name(None, 5, ['Goal']) == 'Brilliant Goal'
        assert derive_clip_name(None, 4, ['Dribble']) == 'Good Dribble'
        assert derive_clip_name(None, 3, ['Pass']) == 'Interesting Pass'
        assert derive_clip_name(None, 2, ['Tackle']) == 'Unfortunate Tackle'
        assert derive_clip_name(None, 1, ['Save']) == 'Bad Save'

    def test_two_tags_format(self):
        """Two tags should produce 'Adjective Tag1 and Tag2' format."""
        assert derive_clip_name(None, 5, ['Goal', 'Assist']) == 'Brilliant Goal and Assist'
        assert derive_clip_name(None, 4, ['Dribble', 'Pass']) == 'Good Dribble and Pass'

    def test_multiple_tags_format(self):
        """Multiple tags should produce 'Adjective Tag1, Tag2 and Tag3' format."""
        assert derive_clip_name(None, 5, ['Goal', 'Assist', 'Dribble']) == 'Brilliant Goal, Assist and Dribble'
        assert derive_clip_name(None, 3, ['Pass', 'Movement', 'Tackle', 'Save']) == 'Interesting Pass, Movement, Tackle and Save'

    def test_empty_string_treated_as_no_name(self):
        """Empty string should be treated as no custom name."""
        assert derive_clip_name('', 5, ['Goal']) == 'Brilliant Goal'

    def test_invalid_rating_uses_default(self):
        """Invalid ratings should use default adjective (Interesting)."""
        assert derive_clip_name(None, 0, ['Goal']) == 'Interesting Goal'
        assert derive_clip_name(None, 6, ['Goal']) == 'Interesting Goal'
        assert derive_clip_name(None, -1, ['Goal']) == 'Interesting Goal'

    def test_rating_adjective_mapping(self):
        """Each rating should map to correct adjective."""
        tag = ['Goal']
        assert 'Brilliant' in derive_clip_name(None, 5, tag)
        assert 'Good' in derive_clip_name(None, 4, tag)
        assert 'Interesting' in derive_clip_name(None, 3, tag)
        assert 'Unfortunate' in derive_clip_name(None, 2, tag)
        assert 'Bad' in derive_clip_name(None, 1, tag)


class TestDeriveClipNameEdgeCases:
    """Test edge cases for derive_clip_name."""

    def test_whitespace_name_is_kept(self):
        """Names with only whitespace are still considered custom names."""
        # This is current behavior - whitespace-only names are truthy
        assert derive_clip_name('   ', 5, ['Goal']) == '   '

    def test_tags_with_special_characters(self):
        """Tags with special characters should be joined correctly."""
        assert derive_clip_name(None, 5, ['1v1 Defense']) == 'Brilliant 1v1 Defense'
        assert derive_clip_name(None, 5, ['Build-Up']) == 'Brilliant Build-Up'

    def test_tags_order_preserved(self):
        """Tag order should be preserved in output."""
        result = derive_clip_name(None, 5, ['A', 'B', 'C'])
        assert result == 'Brilliant A, B and C'

        result = derive_clip_name(None, 5, ['C', 'A', 'B'])
        assert result == 'Brilliant C, A and B'


class TestDeriveClipNameFrontendConsistency:
    """
    Tests to ensure backend derive_clip_name matches frontend generateClipName.

    These test cases should match the behavior documented in:
    src/frontend/src/modes/annotate/constants/soccerTags.js
    """

    def test_frontend_parity_brilliant_goal(self):
        """Match frontend: generateClipName(5, ['Goals']) -> 'Brilliant Goal'"""
        # Note: Frontend uses tag names like 'Goals', but shortName 'Goal' is used
        # Backend receives shortNames directly
        assert derive_clip_name(None, 5, ['Goal']) == 'Brilliant Goal'

    def test_frontend_parity_good_dribble_and_pass(self):
        """Match frontend: generateClipName(4, ['Dribbling', 'Passing Range'])"""
        # Frontend converts to shortNames: ['Dribble', 'Pass']
        assert derive_clip_name(None, 4, ['Dribble', 'Pass']) == 'Good Dribble and Pass'

    def test_frontend_parity_empty_tags(self):
        """Match frontend: generateClipName(5, []) -> ''"""
        assert derive_clip_name(None, 5, []) == ''

    def test_frontend_parity_custom_name_override(self):
        """Custom names should override auto-generation (same as frontend)."""
        # Frontend behavior: if name is set, use it directly
        assert derive_clip_name('My Custom Clip', 5, ['Goal']) == 'My Custom Clip'
