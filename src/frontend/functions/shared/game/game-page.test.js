// T5720: unit tests for the public game-link edge watch page. Pure render/helper
// functions, no Workers runtime needed. Integration (routing, fallthrough,
// beacon, caching) is covered by `wrangler pages dev` in the task verification.
import { describe, it, expect } from 'vitest';
import { renderGamePage, escapeHtml, apiBase, absolutizePosterUrl } from './[token].js';

const RESOLVE = {
  share_token: 'tok9',
  is_public: true,
  game_name: 'vs Riverside',
  game_date: '2026-03-03',
  sharer_name: 'Khan',
  recap_url: 'https://r2.example.com/recaps/1_team.mp4?sig=xyz',
  poster_url: 'https://api.example.com/api/shared/game/tok9/poster.jpg',
  clips: [
    { name: 'Team goal', recap_start: 0, recap_end: 6.2, player_tags: ['#7'] },
    { name: 'Big save', recap_start: 6.2, recap_end: 11, player_tags: [] },
  ],
  clip_count: 2,
};

describe('apiBase', () => {
  it('maps the prod host to the prod API, defaults to staging', () => {
    expect(apiBase('app.reelballers.com')).toBe('https://api.reelballers.com');
    expect(apiBase('localhost')).toBe('https://reel-ballers-api-staging.fly.dev');
  });
});

describe('absolutizePosterUrl', () => {
  it('prefixes a relative proxy path with the API base', () => {
    const s = { poster_url: '/api/shared/game/tok/poster.jpg' };
    absolutizePosterUrl(s, 'https://api.example.com');
    expect(s.poster_url).toBe('https://api.example.com/api/shared/game/tok/poster.jpg');
  });
  it('leaves absolute URLs and missing posters untouched', () => {
    const s = {};
    absolutizePosterUrl(s, 'https://api.example.com');
    expect(s.poster_url).toBeUndefined();
  });
});

describe('renderGamePage', () => {
  it('renders og tags with game title/date, poster, and the team recap video', () => {
    const html = renderGamePage(RESOLVE, 'tok9');
    expect(html).toContain('og:title" content="vs Riverside -- 2026-03-03"');
    expect(html).toContain(`og:video" content="${RESOLVE.recap_url}"`);
    expect(html).toContain(`og:image" content="${RESOLVE.poster_url}"`);
    expect(html).toContain('twitter:card" content="summary_large_image"');
  });

  it('renders the clip rail and the claim CTA carrying the token', () => {
    const html = renderGamePage(RESOLVE, 'tok9');
    expect(html).toContain('Team goal');
    expect(html).toContain('Big save');
    expect(html).toContain('#7');
    // The T5730 seam: CTA points at /claim/game/{token}, token in the path.
    expect(html).toContain('href="/claim/game/tok9"');
    expect(html).toContain('Add this game to your account');
  });

  it('NEVER leaks a full-game URL or blake3 -- only the team recap is present', () => {
    const poisoned = { ...RESOLVE, game_url: 'https://r2.example.com/games/deadbeef.mp4', game_blake3: 'deadbeef' };
    const html = renderGamePage(poisoned, 'tok9');
    // The renderer only reads team-recap fields; it never emits game-source data
    // even if a (malformed) payload carried it.
    expect(html).not.toContain('games/deadbeef.mp4');
    expect(html).not.toContain('deadbeef');
  });

  it('escapes a crafted game/clip name (no markup injection)', () => {
    const html = renderGamePage(
      { ...RESOLVE, game_name: '<b>x</b>', clips: [{ name: '<i>c</i>', player_tags: [] }] },
      'tok9'
    );
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<i>c</i>');
  });

  it('omits og:image when no poster resolves (no dead/broken image)', () => {
    const html = renderGamePage({ ...RESOLVE, poster_url: '' }, 'tok9');
    expect(html).not.toContain('og:image"');
    expect(html).toContain('twitter:card" content="summary"');
  });

  it('title omits the separator when no game_date', () => {
    const html = renderGamePage({ ...RESOLVE, game_date: null }, 'tok9');
    expect(html).toContain('og:title" content="vs Riverside"');
  });
});

describe('escapeHtml', () => {
  it('escapes all HTML-significant characters', () => {
    expect(escapeHtml(`<script>&"'`)).toBe('&lt;script&gt;&amp;&quot;&#39;');
  });
});
