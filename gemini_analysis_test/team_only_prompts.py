"""One-team variant of the play-by-play prompt. prompts.py is untouched and stays the source of
the tags, scales and schema; the schema is reused unchanged (see TEAM_ONLY_RESULTS.md).

The request carries three parts in this order: the video window, the reference kit picture,
then this text. `{kit_words}` is the kit colour in words, e.g. "navy blue shirts, navy blue shorts".
"""
from prompts import PLAY_BY_PLAY_SCHEMA  # noqa: F401  (re-exported: the one-team call uses it as is)

TEAM_ONLY_PLAY_BY_PLAY = """Analyze this game video for one team only: the team wearing the kit in the attached picture ({kit_words}). The picture shows one outfield player of that team, cropped from this same game. This team is "our team" below. Its goalkeeper wears a different colour but belongs to it. Ignore the particular player and the number in the picture; they only show the kit. Do not follow any single player.

Watch the whole video, from the first second to the last, and return, in order, only the plays worth our team reviewing. Leave out every passage where our team does nothing worth showing or learning from (stoppages, routine possession, spells where only the opponent does something of note).

A play is one continuous passage of the game: a possession, an attack, a set piece, a restart, a transition, or a defensive stand. Start a new play when possession changes or the ball goes dead.

The most important job is to catch every individual player highlight of our team. Players use these clips for college recruiting reels and social media, so a missed highlight is the worst mistake you can make here. A player highlight is any moment where one player does something worth showing: a goal, an assist, a shot on target, a key pass or through ball, a dribble that beats a defender, a skill move, a cross that creates a chance, a save, a tackle, an interception, a block, a header won, a recovery run that stops an attack, a strong piece of hold-up play. Rules for highlights:
- Look for them in every position of our team. Defenders and goalkeepers need highlights as much as attackers do.
- Give each highlight its own play entry; never bury it inside a longer passage. Set start a few seconds before the player's action begins and end just after its outcome is clear, so the clip can be cut straight from those timestamps.
- Give our team a relevance of 4 or 5 for the play.
- When you are unsure whether a moment is good enough, include it. An extra clip costs nothing; a missing one cannot be recovered.
- Before you finish, go back through the video once more looking only for our team's player highlights you may have skipped, especially away from the main attacking moves and near the end of the video.

Teams: team_0 is always our team, the one in the attached picture. team_1 is the opponent. Give each its kit colour. Use those same two teams for the whole answer.

Do not analyze the opponent. In every play set team_1 to relevance 0 with an empty players list. Never return a play only because of something the opponent did. The summary may mention the opponent only as far as needed to explain what our team's players did.

For each play give the start and end timestamps as MM:SS, a one-sentence summary, and then the team_0 section:

- relevance: 0 to 5, how much this play is worth our team reviewing, either as a highlight or as a lesson (0 = nothing to show or learn, 1 = routine, 2 = minor interest, 3 = worth a look, 4 = strong highlight or a clear lesson, 5 = must-see highlight or a key lesson). Plays that would score 0 or 1 are the ones to leave out.
- players: every player of our team who meaningfully takes part in the play, in order. For each player:
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

Jersey number rule: give a jersey number only when you can read the digits clearly on screen and have high confidence in them. In every other case set jersey_number to null and rely on position. Never guess, never infer a number from position, from an earlier play or from the attached picture, and never invent one. A null is correct; a wrong number is a serious error."""

# Kit colour in words, taken from looking at the crops in team_only/kits/.
TEAMS = {
    "A": {"picture": "team_only/kits/team_a_navy.png",
          "kit_words": "navy blue shirts, navy blue shorts, dark socks"},
    "B": {"picture": "team_only/kits/team_b_white.png",
          "kit_words": "white shirts with dark shoulder trim, navy blue shorts, dark socks"},
}
