"""
T12520: an upload with no opponent is titled from its FILE NAME (stable across
the upload), falling back to "Game uploaded <date>" only when no file name is
known. Two unnamed uploads must be distinguishable.
"""

from app.routers.games import filename_title, unnamed_upload_name, upload_fallback_name


def test_filename_title_strips_extension():
    assert filename_title("wcfc-carlsbad-trimmed.mp4") == "wcfc-carlsbad-trimmed"


def test_filename_title_strips_directory():
    assert filename_title("C:\\videos\\half1.MOV") == "half1"
    assert filename_title("a/b/half2.mp4") == "half2"


def test_filename_title_blank_is_none():
    assert filename_title(None) is None
    assert filename_title("") is None
    assert filename_title(".mp4") is None


def test_unnamed_upload_uses_filename_over_date_fallback():
    assert unnamed_upload_name("wcfc-carlsbad-trimmed.mp4", "2026-10-11", set()) == "wcfc-carlsbad-trimmed"


def test_unnamed_upload_without_filename_uses_date_fallback():
    assert unnamed_upload_name(None, "2026-10-11", set()) == upload_fallback_name("2026-10-11")


def test_duplicate_names_are_distinguishable():
    taken = {"game"}
    assert unnamed_upload_name("game.mp4", "2026-10-11", taken) == "game (2)"
    taken.add("game (2)")
    assert unnamed_upload_name("game.mp4", "2026-10-11", taken) == "game (3)"
    assert unnamed_upload_name(None, "2026-10-11", {"Game uploaded Oct 11"}) == "Game uploaded Oct 11 (2)"
