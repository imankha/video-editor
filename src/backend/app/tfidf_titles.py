"""
TF-IDF keyword extraction for auto-generating clip titles from notes.

Uses scikit-learn's TfidfVectorizer when the user has enough notes (>= 5)
to build a meaningful corpus. Falls back to simple stop-word removal for
small corpora.
"""

from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS

# Additional stop words common in coaching notes
COACHING_STOP_WORDS = ENGLISH_STOP_WORDS.union({
    'like', 'really', 'just', 'get', 'got', 'think', 'know',
    'want', 'need', 'let', 'make', 'going', 'come', 'take',
    'good', 'great', 'nice', 'love', 'thing', 'way', 'lot',
    'try', 'see', 'look', 'keep', 'put', 'much', 'well',
    'also', 'back', 'even', 'still', 'right', 'sure',
})

MIN_CORPUS_SIZE = 5
MAX_KEYWORDS = 4
MIN_KEYWORDS = 2


def extract_keywords_tfidf(notes: str, corpus: list[str]) -> str:
    """
    Extract keywords from notes using TF-IDF fitted on the user's corpus.

    Args:
        notes: The specific note to extract keywords from.
        corpus: All notes for this user (including the target note).

    Returns:
        Title-cased keyword string like "Covering Close Man".
    """
    if not notes or not notes.strip():
        return ''

    if len(corpus) < MIN_CORPUS_SIZE:
        return _extract_keywords_simple(notes)

    return _extract_keywords_vectorizer(notes, corpus)


def _extract_keywords_vectorizer(notes: str, corpus: list[str]) -> str:
    """Use TF-IDF vectorizer fitted on corpus to find distinguishing keywords."""
    vectorizer = TfidfVectorizer(
        stop_words=list(COACHING_STOP_WORDS),
        max_features=500,
        min_df=1,
        max_df=0.9,
    )

    try:
        tfidf_matrix = vectorizer.fit_transform(corpus)
    except ValueError:
        # Empty vocabulary after stop words — fall back
        return _extract_keywords_simple(notes)

    feature_names = vectorizer.get_feature_names_out()

    # Find the index of our target note in the corpus
    target_vec = vectorizer.transform([notes])
    scores = target_vec.toarray()[0]

    # Get top keywords by TF-IDF score
    scored_words = [
        (feature_names[i], scores[i])
        for i in range(len(scores))
        if scores[i] > 0
    ]
    scored_words.sort(key=lambda x: x[1], reverse=True)

    keywords = [word for word, _ in scored_words[:MAX_KEYWORDS]]

    if len(keywords) < MIN_KEYWORDS:
        return _extract_keywords_simple(notes)

    return ' '.join(word.title() for word in keywords)


def _extract_keywords_simple(notes: str) -> str:
    """Simple stop-word removal for small corpora."""
    words = notes.strip().split()
    keywords = [
        w for w in words
        if w.lower().strip('.,!?;:') not in COACHING_STOP_WORDS
        and len(w) > 1
    ]

    if not keywords:
        # All words are stop words — take first few content words from original
        words = notes.strip().split()
        keywords = words[:3]

    keywords = keywords[:MAX_KEYWORDS]
    return ' '.join(word.strip('.,!?;:').title() for word in keywords)
