/**
 * What makes a play Brilliant, and the qualities a play can demonstrate, for
 * ANY sport (T16320, owner ruling 2026-11-13: general first, sport second).
 *
 * Nothing in this file may name a sport. Wording that belongs to one sport
 * lives in that sport's `sportStrings`, beside its tags (see soccerTags.js),
 * and is added to a prompt only for athletes of that sport. A sport with no
 * strings runs on this file alone.
 *
 * A quality is what a play shows about the athlete (Pace, Vision); a tag is
 * what happened (Goal, Tackle). Quality names are stored identifiers once a
 * game analysis has used them: renaming one means a new prompt version.
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
    name: 'Pace',
    meaning: 'Covers ground faster than the opponent.',
    sign: 'The player wins a race against an opponent who started level or ahead.',
    routine: 'Nobody was racing them.',
  },
  {
    name: 'Strength',
    meaning: 'Wins or keeps possession through contact.',
    sign: 'In body contact with an opponent, the player stays balanced and comes away in control.',
    routine: 'No opponent touched them.',
  },
  {
    name: 'Composure',
    meaning: 'Stays calm and in control when pressed.',
    sign: 'Under close pressure from one or more opponents, the player keeps control and makes a clean next action instead of a hurried one.',
    routine: 'Time and space, nobody near.',
  },
  {
    name: 'Vision',
    meaning: 'Sees a teammate or a space others do not.',
    sign: 'The player looks around first, then finds a teammate or a space that was not the obvious option.',
    routine: 'The nearest, obvious option.',
  },
  {
    name: 'Decision Making',
    meaning: 'Chooses the better option, quickly.',
    sign: 'Two or more options were visible and the player took the one that hurt the opponent most, or acted before the pressure arrived. Give this only when the choice itself is what stands out.',
    routine: 'Only one option was on.',
  },
  {
    name: 'Anticipation',
    meaning: 'Reads the play and arrives first.',
    sign: 'The player moves before the opponent acts and gets there first: cuts out a pass, steps in front, or covers for a beaten teammate.',
    routine: 'The play came straight to them.',
  },
  {
    name: 'Work Rate',
    meaning: 'Chases back or presses to win possession.',
    sign: 'A long sprint or repeated efforts off the play that win possession back or stop an attack.',
    routine: 'Jogging back into position.',
  },
  {
    name: 'Off-Ball Movement',
    meaning: 'Gets free without possession.',
    sign: 'A timed move without possession loses the marker, and a teammate finds the player.',
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
