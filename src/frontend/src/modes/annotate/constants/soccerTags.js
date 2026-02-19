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
 * Rating adjectives for clip name generation
 */
export const ratingAdjectives = {
  5: 'Brilliant',
  4: 'Good',
  3: 'Interesting',
  2: 'Unfortunate',
  1: 'Bad'
};

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
 * Generate a clip name based on rating and selected tags
 * @param {number} rating - Star rating (1-5)
 * @param {Array} selectedTags - Array of selected tag names
 * @returns {string} Generated clip name
 */
export function generateClipName(rating, selectedTags) {
  if (!selectedTags || selectedTags.length === 0) {
    return '';
  }

  const adjective = ratingAdjectives[rating] || 'Interesting';

  // Join with "and" for multiple tags
  const tagPart = selectedTags.length === 1
    ? selectedTags[0]
    : selectedTags.slice(0, -1).join(', ') + ' and ' + selectedTags[selectedTags.length - 1];

  return `${adjective} ${tagPart}`;
}
