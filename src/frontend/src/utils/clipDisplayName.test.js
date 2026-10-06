import { describe, it, expect } from 'vitest';
import { generateClipName } from './clipDisplayName';

// Legacy null rating is displayed as Good (display only, never persisted).
describe('generateClipName - legacy null rating', () => {
  it('names a null-rated play as if it were Good', () => {
    expect(generateClipName(null, ['Goal'])).toBe(generateClipName(4, ['Goal']));
    expect(generateClipName(null, ['Goal', 'Dribble'])).toBe(generateClipName(4, ['Goal', 'Dribble']));
  });

  it('still returns empty string when there are no tags and no notes', () => {
    expect(generateClipName(null, [])).toBe('');
  });
});
