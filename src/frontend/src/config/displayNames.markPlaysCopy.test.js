import { describe, it, expect } from 'vitest';
import * as names from './displayNames';

// T17170:C2: plays are any moment worth keeping (a great play or one to learn
// from), never only "great" ones. The four strings read exactly as the task wrote.
const { GUIDE, ANNOTATE, DIVISION_OF_WORK } = names;

describe('Mark plays copy (T17170:C2)', () => {
  it('the four strings read as written', () => {
    expect(GUIDE.annotate.watch.title).toBe(
      'Tap Play to watch the game. Tap Mark play at any moment worth keeping, a great play or one to learn from.'
    );
    expect(GUIDE.annotate.watchPlaying.title).toBe('See a play worth keeping? Tap Mark play.');
    expect(ANNOTATE.MODE_DESCRIPTION).toBe('Mark plays: tap Mark play right after a moment worth keeping.');
    expect(DIVISION_OF_WORK).toBe(
      'You mark the plays and frame your athlete. We smooth the motion, sharpen the picture, and build a highlight you can share.'
    );
  });

  it('no coach sentence or label says plays are only for great moments', () => {
    const strings = [];
    const walk = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(names);
    const offenders = strings.filter((s) =>
      /great play\?|does something great|right after a great|mark the best plays/i.test(s));
    expect(offenders).toEqual([]);
  });
});
