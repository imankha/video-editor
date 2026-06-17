import { soccerTags, positions as soccerPositions } from './soccerTags';
import { flagFootballTags, positions as flagFootballPositions } from './flagFootballTags';
import { footballTags, positions as footballPositions } from './footballTags';
import { basketballTags, positions as basketballPositions } from './basketballTags';
import { lacrosseTags, positions as lacrossePositions } from './lacrosseTags';
import { rugbyTags, positions as rugbyPositions } from './rugbyTags';
import { volleyballTags, positions as volleyballPositions } from './volleyballTags';
import { hockeyTags, positions as hockeyPositions } from './hockeyTags';
import { tennisTags, positions as tennisPositions } from './tennisTags';
import { baseballTags, positions as baseballPositions } from './baseballTags';

const TAG_SETS = {
  soccer: { positions: soccerPositions, tags: soccerTags },
  flag_football: { positions: flagFootballPositions, tags: flagFootballTags },
  american_football: { positions: footballPositions, tags: footballTags },
  basketball: { positions: basketballPositions, tags: basketballTags },
  lacrosse: { positions: lacrossePositions, tags: lacrosseTags },
  rugby: { positions: rugbyPositions, tags: rugbyTags },
  volleyball: { positions: volleyballPositions, tags: volleyballTags },
  hockey: { positions: hockeyPositions, tags: hockeyTags },
  tennis: { positions: tennisPositions, tags: tennisTags },
  baseball: { positions: baseballPositions, tags: baseballTags },
};

const DEFAULT_SPORT = 'soccer';

export const SUPPORTED_SPORTS = [
  { id: 'soccer', name: 'Soccer' },
  { id: 'flag_football', name: 'Flag Football' },
  { id: 'american_football', name: 'American Football' },
  { id: 'basketball', name: 'Basketball' },
  { id: 'lacrosse', name: 'Lacrosse' },
  { id: 'rugby', name: 'Rugby' },
  { id: 'volleyball', name: 'Volleyball' },
  { id: 'hockey', name: 'Hockey' },
  { id: 'tennis', name: 'Tennis' },
  { id: 'baseball', name: 'Baseball' },
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

// Emoji glyph per sport — lucide-react lacks ball icons for most sports, so a
// literal ball reads far better as the "current sport" indicator in the header.
// Keyed by stored sport id; custom ("Other") sports fall back to the medal.
const SPORT_EMOJI = {
  soccer: '⚽',            // ⚽
  flag_football: '🏈', // 🏈
  american_football: '🏈', // 🏈
  basketball: '🏀', // 🏀
  lacrosse: '🥍',   // 🥍
  rugby: '🏉',      // 🏉
  volleyball: '🏐', // 🏐
  hockey: '🏒',     // 🏒
  tennis: '🎾',     // 🎾
  baseball: '⚾',         // ⚾
};

export function sportEmoji(sport) {
  return SPORT_EMOJI[sport] || '🏅'; // 🏅 fallback for custom sports
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

export function getAllSupportedTagNames() {
  const names = new Set();
  for (const sportData of Object.values(TAG_SETS)) {
    for (const tags of Object.values(sportData.tags)) {
      for (const tag of tags) {
        names.add(tag.name);
      }
    }
  }
  return names;
}

export { DEFAULT_SPORT };
