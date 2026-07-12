// Unit tests for the collection share unfurl tags (T4890 follow-up).
import { describe, it, expect } from 'vitest';
import { buildCollectionMetaTags, injectHeadTags } from './[token].js';

const API = 'https://api.example.com';

const data = {
  title: 'Top Plays',
  context_line: '5 reels',
  poster_url: '/api/shared/collection/tok123/poster.jpg',
  poster_width: 808,
  poster_height: 1440,
};

describe('buildCollectionMetaTags', () => {
  it('emits title, description, and absolutized og:image with dims', () => {
    const tags = buildCollectionMetaTags(data, API);
    expect(tags).toContain('property="og:title" content="Top Plays"');
    expect(tags).toContain('Top Plays - 5 reels - shared from Reel Ballers.');
    expect(tags).toContain(
      `property="og:image" content="${API}/api/shared/collection/tok123/poster.jpg"`
    );
    expect(tags).toContain('property="og:image:width" content="808"');
    expect(tags).toContain('property="og:image:height" content="1440"');
    expect(tags).toContain('name="twitter:card" content="summary_large_image"');
  });

  it('omits og:image and downgrades the card when no poster exists', () => {
    const tags = buildCollectionMetaTags({ title: 'Top Plays' }, API);
    expect(tags).not.toContain('og:image');
    expect(tags).toContain('name="twitter:card" content="summary"');
    // never an invalid player card
    expect(tags).not.toContain('content="player"');
  });

  it('escapes HTML in title/description', () => {
    const tags = buildCollectionMetaTags({ title: '<script>"x"' }, API);
    expect(tags).not.toContain('<script>');
    expect(tags).toContain('&lt;script&gt;&quot;x&quot;');
  });
});

describe('injectHeadTags', () => {
  it('injects before </head>', () => {
    const out = injectHeadTags('<html><head><title>t</title></head><body></body></html>', 'X');
    expect(out).toBe('<html><head><title>t</title>X</head><body></body></html>');
  });

  it('serves untouched HTML when no </head> exists (never corrupts)', () => {
    expect(injectHeadTags('<html>no head</html>', 'X')).toBe('<html>no head</html>');
  });
});
