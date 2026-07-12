// Unit tests for teammate (game) share unfurl tags (T4890 follow-up).
import { describe, it, expect } from 'vitest';
import { buildTeammateMetaTags } from './[token].js';

const ORIGIN = 'https://reel-ballers-staging.pages.dev';

describe('buildTeammateMetaTags', () => {
  it('emits game title, clip-count description, and the branded card image', () => {
    const tags = buildTeammateMetaTags(
      { game_name: 'vs Legends Mar 28', clip_count: 5, sharer_email: 'secret@example.com' },
      ORIGIN
    );
    expect(tags).toContain('og:title" content="vs Legends Mar 28 - shared highlights"');
    expect(tags).toContain('5 highlight clips from vs Legends Mar 28');
    expect(tags).toContain(`og:image" content="${ORIGIN}/og-card.jpg"`);
    expect(tags).toContain('twitter:card" content="summary_large_image"');
  });

  it('never leaks the sharer email into the unfurl', () => {
    const tags = buildTeammateMetaTags(
      { game_name: 'vs Legends', clip_count: 2, sharer_email: 'secret@example.com' },
      ORIGIN
    );
    expect(tags).not.toContain('secret@example.com');
  });

  it('singular clip wording and HTML escaping', () => {
    const tags = buildTeammateMetaTags({ game_name: '<b>x</b>', clip_count: 1 }, ORIGIN);
    expect(tags).toContain('1 highlight clip from');
    expect(tags).not.toContain('<b>');
  });
});
