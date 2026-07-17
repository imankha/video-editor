// Unit tests for teammate (game) share unfurl tags (T4890 follow-up).
import { describe, it, expect } from 'vitest';
import { buildTeammateMetaTags } from './[token].js';

const ORIGIN = 'https://reel-ballers-staging.pages.dev';
const API = 'https://reel-ballers-staging.fly.dev';

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

  it('uses the recap poster (absolutized via API base) when the backend resolves one', () => {
    const tags = buildTeammateMetaTags(
      { game_name: 'vs Legends', clip_count: 3, poster_url: '/api/shared/teammate/tok9/poster.jpg' },
      ORIGIN,
      API
    );
    // og:image is the token-gated proxy on the API origin, NOT the branded card.
    expect(tags).toContain(`og:image" content="${API}/api/shared/teammate/tok9/poster.jpg"`);
    expect(tags).toContain(`twitter:image" content="${API}/api/shared/teammate/tok9/poster.jpg"`);
    expect(tags).not.toContain('/og-card.jpg');
    // Recap dims unknown at tag time -> no width/height tags.
    expect(tags).not.toContain('og:image:width');
  });

  it('falls back to the branded card (with dims) when no recap poster resolves', () => {
    const tags = buildTeammateMetaTags(
      { game_name: 'vs Legends', clip_count: 3, poster_url: null },
      ORIGIN,
      API
    );
    expect(tags).toContain(`og:image" content="${ORIGIN}/og-card.jpg"`);
    expect(tags).toContain('og:image:width" content="1200"');
    expect(tags).toContain('og:image:height" content="630"');
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
