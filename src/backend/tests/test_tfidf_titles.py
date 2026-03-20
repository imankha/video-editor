"""
Tests for TF-IDF keyword extraction for auto-generating clip titles.
"""

import pytest
from app.tfidf_titles import extract_keywords_tfidf, _extract_keywords_simple, MIN_CORPUS_SIZE


class TestExtractKeywordsSimple:
    """Test simple stop-word removal fallback for small corpora."""

    def test_removes_stop_words(self):
        result = _extract_keywords_simple("I love how close you are covering your man")
        assert 'I' not in result
        assert 'you' not in result.lower().split()
        assert 'are' not in result.lower().split()

    def test_returns_title_case(self):
        result = _extract_keywords_simple("covering close man")
        words = result.split()
        for w in words:
            assert w[0].isupper(), f"Expected title case, got '{w}'"

    def test_limits_to_max_keywords(self):
        result = _extract_keywords_simple("covering close man defensive pressing tackle interception")
        words = result.split()
        assert len(words) <= 4

    def test_handles_empty_string(self):
        result = _extract_keywords_simple("")
        assert result == ""

    def test_handles_all_stop_words(self):
        result = _extract_keywords_simple("I am the one who is")
        # Should fall back to first few words
        assert len(result) > 0

    def test_strips_punctuation(self):
        result = _extract_keywords_simple("covering, close! man?")
        assert ',' not in result
        assert '!' not in result
        assert '?' not in result

    def test_coaching_example_1(self):
        result = _extract_keywords_simple("I love how close you are covering your man")
        assert 'Covering' in result or 'Close' in result or 'Man' in result

    def test_coaching_example_2(self):
        result = _extract_keywords_simple("Land that ball on the outside, somewhere Nico can make a play")
        # Should contain content words like Ball, Outside, Nico, Play
        words = result.split()
        assert len(words) >= 2


class TestExtractKeywordsTfidf:
    """Test TF-IDF keyword extraction with full corpus."""

    @pytest.fixture
    def coaching_corpus(self):
        return [
            "I love how close you are covering your man",
            "Land that ball on the outside, somewhere Nico can make a play",
            "Great defensive positioning to cut off the passing lane",
            "Nice quick turn and acceleration past the defender",
            "Good vision to find the open player on the wing",
            "Strong tackle to win back possession in midfield",
            "Need to communicate more with your center back partner",
            "Excellent first touch under pressure from the opponent",
        ]

    def test_returns_nonempty_for_valid_notes(self, coaching_corpus):
        result = extract_keywords_tfidf(
            "I love how close you are covering your man",
            coaching_corpus
        )
        assert len(result) > 0

    def test_returns_title_case(self, coaching_corpus):
        result = extract_keywords_tfidf(
            "I love how close you are covering your man",
            coaching_corpus
        )
        for word in result.split():
            assert word[0].isupper(), f"Expected title case, got '{word}'"

    def test_keywords_are_from_notes(self, coaching_corpus):
        notes = "I love how close you are covering your man"
        result = extract_keywords_tfidf(notes, coaching_corpus)
        result_words = {w.lower() for w in result.split()}
        notes_words = {w.lower().strip('.,!?;:') for w in notes.split()}
        # All keywords should come from the original notes
        assert result_words.issubset(notes_words), f"Keywords {result_words} not all in notes {notes_words}"

    def test_empty_notes_returns_empty(self, coaching_corpus):
        assert extract_keywords_tfidf("", coaching_corpus) == ''
        assert extract_keywords_tfidf("  ", coaching_corpus) == ''

    def test_small_corpus_uses_simple_fallback(self):
        small_corpus = ["note one", "note two"]
        assert len(small_corpus) < MIN_CORPUS_SIZE
        result = extract_keywords_tfidf("covering close man defensive", small_corpus)
        # Should still return something (via simple fallback)
        assert len(result) > 0

    def test_distinguishes_unique_terms(self, coaching_corpus):
        """TF-IDF should prioritize terms unique to this note vs the corpus."""
        result = extract_keywords_tfidf(
            "Land that ball on the outside, somewhere Nico can make a play",
            coaching_corpus
        )
        # "Nico" is unique to this note - should appear as a keyword
        assert 'Nico' in result

    def test_max_keyword_count(self, coaching_corpus):
        result = extract_keywords_tfidf(
            "I love how close you are covering your man",
            coaching_corpus
        )
        words = result.split()
        assert len(words) <= 4

    def test_single_word_note(self, coaching_corpus):
        result = extract_keywords_tfidf("Goal", coaching_corpus)
        assert len(result) > 0


class TestDeriveClipNameWithTfidf:
    """Test derive_clip_name integration with generated_title parameter."""

    def test_generated_title_used_when_no_tags_no_name(self):
        from app.queries import derive_clip_name
        result = derive_clip_name(None, 3, [], 'some notes', 'Covering Close Man')
        assert result == 'Covering Close Man'

    def test_manual_name_overrides_generated_title(self):
        from app.queries import derive_clip_name
        result = derive_clip_name('Manual Name', 3, [], 'some notes', 'Covering Close Man')
        assert result == 'Manual Name'

    def test_tags_override_generated_title(self):
        from app.queries import derive_clip_name
        result = derive_clip_name(None, 5, ['Goal'], 'some notes', 'Covering Close Man')
        assert result == 'Brilliant Goal'

    def test_empty_generated_title_falls_back_to_notes_truncation(self):
        from app.queries import derive_clip_name
        result = derive_clip_name(None, 3, [], 'Great play by the midfielder', '')
        assert result == 'Great play by the midfielder'

    def test_no_generated_title_falls_back_to_notes_truncation(self):
        from app.queries import derive_clip_name
        result = derive_clip_name(None, 3, [], 'Great play by the midfielder')
        assert result == 'Great play by the midfielder'
