import { soccerTags, positions as soccerPositions } from './soccerTags';

const TAG_SETS = {
  soccer: { positions: soccerPositions, tags: soccerTags },
};

const DEFAULT_SPORT = 'soccer';

export function getTagSet(sport) {
  return TAG_SETS[sport] || null;
}

export function getPositions(sport) {
  return getTagSet(sport)?.positions || [];
}

export function getTagsForPosition(sport, positionId) {
  return getTagSet(sport)?.tags[positionId] || [];
}

export function getAllTags(sport) {
  const set = getTagSet(sport);
  if (!set) return [];
  const all = [];
  for (const [posId, tags] of Object.entries(set.tags)) {
    for (const tag of tags) {
      all.push({ ...tag, position: posId });
    }
  }
  return all;
}

export function getAllTagNames(sport) {
  return new Set(getAllTags(sport).map(t => t.name));
}

export { DEFAULT_SPORT };
