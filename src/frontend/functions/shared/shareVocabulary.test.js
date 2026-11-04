// T14660: every share page and unfurl uses one description format and the glossary words.
import { describe, it, expect } from 'vitest';
import { renderSharePage } from './[token].js';
import { renderGamePage } from './game/[token].js';
import { buildCollectionMetaTags } from './collection/[token].js';
import { buildTeammateMetaTags } from './teammate/[token].js';

const TAIL = ': shared from ReelBallers. Make your own highlights, free to start.';
const VIDEO = 'https://r2.example.com/x.mp4';
const RECAP = { recap_url: VIDEO, clips: [], clip_count: 0 };

function ogDescription(html) {
  const m = html.match(/og:description" content="([^"]*)"/);
  expect(m, 'og:description present').not.toBeNull();
  return m[1].replace(/&#39;/g, "'");
}

// Text a person reads or a crawler unfurls: scripts and styles removed, URLs kept out.
function shipped(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/(?:href|src)="[^"]*"/g, '');
}

const pages = [
  ['highlight', renderSharePage({ video_url: VIDEO, video_name: 'Top goal' }, '/'), 'Top goal'],
  ['game', renderGamePage({ ...RECAP, game_name: 'vs Riverside' }, 't'), 'vs Riverside'],
  ['game with sharer', renderGamePage({ ...RECAP, game_name: 'vs Riverside', sharer_name: 'Khan' }, 't'),
    "vs Riverside, filmed by Khan's family"],
  ['highlight reel', buildCollectionMetaTags({ title: 'My highlights (Portrait)', context_line: 'This link always shows the current top highlights.' }, 'https://api.x'),
    'My highlights (Portrait)'],
  ['teammate', buildTeammateMetaTags({ game_name: 'vs Legends', clip_count: 5 }, 'https://x.dev'), '5 plays from vs Legends'],
  ['teammate, one play', buildTeammateMetaTags({ game_name: 'vs Legends', clip_count: 1 }, 'https://x.dev'), '1 play from vs Legends'],
  ['teammate, no count', buildTeammateMetaTags({ game_name: 'vs Legends' }, 'https://x.dev'), 'Plays from vs Legends'],
];

describe('T14660 share page copy', () => {
  for (const [label, html, subject] of pages) {
    it(`${label}: description is "{title}: shared from ReelBallers..."`, () => {
      expect(ogDescription(html)).toBe(`${subject}${TAIL}`);
    });
  }

  it('escapes a sharer name once in the game description', () => {
    const html = renderGamePage({ ...RECAP, game_name: 'vs Riverside', sharer_name: "O'Neil" }, 't');
    expect(html).not.toContain('&amp;#39;');
    expect(ogDescription(html)).toContain("filmed by O'Neil's family");
  });

  it('writes the wordmark as ReelBallers', () => {
    expect(renderSharePage({ video_url: VIDEO, video_name: 'x' }, '/')).toContain('<span class="brand">ReelBallers</span>');
    expect(renderGamePage({ ...RECAP, game_name: 'x' }, 't')).toContain('<span class="brand">ReelBallers</span>');
  });

  it('an unnamed highlight falls back without doubling the brand', () => {
    const html = renderSharePage({ video_url: VIDEO }, '/');
    expect(html).toContain('<title>Highlight shared on ReelBallers</title>');
    expect(html).toContain('<h1>Highlight shared on ReelBallers</h1>');
    expect(ogDescription(html)).toBe(`Highlight${TAIL}`);
  });

  it('an unnamed game falls back without doubling the brand', () => {
    const html = renderGamePage(RECAP, 't');
    expect(html).toContain('<title>Game shared on ReelBallers</title>');
    expect(ogDescription(html)).toBe(`Game plays${TAIL}`);
    expect(buildTeammateMetaTags({}, 'https://x.dev')).toContain('og:title" content="Game shared on ReelBallers"');
  });

  it('game page says game plays and joins the date without a dash', () => {
    const html = renderGamePage({ ...RECAP, game_name: 'vs Riverside', game_date: '2026-03-03' }, 't');
    expect(html).toContain('<div class="attr">Game plays</div>');
    expect(html).toContain('<h1>vs Riverside, 2026-03-03</h1>');
    expect(html).toContain('>Add this game</a>');
  });

  it('an unnamed play on the game rail is a play', () => {
    const html = renderGamePage({ ...RECAP, game_name: 'x', clips: [{ recap_start: 0, recap_end: 4 }] }, 't');
    expect(html).toContain('<span class="rn">Play</span>');
  });

  it('teammate title names plays, not highlights', () => {
    const tags = buildTeammateMetaTags({ game_name: 'vs Legends', clip_count: 5 }, 'https://x.dev');
    expect(tags).toContain('og:title" content="vs Legends: shared plays"');
  });

  it('end card labels are sentence case and plain', () => {
    const html = renderSharePage({ video_url: VIDEO, video_name: 'x' }, '/');
    expect(html).toContain('>Made with<');
    expect(html).toContain('>Make your own highlights</a>');
  });

  for (const [label, html] of pages) {
    it(`${label}: no retired word reaches the reader`, () => {
      expect(shipped(html)).not.toMatch(/REEL BALLERS|recap|Make your own free|Shared Video|Shared Game| -- | - shared|Made With/);
    });
  }
});
