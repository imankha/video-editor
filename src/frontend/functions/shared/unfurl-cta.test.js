// T8450: every unfurl description carries a soft CTA, appended AFTER the who/what so
// messaging-app truncation (~90-120 chars) cuts marketing copy before the essential part.
import { describe, it, expect } from 'vitest';
import { renderSharePage } from './[token].js';
import { renderGamePage } from './game/[token].js';
import { buildCollectionMetaTags } from './collection/[token].js';
import { buildTeammateMetaTags } from './teammate/[token].js';

const CTA = 'Make your own free.';
const TRUNCATION_CHECKPOINT = 90;

function descOf(html, prop) {
  const m = html.match(new RegExp(`${prop}" content="([^"]*)"`));
  expect(m, `${prop} present`).not.toBeNull();
  return m[1];
}

// [label, rendered html, who/what text that must survive a 90-char cut]
const cases = [
  ['reel', renderSharePage({ video_url: 'https://r2.example.com/x.mp4', video_name: 'Marcus - Goal vs Rangers U14', is_public: true }, '/'), 'Marcus - Goal vs Rangers U14'],
  ['game', renderGamePage({ game_name: 'vs Riverside', game_date: '2026-03-03', sharer_name: 'Khan', recap_url: 'https://r2.example.com/r.mp4', clips: [], clip_count: 0 }, 'tok9'), "Filmed by Khan's family"],
  ['collection', buildCollectionMetaTags({ title: 'Top Plays', context_line: '12 highlights from Spring Season 2026' }, 'https://api.example.com'), 'Top Plays - 12 highlights from Spring Season 2026'],
  ['teammate', buildTeammateMetaTags({ game_name: 'vs Legends Mar 28', clip_count: 5 }, 'https://x.pages.dev'), '5 highlights from vs Legends Mar 28'],
];

describe('T8450 unfurl description CTA', () => {
  for (const [label, html, essential] of cases) {
    it(`${label}: og/twitter/meta descriptions end with the CTA and keep who/what before the cut`, () => {
      const og = descOf(html, 'og:description');
      expect(og.endsWith(CTA)).toBe(true);
      expect(descOf(html, 'twitter:description')).toBe(og);
      const plain = og.replace(/&#39;/g, "'");
      expect(plain.indexOf(essential) + essential.length).toBeLessThanOrEqual(TRUNCATION_CHECKPOINT);
      expect(plain.indexOf(essential)).toBeGreaterThanOrEqual(0);
    });
  }
});
