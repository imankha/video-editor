import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_SPORTS,
  getTagSet,
  getPositions,
  getAllTagNames,
  sportEmoji,
  sportDisplayName,
  sportStoredValue,
  NO_SPORT,
  NO_SPORT_LABEL,
} from '../tagRegistry';

// Mirror of the backend's CURATED_COMBOS tag names
// (src/backend/app/routers/collections.py). The backend matches reel tags by
// EXACT name, so if a frontend tag is renamed out from under a curated combo
// the combo silently stops working -- this guard fails loudly instead.
const CURATED_COMBO_TAGS = {
  soccer: [['Goal', 'Assist']],
  basketball: [['Scoring', 'Dunk'], ['Scoring', 'Assist']],
  american_football: [
    ['Touchdown Pass', 'Touchdown Catch', 'Touchdown Run'],
    ['Sack', 'Interception', 'Forced Fumble'],
  ],
  flag_football: [['Touchdown Pass', 'Touchdown Catch'], ['Sack', 'Interception']],
  lacrosse: [['Goal', 'Assist']],
  rugby: [['Try', 'Line Break']],
  volleyball: [['Kill', 'Ace'], ['Dig', 'Block']],
  hockey: [['Goal', 'Assist'], ['Goal', 'Save']],
  tennis: [['Ace', 'Forehand Winner', 'Backhand Winner']],
  baseball: [['Home Run', 'Hit'], ['Strikeout', 'Double Play']],
  softball: [['Home Run', 'Hit'], ['Strikeout', 'Double Play']],
};

describe('tag registry — all supported sports', () => {
  it('every sport resolves to a tag set with positions, each position non-empty', () => {
    for (const { id } of SUPPORTED_SPORTS) {
      const set = getTagSet(id);
      expect(set, `sport "${id}" has no tag set`).toBeTruthy();
      const positions = getPositions(id);
      expect(positions.length, `sport "${id}" has no positions`).toBeGreaterThan(0);
      for (const pos of positions) {
        expect(
          set.tags[pos.id]?.length,
          `sport "${id}" position "${pos.id}" has no tags`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('every tag has a name + description, and names are unique within a sport', () => {
    for (const { id } of SUPPORTED_SPORTS) {
      const flat = Object.values(getTagSet(id).tags).flat();
      expect(flat.every((t) => t.name && t.description), `sport "${id}" has a tag missing name/description`).toBe(true);
      const names = flat.map((t) => t.name);
      expect(names.length, `sport "${id}" has duplicate tag names`).toBe(new Set(names).size);
    }
  });

  it('maps every supported sport to a glyph, with a fallback for custom sports', () => {
    expect(sportEmoji('soccer')).toBe('⚽');
    expect(sportEmoji('volleyball')).toBe('🏐');
    expect(sportEmoji('baseball')).toBe('⚾');
    for (const { id } of SUPPORTED_SPORTS) {
      expect(sportEmoji(id).length, `sport "${id}" has no glyph`).toBeGreaterThan(0);
    }
    // custom ("Other") sports and missing values fall back to the medal
    expect(sportEmoji('cricket')).toBe('🏅');
    expect(sportEmoji(undefined)).toBe('🏅');
  });

  it('treats the no_sport sentinel as a tagless, non-supported sport (T7850)', () => {
    // Never chosen: not in SUPPORTED_SPORTS, resolves to no tag set (same as
    // any unknown sport) so the Add Clip UI shows the warning branch.
    expect(SUPPORTED_SPORTS.some((s) => s.id === NO_SPORT)).toBe(false);
    expect(getTagSet(NO_SPORT)).toBeNull();
    // Round-trips through the display <-> stored helpers used by the profile form.
    expect(sportDisplayName(NO_SPORT)).toBe(NO_SPORT_LABEL);
    expect(sportStoredValue(NO_SPORT_LABEL)).toBe(NO_SPORT);
    // Its glyph is distinct from both a real sport's ball and the custom medal.
    expect(sportEmoji(NO_SPORT)).not.toBe('🏅');
  });

  it('every backend curated-combo tag exists in the sport (cross-language guard)', () => {
    // The four new sports plus every existing one must be covered.
    expect(Object.keys(CURATED_COMBO_TAGS).sort()).toEqual(
      SUPPORTED_SPORTS.map((s) => s.id).sort(),
    );
    for (const [sport, combos] of Object.entries(CURATED_COMBO_TAGS)) {
      const names = getAllTagNames(sport);
      for (const combo of combos) {
        for (const tag of combo) {
          expect(names.has(tag), `sport "${sport}": curated tag "${tag}" not in registry`).toBe(true);
        }
      }
    }
  });

  // T8490: the soccer goalie "Save" tag reads ambiguous next to the form's own
  // real Save button, so the GRID DISPLAY was renamed to "Keeper Save". The
  // stored/identity value stays "Save" (unchanged) so existing clips tagged
  // "Save" still match, and the backend curated-combo exact-name match (the
  // guard above) is untouched.
  it('the soccer "Save" tag keeps its stored name but carries a displayName for the grid', () => {
    const saveTag = getTagSet('soccer').tags.goalie.find((t) => t.name === 'Save');
    expect(saveTag, 'soccer goalie tag set must still contain a tag with stored name "Save"').toBeTruthy();
    expect(saveTag.displayName).toBe('Keeper Save');
    // Identity (toggle/selectedTags matching) is by name, not displayName.
    expect(getAllTagNames('soccer').has('Save')).toBe(true);
    expect(getAllTagNames('soccer').has('Keeper Save')).toBe(false);
  });
});
