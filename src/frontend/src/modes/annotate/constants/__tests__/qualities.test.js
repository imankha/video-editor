import { describe, it, expect } from 'vitest';
import {
  BRILLIANT_BAR,
  BRILLIANT_FOR_SCOUTING,
  BRILLIANT_FOR_SOCIAL,
  LEARNING_OPPORTUNITY,
  QUALITY_SCOPE,
  generalQualities,
} from '../generalQualities';
import {
  SUPPORTED_SPORTS,
  getPositions,
  getQualities,
  getQualityNames,
  getSportStrings,
} from '../tagRegistry';

// T16320: the quality list is general first (owner ruling 2026-11-13). The
// general part is written for any sport; a sport's own wording lives in its
// `sportStrings`, beside its tags, and is injected into prompts for that sport.

const GENERAL_NAMES = generalQualities.map(q => q.name);

// Words that would make the general part belong to one sport. The general
// part is sent to the model for every sport, so none of these may appear.
const SPORT_SPECIFIC = /soccer|goalkeeper|goalie|penalty|offside|yard|header|puck|dunk|touchdown|ball\b/i;

// A sign must be something a camera can show: what the player does relative
// to another player in the frame (owner ruling 2026-11-13). So every sign
// names another player, and nothing leans on a measurement video cannot make
// or on what the player sees or feels.
const ANOTHER_PLAYER = /opponent|defender|attacker|marker|teammate/i;
const NOT_VISIBLE = /\b(pace|fast|faster|mph|calm|sees|looks|reads|thinks)\b|\d+ ?(yards?|feet|meters?|metres?)\b/i;

describe('general qualities (T16320)', () => {
  it('has ten uniquely named qualities, each fully described', () => {
    expect(generalQualities).toHaveLength(10);
    expect(new Set(GENERAL_NAMES).size).toBe(10);
    for (const q of generalQualities) {
      expect(q.meaning, q.name).toBeTruthy();
      expect(q.sign, q.name).toBeTruthy();
      expect(q.routine, q.name).toBeTruthy();
    }
  });

  it('names no sport in the general part', () => {
    const general = [
      BRILLIANT_BAR,
      BRILLIANT_FOR_SCOUTING,
      BRILLIANT_FOR_SOCIAL,
      LEARNING_OPPORTUNITY,
      ...generalQualities.flatMap(q => [q.meaning, q.sign, q.routine]),
    ];
    for (const text of general) {
      expect(text).not.toMatch(SPORT_SPECIFIC);
    }
  });

  it('describes every sign relative to another player, in terms video can show', () => {
    expect(GENERAL_NAMES).toContain('Separation');
    expect(GENERAL_NAMES).not.toContain('Pace');
    for (const q of generalQualities) {
      expect(q.sign, q.name).toMatch(ANOTHER_PLAYER);
      expect(`${q.name} ${q.meaning} ${q.sign}`, q.name).not.toMatch(NOT_VISIBLE);
    }
  });

  it('states the one bar and both ways to clear it', () => {
    expect(BRILLIANT_BAR).toMatch(/better than a good player at that level/);
    expect(BRILLIANT_FOR_SCOUTING).toMatch(/decision/);
    expect(BRILLIANT_FOR_SCOUTING).toMatch(/execution/);
    expect(BRILLIANT_FOR_SOCIAL).toMatch(/favorite players/);
    expect(LEARNING_OPPORTUNITY).toMatch(/never Brilliant/);
  });
});

describe('sport strings (T16320)', () => {
  it('a sport with no strings runs on the general part alone', () => {
    expect(getSportStrings('basketball')).toBeNull();
    const names = getQualities('basketball').map(q => q.name);
    expect(names).toEqual(GENERAL_NAMES);
    expect(getQualities('basketball').every(q => q.scope === QUALITY_SCOPE.GENERAL)).toBe(true);
  });

  it('a custom sport the app has no tags for still gets the general part', () => {
    expect(getQualities('Underwater Hockey').map(q => q.name)).toEqual(GENERAL_NAMES);
  });

  it('soccer adds eight of its own to the ten general ones', () => {
    const all = getQualities('soccer');
    expect(all).toHaveLength(18);
    expect(getQualityNames('soccer').size).toBe(18);
    const own = all.filter(q => q.scope === QUALITY_SCOPE.SPORT).map(q => q.name);
    expect(own).toEqual([
      'First Touch',
      'Passing Range',
      'Finishing',
      'Delivery',
      'Aerial Ability',
      'Shot Stopping',
      'Command of the Area',
      'Distribution',
    ]);
  });

  it('soccer says every general quality in its own words', () => {
    const general = getQualities('soccer').filter(q => q.scope === QUALITY_SCOPE.GENERAL);
    expect(general.map(q => q.name)).toEqual(GENERAL_NAMES);
    for (const q of general) {
      expect(q.example, q.name).toBeTruthy();
    }
    expect(Object.keys(getSportStrings('soccer').generalQualityExamples).sort())
      .toEqual([...GENERAL_NAMES].sort());
    for (const text of Object.values(getSportStrings('soccer').generalQualityExamples)) {
      expect(text).not.toMatch(NOT_VISIBLE);
    }
  });

  it('soccer carries its social examples and reel notes', () => {
    const strings = getSportStrings('soccer');
    expect(strings.socialExamples).toBeTruthy();
    expect(strings.reelNotes).toBeTruthy();
  });

  // Holds for every sport that gains strings later, not only soccer.
  it.each(SUPPORTED_SPORTS.map(s => s.id))('%s: strings, when present, are well formed', (sport) => {
    const strings = getSportStrings(sport);
    if (!strings) return;
    const positionIds = new Set(getPositions(sport).map(p => p.id));
    const ownNames = (strings.qualities || []).map(q => q.name);
    expect(new Set(ownNames).size).toBe(ownNames.length);
    for (const q of strings.qualities || []) {
      expect(GENERAL_NAMES, `${sport} redefines general quality ${q.name}`).not.toContain(q.name);
      expect(q.meaning && q.sign && q.routine, q.name).toBeTruthy();
      for (const pos of q.positions || []) {
        expect(positionIds.has(pos), `${sport} quality ${q.name} names unknown position ${pos}`).toBe(true);
      }
    }
    for (const name of Object.keys(strings.generalQualityExamples || {})) {
      expect(GENERAL_NAMES, `${sport} gives an example for unknown general quality ${name}`).toContain(name);
    }
    for (const name of strings.generalQualities || []) {
      expect(GENERAL_NAMES).toContain(name);
    }
  });
});
