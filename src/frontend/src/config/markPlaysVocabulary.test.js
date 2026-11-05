// T14610: Mark plays copy follows the copy glossary (.claude/references/copy-glossary.md).
// A marked moment is a "play"; never moment / clip / annotation / layer / footage / angle.
import { describe, it, expect } from 'vitest';
import { ANNOTATE, RECAP, LIBRARY_ACTIONS, GUIDE } from './displayNames';
import { RATING_ADJECTIVES } from '../components/shared/clipConstants';
import { CLIP_SYNC_FAILED_COPY } from '../hooks/useRawClipSave';

const BANNED = /\b(clips?|moments?|annotations?|layers?|footage|angles?|fix timing|drafts?|recaps?|click|failed to|could not|cloud|submit)\b/i;

const flatten = (obj) => Object.values(obj).flatMap((v) => {
  if (typeof v === 'string') return [v];
  if (typeof v === 'function') return [v('Video 2', 2)];
  if (v && typeof v === 'object') return flatten(v);
  return [];
});

describe('T14610 Mark plays copy', () => {
  it('T14610:C1 play-save failures say "play", in the one error voice', () => {
    const messages = Object.values(CLIP_SYNC_FAILED_COPY).map((c) => c.message);
    expect(CLIP_SYNC_FAILED_COPY.save.message).toBe("We couldn't save your play. Try again.");
    expect(CLIP_SYNC_FAILED_COPY.delete.message).toBe("We couldn't delete your play. Try again.");
    for (const m of messages) {
      expect(m).not.toMatch(/highlight/i);
      expect(m).toMatch(/play/);
    }
  });

  it('T14610:C2 game plays modal labels', () => {
    expect(RECAP?.TITLE).toBe('Game plays');
    expect(RECAP?.TEAM_TAB).toBe('Team plays');
    expect(RECAP?.athleteTab?.('Maya')).toBe("Maya's plays");
    expect(RECAP?.athleteTab?.('')).toBe("My athlete's plays");
    expect(RECAP?.MAKE_HIGHLIGHT).toBe('Make highlight');
    expect(RECAP?.ADDED_TO_PLAYS).toBe('Added to Plays');
    expect(ANNOTATE.PREVIEW_PLAYS).toBe('Watch plays');
    expect(flatten(RECAP || {}).filter((s) => BANNED.test(s))).toEqual([]);
  });

  it('T14610:C3 the 5-star label is "Brilliant", never "Highlight"', () => {
    expect(RATING_ADJECTIVES[5]).toBe('Brilliant');
    expect(Object.values(RATING_ADJECTIVES)).not.toContain('Highlight');
  });

  it('T14610:C4 team / my athlete filters and empty states never say layer', () => {
    expect(ANNOTATE.FILTER_MINE).toBe("My athlete's plays");
    expect(ANNOTATE.FILTER_TEAM).toBe('Team plays');
    expect(ANNOTATE.NO_MINE_PLAYS).toBe('No plays for your athlete yet');
    expect(ANNOTATE.NO_TEAM_PLAYS).toBe('No team plays yet');
  });

  it('T14610:C5 one details heading, one name placeholder, extra video words', () => {
    expect(ANNOTATE.DETAILS).toBe('Details');
    expect(ANNOTATE.NAME_PLACEHOLDER).toBe('Name this play');
    expect(LIBRARY_ACTIONS.ADD_FOOTAGE).toBe('Add video');
    expect(ANNOTATE.LINE_UP_VIDEO).toBe('Line up this video with the game');
  });

  it('T14610:C6 no retired word anywhere in Mark plays copy', () => {
    const strings = [
      ...flatten(ANNOTATE).filter((s) => !/^(Delete|Rename) highlight$|^Highlight name$/.test(s)),
      LIBRARY_ACTIONS.ADD_FOOTAGE,
      ...flatten(GUIDE.annotate),
      GUIDE.modal.attachVideoChoose, GUIDE.modal.attachVideoSubmit,
    ];
    expect(strings.filter((s) => BANNED.test(s))).toEqual([]);
  });
});
