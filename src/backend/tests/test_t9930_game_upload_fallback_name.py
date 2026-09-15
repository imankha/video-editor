"""
T9930: honest fallback title for a game uploaded with no opponent metadata.

The old default sent a fabricated "Unnamed opponent" plus today's date, so the
tile title read "Vs Unnamed opponent <today>" — asserting a match date the
parent never entered (evaluator finding S11). The upload dialog now sends an
empty opponent/date; the backend must title such a game by its UPLOAD date only
("Game uploaded <date>"), never claiming a match opponent or match date.

Pure-function tests (no DB / no client): format_short_date, upload_fallback_name,
and generate_game_display_name's empty-opponent fallback path.
"""

from app.routers.games import (
    format_short_date,
    upload_fallback_name,
    generate_game_display_name,
)
from app.constants import GameType


class TestFormatShortDate:
    def test_formats_iso_as_mon_day(self):
        assert format_short_date("2026-12-06") == "Dec 6"
        assert format_short_date("2026-09-12") == "Sep 12"

    def test_strips_leading_zero_on_single_digit_day(self):
        assert format_short_date("2026-09-06") == "Sep 6"

    def test_blank_or_missing_is_empty_string(self):
        assert format_short_date("") == ""
        assert format_short_date(None) == ""

    def test_unparseable_returns_raw_value(self):
        assert format_short_date("garbage") == "garbage"


class TestUploadFallbackName:
    def test_uses_upload_date(self):
        assert upload_fallback_name("2026-09-12") == "Game uploaded Sep 12"
        assert upload_fallback_name("2026-12-06") == "Game uploaded Dec 6"

    def test_never_fabricates_opponent_or_match_date(self):
        # No "Vs", no "Unnamed opponent" — just the upload date.
        name = upload_fallback_name("2026-09-12")
        assert "Vs" not in name
        assert "Unnamed" not in name

    def test_degrades_gracefully_without_a_date(self):
        assert upload_fallback_name(None) == "Game uploaded"
        assert upload_fallback_name("") == "Game uploaded"


class TestGenerateGameDisplayNameFallback:
    def test_empty_opponent_uses_the_fallback_verbatim(self):
        # With no opponent, the honest upload-date fallback is returned as-is —
        # the game_date argument is ignored so a date typed without an opponent
        # cannot leak in as a claimed match date.
        fallback = upload_fallback_name("2026-09-12")
        # "unknown" is a raw string (T8930 — not a backend enum member); the
        # empty-opponent branch returns before game_type is consulted anyway.
        assert generate_game_display_name(
            None, "2020-01-01", "unknown", None, fallback
        ) == "Game uploaded Sep 12"
        assert generate_game_display_name(
            "", None, "unknown", None, fallback
        ) == "Game uploaded Sep 12"

    def test_real_opponent_still_builds_the_vs_title(self):
        assert generate_game_display_name(
            "Carlsbad SC", "2026-12-06", GameType.HOME, None, "unused"
        ) == "Vs Carlsbad SC Dec 6"

    def test_away_opponent_uses_at_prefix(self):
        assert generate_game_display_name(
            "Carlsbad SC", "2026-12-06", GameType.AWAY, None, "unused"
        ) == "at Carlsbad SC Dec 6"
