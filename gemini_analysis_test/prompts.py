"""The prompts under test. `schema` set means the model must answer in that JSON shape."""

HIGHLIGHTS = (
    "Analyze this game video. Find 3 distinct highlight plays, note their exact timestamps, "
    "identify the primary players involved by their jersey numbers, and point out one learning "
    "moment or defensive breakdown in each clip."
)

PLAY_BY_PLAY = """Analyze this game video and write a complete play-by-play of the whole video, from the first second to the last, in order, with no gaps.

A play is one continuous passage of the game: a possession, an attack, a set piece, a restart, a transition, or a defensive stand. Start a new play when possession changes or the ball goes dead.

The most important job is to catch every individual player highlight. Players use these clips for college recruiting reels and social media, so a missed highlight is the worst mistake you can make here. A player highlight is any moment where one player does something worth showing: a goal, an assist, a shot on target, a key pass or through ball, a dribble that beats a defender, a skill move, a cross that creates a chance, a save, a tackle, an interception, a block, a header won, a recovery run that stops an attack, a strong piece of hold-up play. Rules for highlights:
- Look for them on both teams and in every position. Defenders and goalkeepers need highlights as much as attackers do.
- Give each highlight its own play entry; never bury it inside a longer passage. Set start a few seconds before the player's action begins and end just after its outcome is clear, so the clip can be cut straight from those timestamps.
- Give that player's team a relevance of 4 or 5 for the play.
- When you are unsure whether a moment is good enough, include it. An extra clip costs nothing; a missing one cannot be recovered.
- Before you finish, go back through the video once more looking only for player highlights you may have skipped, especially away from the main attacking moves.

First define the two teams by kit colour: team_0 and team_1. Use those same two teams for the whole answer.

For each play give the start and end timestamps as MM:SS, a one-sentence summary, and then a section for each team (team_0 and team_1). In each team's section give:

- relevance: 0 to 5, how much this play is worth that team reviewing, either as a highlight or as a lesson (0 = nothing to show or learn, 1 = routine, 2 = minor interest, 3 = worth a look, 4 = strong highlight or a clear lesson, 5 = must-see highlight or a key lesson). Score each team on its own; one play can be a 5 for both.
- players: every player of that team who meaningfully takes part in the play, in order. An empty list is fine when the team has no meaningful part. For each player:
  - jersey_number: see the rule below
  - position: the player's position or role in this play (for example "right winger", "goalkeeper", "left centre-back"). Always fill this in; it is how the player is identified when there is no number.
  - tags: every tag from the list below that describes what this player did in this play. Tag every player in every play, not only the highlights. Use the exact tag names. A player can earn more than one tag in a play, and any player can earn any tag (a defender who scores gets "Goal"). Tag what the player attempted even when it did not come off; the execution score records how well it went. Use an empty list only when nothing on the list fits.
    - "Goal": all types of finishes in scoring situations, including shots that do not go in.
    - "Assist": the final pass that leads directly to a goal.
    - "Dribble": beating defenders in individual attacking duels.
    - "Pass": short, long, and line-breaking passes to advance play.
    - "Chance Creation": key passes that set up opportunities for teammates.
    - "Control": quick turnover play and composure under pressure.
    - "Tackle": defensive challenges that win the ball.
    - "Interception": reading and winning possession before the opponent.
    - "Build-Up": passes from the back that start attacks.
    - "Save": all goalkeeper shot-stopping and 1v1 saves.
    - "Distribution": goalkeeper throws and kicks that start attacks.
  - decision_score: 1 to 5, was it the right idea in that moment (1 = poor choice, 2 = questionable, 3 = reasonable, 4 = good, 5 = the best option available)
  - execution_score: 1 to 5, how well the player carried it out (1 = failed, 2 = poor, 3 = adequate, 4 = good, 5 = clean)
  - note: if this was a learning opportunity, the note is the lesson: say what the player should do next time. If this was a great play there is no lesson; use the note to compare the action to a famous player known for exactly that kind of play.

Jersey number rule: give a jersey number only when you can read the digits clearly on screen and have high confidence in them. In every other case set jersey_number to null and rely on position. Never guess, never infer a number from position or from an earlier play, and never invent one. A null is correct; a wrong number is a serious error."""

