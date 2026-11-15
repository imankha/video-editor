"""T4660: the one builder of a game's display name.

Projects, downloads, collections, download metadata and games all name a game
through `game_display_name`, so the same game reads the same everywhere.
"""

from app.constants import GameType
from app.queries import short_game_date


def game_display_name(
    opponent_name: str | None,
    game_date: str | None,
    game_type: str | None,
    tournament_name: str | None,
    fallback_name: str
) -> str:
    """
    Generate a display name for a game based on its details.

    Format:
    - Home: "Vs <Opponent> <Date>"
    - Away: "at <Opponent> <Date>"
    - Tournament: "<Tournament>: Vs <Opponent> <Date>"

    Falls back to the stored name if opponent_name is not set.
    """
    if not opponent_name:
        return fallback_name

    # Format date as "Mon D" (e.g., "Dec 6")
    date_str = short_game_date(game_date)

    if game_type == GameType.TOURNAMENT and tournament_name:
        prefix = f"{tournament_name}: Vs"
    elif game_type == GameType.AWAY:
        prefix = "at"
    else:  # home or default
        prefix = "Vs"

    parts = [prefix, opponent_name]
    if date_str:
        parts.append(date_str)

    return " ".join(parts)
