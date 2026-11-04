import { describe, it, expect } from 'vitest';
import { getClipDisplayName } from './clipDisplayName';
import {
  RATING_ADJECTIVES,
  getEditRatingCaption,
  getRatingCaption,
  getRatingLabel,
} from '../components/shared/clipConstants';

// T14550: rating words stay out of default play names, and the two low ratings read
// as "Needs work" rather than coach jargon.
describe('default play names carry no rating word', () => {
  it.each([1, 2, 3, 4, 5])('names a %i-star play from its tags alone', (rating) => {
    expect(getClipDisplayName({ rating, tags: ['Dribble'], notes: '' })).toBe('Dribble');
    expect(getClipDisplayName({ rating, tags: ['Goal', 'Assist'], notes: '' })).toBe('Goal and Assist');
  });

  it('names a tagless play by its time', () => {
    expect(getClipDisplayName({ rating: 1, tags: [], notes: '', startTime: 750 })).toBe('Play at 12:30');
  });

  it('uses the file time of a virtual region, matching the name the backend stores', () => {
    const region = { rating: 4, tags: [], notes: '', startTime: 3750, _actualStartTime: 750 };
    expect(getClipDisplayName(region)).toBe('Play at 12:30');
  });

  it('prefers notes over the time', () => {
    expect(getClipDisplayName({ rating: 2, tags: [], notes: 'Nice run', startTime: 750 })).toBe('Nice run');
  });

  it('keeps a stored name', () => {
    expect(getClipDisplayName({ name: "Ava's header", rating: 1, tags: ['Goal'] })).toBe("Ava's header");
  });

  it('uses the fallback when a play has no tags, notes or time', () => {
    expect(getClipDisplayName({ rating: 3, tags: [], notes: '' }, 'Play 2')).toBe('Play 2');
  });
});

describe('rating words', () => {
  it('reads Needs work for the low ratings and Brilliant at the top', () => {
    expect(RATING_ADJECTIVES[1]).toBe('Needs work: decision');
    expect(RATING_ADJECTIVES[2]).toBe('Needs work: skill');
    expect(RATING_ADJECTIVES[5]).toBe('Brilliant');
    expect(getRatingLabel(1)).toBe('1 star · Needs work: decision');
  });

  it.each([
    [1, 'Needs work: decision - a play to learn from.'],
    [2, 'Needs work: skill - a play to learn from.'],
  ])('captions a %i-star play with Needs work in both editors', (rating, caption) => {
    expect(getRatingCaption(rating, true, false)).toBe(caption);
    expect(getEditRatingCaption(rating, true, false)).toBe(caption);
  });
});
