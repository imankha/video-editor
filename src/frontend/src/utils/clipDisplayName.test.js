import { describe, it, expect } from 'vitest';
import { generateClipName } from './clipDisplayName';

// T10690/T10710: raw_clips.rating is nullable now. generateClipName(null, tags)
// must mirror the backend's derive_clip_name(None, tags) exactly (T10700) —
// tag-only text, no adjective prepended. Today the adjective fallback
// (`RATING_ADJECTIVES[rating] || 'Interesting'`) silently invents "Interesting"
// for a null rating, which is exactly the coercion this task removes.
describe('generateClipName — unrated play (T10710)', () => {
  it('returns tag-only text with no adjective for a single tag', () => {
    expect(generateClipName(null, ['Goal'])).toBe('Goal');
  });

  it('returns tag-only text with no adjective for multiple tags', () => {
    expect(generateClipName(null, ['Goal', 'Dribble'])).toBe('Goal and Dribble');
  });

  it('never prepends "Interesting" or any other rating adjective', () => {
    const name = generateClipName(null, ['Goal']);
    expect(name).not.toMatch(/Interesting|Brilliant|Good|Technical Lapse|Mental Lapse/);
  });

  it('still returns empty string when there are no tags and no notes (unchanged)', () => {
    expect(generateClipName(null, [])).toBe('');
  });
});
