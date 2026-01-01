/**
 * Soccer tags organized by position for clip tagging
 */
export const soccerTags = {
  attacker: [
    {
      name: "Goals",
      shortName: "Goal",
      description: "All types of finishes in scoring situations."
    },
    {
      name: "Assists",
      shortName: "Assist",
      description: "Final pass that leads directly to a goal."
    },
    {
      name: "Dribbling",
      shortName: "Dribble",
      description: "Beating defenders in individual attacking duels."
    },
    {
      name: "Movement Off Ball",
      shortName: "Movement",
      description: "Smart runs and positioning that create scoring chances."
    }
  ],

  midfielder: [
    {
      name: "Passing Range",
      shortName: "Pass",
      description: "Short, long, and line-breaking passes to advance play."
    },
    {
      name: "Chance Creation",
      shortName: "Chance Creation",
      description: "Key passes that set up opportunities for teammates."
    },
    {
      name: "Possession Play",
      shortName: "Possession",
      description: "Maintaining control under pressure with good touches."
    },
    {
      name: "Transitions",
      shortName: "Transition",
      description: "Quick turnover play in attack or defense."
    }
  ],

  defender: [
    {
      name: "Tackles",
      shortName: "Tackle",
      description: "Clean defensive challenges that win the ball."
    },
    {
      name: "Interceptions",
      shortName: "Interception",
      description: "Reading and winning possession before the opponent."
    },
    {
      name: "1v1 Defense",
      shortName: "1v1 Defense",
      description: "Stopping opponents in one-on-one defensive duels."
    },
    {
      name: "Build-Up Passing",
      shortName: "Build-Up",
      description: "Accurate passes from the back that start attacks."
    }
  ],

  goalie: [
    {
      name: "Shot Stopping",
      shortName: "Save",
      description: "Saves that prevent goals in close or long-range chances."
    },
    {
      name: "Command of Area",
      shortName: "Command",
      description: "Collecting crosses and controlling the penalty area."
    },
    {
      name: "Distribution",
      shortName: "Distribution",
      description: "Accurate throws and kicks to start counterattacks."
    },
    {
      name: "1v1 Saves",
      shortName: "1v1 Save",
      description: "Stopping attackers in one-on-one scenarios."
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
 * Find a tag by name across all positions
 * @param {string} tagName - Tag name to find
 * @returns {Object|null} Tag object or null
 */
export function findTagByName(tagName) {
  for (const tags of Object.values(soccerTags)) {
    const tag = tags.find(t => t.name === tagName);
    if (tag) return tag;
  }
  return null;
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

  // Get short names for selected tags (search all positions)
  const shortNames = selectedTags.map(tagName => {
    const tag = findTagByName(tagName);
    return tag?.shortName || tagName;
  });

  // Join with "and" for multiple tags
  const tagPart = shortNames.length === 1
    ? shortNames[0]
    : shortNames.slice(0, -1).join(', ') + ' and ' + shortNames[shortNames.length - 1];

  return `${adjective} ${tagPart}`;
}
