"""T14560: the burned-in outro carries the tagline without "in minutes".

The card cache key includes _CARD_VERSION, so the version must move with the words or
cached cards keep serving the old tagline.
"""
from app.services import branded_outro

TAGLINE = "Transform game film into high-quality highlights using AI upscaling"


def test_outro_tagline_drops_in_minutes():
    assert branded_outro.TAGLINE_TEXT == TAGLINE
    assert " ".join(branded_outro.TAGLINE_LINES) == TAGLINE


def test_old_cached_cards_are_not_reused():
    assert branded_outro._CARD_VERSION != "v6-two-line-tagline"
