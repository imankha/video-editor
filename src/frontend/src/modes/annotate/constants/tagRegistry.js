import { soccerTags, positions as soccerPositions } from './soccerTags';

const TAG_SETS = {
  soccer: { positions: soccerPositions, tags: soccerTags },
};

const DEFAULT_SPORT = 'soccer';

export const SUPPORTED_SPORTS = [
  { id: 'soccer', name: 'Soccer' },
  { id: 'flag_football', name: 'Flag Football' },
  { id: 'american_football', name: 'American Football' },
  { id: 'basketball', name: 'Basketball' },
  { id: 'lacrosse', name: 'Lacrosse' },
  { id: 'rugby', name: 'Rugby' },
];

export function sportDisplayName(storedValue) {
  if (!storedValue) return '';
  const match = SUPPORTED_SPORTS.find(s => s.id === storedValue);
  return match ? match.name : storedValue;
}

export function sportStoredValue(displayName) {
  if (!displayName) return '';
  const match = SUPPORTED_SPORTS.find(s => s.name.toLowerCase() === displayName.toLowerCase());
  return match ? match.id : displayName;
}

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