# Stored tag names from src/frontend/src/modes/annotate/constants/soccerTags.js. The app shows
# "Save" as "Keeper Save" but stores "Save"; keep these identical to the app's stored values.
TAGS = ["Goal", "Assist", "Dribble", "Pass", "Chance Creation", "Control",
        "Tackle", "Interception", "Build-Up", "Save", "Distribution"]

# Rating scales. The maximum and the meaning of every value live here and are written into the
# schema itself (minimum / maximum / description), so anything reading the JSON Schema alone
# knows how strong each rating is.
RELEVANCE_SCALE = {
    0: "nothing to show or learn",
    1: "routine play, no review value",
    2: "minor interest",
    3: "worth a look",
    4: "strong highlight or a clear lesson",
    5: "must-see highlight or a key lesson",
}
DECISION_SCALE = {
    1: "poor choice, clearly better options were available",
    2: "questionable choice",
    3: "reasonable, standard choice",
    4: "good choice",
    5: "the best option available",
}
EXECUTION_SCALE = {
    1: "failed",
    2: "poor, mostly did not come off",
    3: "adequate",
    4: "good",
    5: "clean, could not be done better",
}


def _rating(what: str, scale: dict) -> dict:
    lo, hi = min(scale), max(scale)
    mapping = "; ".join(f"{k} = {v}" for k, v in scale.items())
    return {"type": "integer", "minimum": lo, "maximum": hi,
            "description": f"{what} Scale {lo} to {hi} (maximum {hi}): {mapping}."}


_PLAYER = {
    "type": "object",
    "properties": {
        "jersey_number": {
            "type": ["integer", "null"],
            "description": "Only when the digits are clearly readable with high confidence; otherwise null. Never guessed.",
        },
        "position": {"type": "string", "description": "Position or role in this play; identifies the player when jersey_number is null."},
        "tags": {
            "type": "array",
            "items": {"type": "string", "enum": TAGS},
            "description": "Every tag that describes what this player did in this play; empty only when none fits.",
        },
        "decision_score": _rating("Was it the right idea in that moment.", DECISION_SCALE),
        "execution_score": _rating("How well the player carried it out.", EXECUTION_SCALE),
        "note": {
            "type": "string",
            "description": "The lesson when this was a learning opportunity; for a great play, a comparison to a famous player.",
        },
    },
    "required": ["jersey_number", "position", "tags", "decision_score", "execution_score", "note"],
}

_TEAM_IN_PLAY = {
    "type": "object",
    "properties": {
        "relevance": _rating("How much this play is worth this team reviewing, as a highlight or a lesson.", RELEVANCE_SCALE),
        "players": {"type": "array", "items": _PLAYER},
    },
    "required": ["relevance", "players"],
}

_TEAM_DEF = {
    "type": "object",
    "properties": {"color": {"type": "string", "description": "Kit colour that identifies this team."}},
    "required": ["color"],
}

# Standard JSON Schema. Passed as `response_json_schema` to generate_content and as
# `response_format.schema` to the Interactions API.
PLAY_BY_PLAY_SCHEMA = {
    "type": "object",
    "properties": {
        "teams": {
            "type": "object",
            "properties": {"team_0": _TEAM_DEF, "team_1": _TEAM_DEF},
            "required": ["team_0", "team_1"],
        },
        "plays": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "start": {"type": "string", "description": "MM:SS from the start of the video sent."},
                    "end": {"type": "string", "description": "MM:SS from the start of the video sent."},
                    "summary": {"type": "string"},
                    "team_0": _TEAM_IN_PLAY,
                    "team_1": _TEAM_IN_PLAY,
                },
                "required": ["start", "end", "summary", "team_0", "team_1"],
            },
        },
    },
    "required": ["teams", "plays"],
}

PROMPTS = {
    "highlights": {"text": HIGHLIGHTS, "schema": None},
    "playbyplay": {"text": PLAY_BY_PLAY, "schema": PLAY_BY_PLAY_SCHEMA},
}
