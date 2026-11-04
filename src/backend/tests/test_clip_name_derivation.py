"""
Tests for clip name derivation.

These tests ensure that derive_clip_name produces consistent results
matching the frontend generateClipName() function in utils/clipDisplayName.js.
"""

import pytest
from app.queries import derive_clip_name


class TestDeriveClipName:
    """Test the derive_clip_name function."""

    def test_returns_stored_name_if_present(self):
        """If a custom name is stored, it should be returned as-is."""
        assert derive_clip_name('Custom Name', ['Goal']) == 'Custom Name'
        assert derive_clip_name('My Clip', []) == 'My Clip'
        assert derive_clip_name('Test', ['Dribble', 'Goal']) == 'Test'

    def test_returns_empty_string_if_no_tags_and_no_notes(self):
        """If no tags, no custom name, and no notes, return empty string."""
        assert derive_clip_name(None, []) == ''
        assert derive_clip_name('', []) == ''
        assert derive_clip_name(None, None) == ''

    def test_notes_fallback_when_no_tags(self):
        """If no tags but notes exist, use first words from notes that fit in ~30 chars."""
        assert derive_clip_name(None, [], 'Great play by the midfielder') == 'Great play by the midfielder'
        assert derive_clip_name(None, [], 'Short') == 'Short'

    def test_notes_fallback_truncates_to_whole_words(self):
        """Notes fallback should truncate at word boundaries within ~30 chars."""
        long_notes = 'This is a really long note that should be truncated at a word boundary'
        result = derive_clip_name(None, [], long_notes)
        assert len(result) <= 30
        assert result == 'This is a really long note'
        # Should not cut mid-word
        assert not result.endswith(' ')

    def test_notes_fallback_not_used_when_tags_exist(self):
        """Notes should not affect name when tags are present."""
        assert derive_clip_name(None, ['Goal'], 'some notes') == 'Goal'

    def test_notes_fallback_not_used_when_custom_name_exists(self):
        """Custom name takes priority over notes."""
        assert derive_clip_name('Custom', [], 'some notes') == 'Custom'

    def test_notes_fallback_with_empty_notes(self):
        """Empty or whitespace-only notes should not produce a name."""
        assert derive_clip_name(None, [], '') == ''
        assert derive_clip_name(None, [], '   ') == ''

    def test_single_tag_format(self):
        """Single tag should be the tag alone."""
        assert derive_clip_name(None, ['Goal']) == 'Goal'
        assert derive_clip_name(None, ['Dribble']) == 'Dribble'
        assert derive_clip_name(None, ['Pass']) == 'Pass'
        assert derive_clip_name(None, ['Tackle']) == 'Tackle'
        assert derive_clip_name(None, ['Save']) == 'Save'

    def test_two_tags_format(self):
        """Two tags should produce 'Tag1 and Tag2' format."""
        assert derive_clip_name(None, ['Goal', 'Assist']) == 'Goal and Assist'
        assert derive_clip_name(None, ['Dribble', 'Pass']) == 'Dribble and Pass'

    def test_multiple_tags_format(self):
        """Multiple tags should produce 'Tag1, Tag2 and Tag3' format."""
        assert derive_clip_name(None, ['Goal', 'Assist', 'Dribble']) == 'Goal, Assist and Dribble'
        assert derive_clip_name(None, ['Pass', 'Movement', 'Tackle', 'Save']) == 'Pass, Movement, Tackle and Save'

    def test_empty_string_treated_as_no_name(self):
        """Empty string should be treated as no custom name."""
        assert derive_clip_name('', ['Goal']) == 'Goal'


class TestDeriveClipNameEdgeCases:
    """Test edge cases for derive_clip_name."""

    def test_whitespace_name_is_kept(self):
        """Names with only whitespace are still considered custom names."""
        # This is current behavior - whitespace-only names are truthy
        assert derive_clip_name('   ', ['Goal']) == '   '

    def test_tags_with_special_characters(self):
        """Tags with special characters should be joined correctly."""
        assert derive_clip_name(None, ['1v1 Defense']) == '1v1 Defense'
        assert derive_clip_name(None, ['Build-Up']) == 'Build-Up'

    def test_tags_order_preserved(self):
        """Tag order should be preserved in output."""
        result = derive_clip_name(None, ['A', 'B', 'C'])
        assert result == 'A, B and C'

        result = derive_clip_name(None, ['C', 'A', 'B'])
        assert result == 'C, A and B'


class TestDeriveClipNameFrontendConsistency:
    """
    Tests to ensure backend derive_clip_name matches frontend generateClipName.

    These test cases should match the behavior documented in:
    src/frontend/src/modes/annotate/constants/utils/clipDisplayName.js
    """

    def test_frontend_parity_single_tag(self):
        """Match frontend: generateClipName({ tags: ['Goal'] }) -> 'Goal'"""
        # Note: Frontend uses tag names like 'Goals', but shortName 'Goal' is used
        # Backend receives shortNames directly
        assert derive_clip_name(None, ['Goal']) == 'Goal'

    def test_frontend_parity_two_tags(self):
        """Match frontend: generateClipName({ tags: ['Dribble', 'Pass'] })"""
        # Frontend converts to shortNames: ['Dribble', 'Pass']
        assert derive_clip_name(None, ['Dribble', 'Pass']) == 'Dribble and Pass'

    def test_frontend_parity_empty_tags_no_notes(self):
        """Match frontend: generateClipName({ tags: [], notes: '' }) -> ''"""
        assert derive_clip_name(None, []) == ''

    def test_frontend_parity_empty_tags_with_notes(self):
        """Match frontend: generateClipName({ tags: [], notes: 'some notes' }) -> 'some notes'"""
        assert derive_clip_name(None, [], 'some notes') == 'some notes'

    def test_frontend_parity_custom_name_override(self):
        """Custom names should override auto-generation (same as frontend)."""
        # Frontend behavior: if name is set, use it directly
        assert derive_clip_name('My Custom Clip', ['Goal']) == 'My Custom Clip'
