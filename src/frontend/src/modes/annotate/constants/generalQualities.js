/**
 * What makes a play Brilliant, and the qualities a play can demonstrate, for
 * ANY sport (T16320, owner ruling 2026-11-13: general first, sport second).
 *
 * Nothing in this file may name a sport. Wording that belongs to one sport
 * lives in that sport's `sportStrings`, beside its tags (see soccerTags.js),
 * and is added to a prompt only for athletes of that sport. A sport with no
 * strings runs on this file alone.
 *
 * A quality is what a play shows about the athlete (Separation, Vision); a tag
 * is what happened (Goal, Tackle). Quality names are stored identifiers once a
 * game analysis has used them: renaming one means a new prompt version.
 *
 * Every sign must be something a camera can show (owner ruling 2026-11-13):
 * what the player does relative to another player in the frame. Video cannot
 * measure speed, distance or what a player is thinking, but it can show a
 * player pulling away from an opponent, catching one or out-jumping one. That
 * is why the list says Separation and not Pace.
 *
 * Source and evidence: docs/plans/research/recruiting-reel-research-2026-11.md
 * section 8a.
 */

export const QUALITY_SCOPE = {
  GENERAL: 'general',
  SPORT: 'sport',
};

export const BRILLIANT_BAR =
  'A play is Brilliant when the player did better than a good player at that level would be expected to do. Judge against the level of the game being watched, not against professionals.';

export const BRILLIANT_FOR_SCOUTING =
  'Brilliant for scouting: the player shows both a strong decision and strong execution, and the play demonstrates at least one quality from the list. A good decision carried out badly, or fine skill that was the wrong choice, does not count.';

export const BRILLIANT_FOR_SOCIAL =
  'Brilliant for social media: the play is the kind players see in highlight videos of their favorite players.';

export const LEARNING_OPPORTUNITY =
  'A learning opportunity is a play where the player could have chosen or executed better. Record it with its lesson. It is never Brilliant and is never offered for a highlight reel.';

export const generalQualities = [
  {
    name: 'Separation',
    meaning: 'Beats an opponent with speed, quickness or jump.',
    sign: "The gap between the player and an opponent changes because of the player's speed, quickness or jump: the player pulls away from one, catches one who started ahead, or gets higher than one in a contested jump.",
    routine: 'No opponent was close enough to compare against, or the opponent was not trying.',
  },
  {
    name: 'Strength',
    meaning: 'Wins or keeps possession through contact.',
    sign: 'In body contact with an opponent, the player stays balanced and comes away in control.',
    routine: 'No opponent touched them.',
  },
  {
    name: 'Composure',
    meaning: 'Keeps control while opponents close in.',
    sign: 'Under close pressure from one or more opponents, the player keeps control and makes a clean next action instead of giving possession away.',
    routine: 'Time and space, nobody near.',
  },
  {
    name: 'Vision',
    meaning: 'Finds a teammate or a space that takes opponents out of the play.',
    sign: 'The player delivers to a teammate or into a space that was not the nearest option, and it leaves one or more opponents behind the play.',
    routine: 'The nearest, obvious option.',
  },
  {
    name: 'Decision Making',
    meaning: 'Chooses the better option before the opponent can react.',
    sign: 'Two or more options were visible and the player took the one that hurt the opponent most, or acted before the nearest opponent could get to them. Give this only when the choice itself is what stands out.',
    routine: 'Only one option was on.',
  },
  {
    name: 'Anticipation',
    meaning: 'Moves early and arrives before the opponent.',
    sign: 'The player moves before the opponent acts and gets there first: cuts out a pass, steps in front, or covers for a beaten teammate.',
    routine: 'The play came straight to them.',
  },
  {
    name: 'Work Rate',
    meaning: 'Out-works the players around them to win possession back.',
    sign: 'While teammates and opponents nearby slow down or jog, the player keeps sprinting or makes repeated efforts off the play, and it wins possession back or stops an attack.',
    routine: 'Jogging back into position with everyone else.',
  },
  {
    name: 'Getting Open',
    meaning: 'Gets free of a marker without possession.',
    sign: 'A timed move without possession leaves the marker behind or on the wrong side, and a teammate finds the player.',
    routine: 'Standing in space and receiving.',
  },
  {
    name: '1v1 Attacking',
    meaning: 'Beats a defender alone.',
    sign: 'Facing a set defender, the player gets past alone and the move leads to a scoring chance or advances the play.',
    routine: 'The defender was out of position or not engaged.',
  },
  {
    name: '1v1 Defending',
    meaning: 'Stops an attacker alone.',
    sign: 'Isolated against an attacker, the player stops them cleanly without help.',
    routine: 'Help was already there and the attacker had slowed.',
  },
];
