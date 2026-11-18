// T17120: on a mouse-driven desktop these five sentences said "Tap". Each is one literal shown on
// every device, so the wording must fit a mouse and a finger alike (no "tap", no "click").
import { describe, it, expect } from 'vitest';
import { ANNOTATE, CREDIT_COPY, GUIDE } from './displayNames';
import { renderSharePage } from '../../functions/shared/[token].js';
import { renderGamePage } from '../../functions/shared/game/[token].js';

const TOUCH_ONLY = /\btap\b/i;
const MOUSE_ONLY = /\bclick\b/i;

const unmuteLabel = (html) => /<button id="unmute"[^>]*>([^<]*)<\/button>/.exec(html)?.[1];

const SENTENCES = {
  'coach: upload submit': GUIDE.upload.submit.title,
  'coach: watch the game': GUIDE.annotate.watch.title,
  'play editor: rating hint': `${ANNOTATE.RATING_QUESTION} ${ANNOTATE.RATING_CHANGE_HINT}`,
  'credit chip hint': CREDIT_COPY.balanceHint(83),
  'shared highlight: unmute': unmuteLabel(renderSharePage({ video_url: 'https://r2.example.com/x.mp4', is_public: true }, 'https://app.example.com/')),
  'shared game: unmute': unmuteLabel(renderGamePage({ recap_url: 'https://r2.example.com/r.mp4', opponent_name: 'Riverside', game_date: '2026-03-03' }, 'tok9')),
};

describe('T17120: device-neutral wording', () => {
  it.each(Object.entries(SENTENCES))('%s says neither tap nor click', (_name, text) => {
    expect(text, 'sentence must render').toBeTruthy();
    expect(text).not.toMatch(TOUCH_ONLY);
    expect(text).not.toMatch(MOUSE_ONLY);
  });

  it('the coach still names the controls it pulses', () => {
    expect(GUIDE.upload.submit.title).toMatch(/\bUpload game\b/);
    expect(GUIDE.annotate.watch.title).toMatch(/\bPlay\b.*\bMark play\b/);
  });
});
