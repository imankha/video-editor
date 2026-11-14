// Re-export generateClipName from common utility (moved in T790)
export { generateClipName } from '../../../utils/clipDisplayName';

/**
 * Soccer tags organized by position for clip tagging
 */
export const soccerTags = {
  attacker: [
    {
      name: "Goal",
      description: "All types of finishes in scoring situations."
    },
    {
      name: "Assist",
      description: "Final pass that leads directly to a goal."
    },
    {
      name: "Dribble",
      description: "Beating defenders in individual attacking duels."
    }
  ],

  midfielder: [
    {
      name: "Pass",
      description: "Short, long, and line-breaking passes to advance play."
    },
    {
      name: "Chance Creation",
      description: "Key passes that set up opportunities for teammates."
    },
    {
      name: "Control",
      description: "Quick turnover play and composure under pressure."
    }
  ],

  defender: [
    {
      name: "Tackle",
      description: "Clean defensive challenges that win the ball."
    },
    {
      name: "Interception",
      description: "Reading and winning possession before the opponent."
    },
    {
      name: "Build-Up",
      description: "Accurate passes from the back that start attacks."
    }
  ],

  goalie: [
    {
      name: "Save",
      // T8490: display-only rename ("Save" reads ambiguous next to the form's
      // real Save button). Stored value stays "Save" so existing clips' tags
      // still match and the backend curated-combo match (['Goal','Save'] in
      // hockey/collections.py-style lookups) is untouched.
      displayName: "Keeper Save",
      description: "All shot-stopping and 1v1 saves."
    },
    {
      name: "Distribution",
      description: "Accurate throws and kicks to start counterattacks."
    }
  ]
};

/**
 * Position display names
 */
export const positions = [
  { id: 'attacker', name: 'Attacker' },
  { id: 'midfielder', name: 'Midfielder' },
  { id: 'defender', name: 'Defender' },
  { id: 'goalie', name: 'Goalie' }
];

/**
 * Get tags for a specific position
 * @param {string} position - Position ID (attacker, midfielder, defender, goalie)
 * @returns {Array} Array of tag objects for the position
 */
export function getTagsForPosition(position) {
  return soccerTags[position?.toLowerCase()] || [];
}

/**
 * Get all tags from all positions
 * @returns {Array} Array of all tag objects with position info
 */
export function getAllTags() {
  const allTags = [];
  for (const [positionId, tags] of Object.entries(soccerTags)) {
    for (const tag of tags) {
      allTags.push({ ...tag, position: positionId });
    }
  }
  return allTags;
}

/**
 * Soccer's own strings for prompts (T16320, owner ruling 2026-11-13). The
 * general rules and the ten general qualities live in generalQualities.js;
 * this holds only what belongs to soccer and is added to a prompt for soccer
 * athletes. Read it through tagRegistry (getQualities, getSportStrings).
 *
 * Quality names are stored identifiers once a game analysis has used them.
 * `positions` lists the position ids a quality is limited to; none means any.
 */
export const sportStrings = {
  qualities: [
    {
      name: "First Touch",
      meaning: "Receives so the next action is easy.",
      sign: "A driven or bouncing ball, or one received under pressure, is controlled in one touch that moves it away from the defender and into the next pass, shot or dribble.",
      routine: "A slow pass with nobody near; a touch that needs two more to tidy."
    },
    {
      name: "Passing Range",
      meaning: "Hits long or firm passes accurately.",
      sign: "A long pass that clears one or more lines of opponents and reaches a teammate's feet or stride; or a firm ground pass that goes between two defenders to a teammate.",
      routine: "Short sideways or backward passes under no pressure."
    },
    {
      name: "Finishing",
      meaning: "Scores or tests the goalkeeper with technique.",
      sign: "A shot placed in a corner or past a set goalkeeper, a volley or header on target, a calm finish one against one, or a goal from outside the penalty area.",
      routine: "A tap-in to an empty net; a shot straight at the goalkeeper."
    },
    {
      name: "Delivery",
      meaning: "Puts crosses and set pieces where teammates can score.",
      sign: "A cross, corner or free kick that reaches a teammate in the penalty area and leads to a shot or header.",
      routine: "Cleared by the first defender, or out of play."
    },
    {
      name: "Aerial Ability",
      meaning: "Wins the ball in the air.",
      sign: "The player jumps against an opponent and wins the header, to a teammate, clear of danger or on target.",
      routine: "An unchallenged header."
    },
    {
      name: "Shot Stopping",
      positions: ["goalie"],
      meaning: "Keeps out shots that should score.",
      sign: "A dive at full stretch, a reaction save from close range, a save one against one, or a second save straight after the first.",
      routine: "A slow shot hit straight at them."
    },
    {
      name: "Command of the Area",
      positions: ["goalie"],
      meaning: "Controls the penalty area and the space behind the defense.",
      sign: "The goalkeeper comes off the line to catch or punch a cross among players, or leaves the area early to clear a through ball.",
      routine: "Picking up a ball nobody is chasing."
    },
    {
      name: "Distribution",
      positions: ["goalie"],
      meaning: "Starts attacks with feet and hands.",
      sign: "A throw, kick or pass that reaches a teammate in stride beyond the first line of opponents; a calm pass out under pressure.",
      routine: "A long kick to nobody; a short roll to an unmarked defender."
    }
  ],

  // One line for each general quality, saying what it looks like in soccer.
  generalQualityExamples: {
    "Separation": "Runs away from a defender with or without the ball, catches an attacker who had a head start, or out-jumps an opponent for a header.",
    "Strength": "Shoulder to shoulder, stays up and comes away with the ball; or holds a defender off with the back to goal and plays a teammate in.",
    "Composure": "With a defender within reach, keeps the ball and passes or carries out instead of clearing it.",
    "Vision": "Plays through or over a line of defenders into a teammate's run, or switches play to the free side.",
    "Decision Making": "Squares to an unmarked teammate instead of shooting from a tight angle; releases in one or two touches before the press arrives.",
    "Anticipation": "Steps in to intercept the pass, or covers the space behind a beaten teammate before the attacker gets there.",
    "Work Rate": "After the ball is lost, sprints past jogging players to win it back or catch the attack; presses two or three times in a row and forces a turnover.",
    "Getting Open": "A run behind the last defender that stays onside and is found; an overlapping run that receives the pass.",
    "1v1 Attacking": "Goes past a set defender with a change of speed or direction or a feint, and it leads to a shot, cross or pass.",
    "1v1 Defending": "Stays on their feet, forces the attacker wide or backward, and wins the ball or blocks the cross or shot."
  },

  // The kinds of play that fill highlight videos of soccer's stars.
  socialExamples: "A goal from long range, a volley, an overhead or scissor kick, a diving header, a free kick into the top corner, a chip over the goalkeeper, the ball played through a defender's legs, a turn or skill move that leaves a defender behind, a run past several opponents, a full-stretch or double save, a penalty save, a clearance off the goal line, a goalkeeper scoring.",

  // What soccer coaches expect from a recruiting reel beyond the general rules.
  reelNotes: "Field players use game footage only. A goalkeeper's reel shows shot stopping, distribution and command of the area, and may add training footage for skills a game did not show. High, wide footage that shows the players around the athlete is preferred to a close-up."
};

