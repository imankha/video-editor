import { describe, it, expect } from 'vitest';
import { generateClipName } from './clipDisplayName';

describe('generateClipName', () => {
  it('ignores the rating, so a null-rated play reads like any other', () => {
    expect(generateClipName({ rating: null, tags: ['Goal'] })).toBe('Goal');
    expect(generateClipName({ rating: null, tags: ['Goal', 'Dribble'] })).toBe('Goal and Dribble');
  });

  it('still returns empty string when there are no tags, notes or time', () => {
    expect(generateClipName({ rating: null, tags: [] })).toBe('');
  });
});
