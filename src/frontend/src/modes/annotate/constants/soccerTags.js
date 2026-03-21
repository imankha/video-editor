import { RATING_ADJECTIVES } from '../../../components/shared/clipConstants';

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
 * Generate a clip name from notes, falling back to rating+tags.
 *
 * Priority:
 *  1. Note fits as a title (≤ 40 chars) → use it verbatim
 *  2. Note is longer → truncate to first ~40 chars at a word boundary
 *  3. No note → "Adjective Tag1 and Tag2" from rating + tags
 *
 * @param {number} rating - Star rating (1-5)
 * @param {Array} selectedTags - Array of selected tag names
 * @param {string} notes - Optional clip notes
 * @returns {string} Generated clip name
 */
export function generateClipName(rating, selectedTags, notes = '') {
  const MAX_TITLE_LENGTH = 40;

  // Notes take priority over tags
  if (notes && notes.trim()) {
    const trimmed = notes.trim();
    if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;

    // Truncate at word boundary
    const words = trimmed.split(/\s+/);
    let result = words[0];
    for (let i = 1; i < words.length; i++) {
      const next = result + ' ' + words[i];
      if (next.length > MAX_TITLE_LENGTH) break;
      result = next;
    }
    return result;
  }

  // Fallback: rating + tags
  if (!selectedTags || selectedTags.length === 0) return '';

  const adjective = RATING_ADJECTIVES[rating] || 'Interesting';
  const tagPart = selectedTags.length === 1
    ? selectedTags[0]
    : selectedTags.slice(0, -1).join(', ') + ' and ' + selectedTags[selectedTags.length - 1];

  return `${adjective} ${tagPart}`;
}
