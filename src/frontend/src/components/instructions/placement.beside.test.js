import { describe, it, expect } from 'vitest';
import { placeBeside, BESIDE_CARD_WIDTH } from './placement';

const card = { width: BESIDE_CARD_WIDTH, height: 120 };
const panel = { left: 600, right: 1000, top: 100, bottom: 700 };
const anchor = { left: 620, right: 980, top: 300, bottom: 420 };

describe('placeBeside: the card sits off to the side of the dialog, level with the control it names', () => {
  it('goes to the right of the panel, top aligned with the control', () => {
    expect(placeBeside(panel, anchor, card, { width: 1600, height: 900 })).toEqual({ left: 1012, top: 300, side: 'right' });
  });

  it('goes to the left when the right edge has no room', () => {
    expect(placeBeside(panel, anchor, card, { width: 1200, height: 900 })).toEqual({ left: 600 - 12 - BESIDE_CARD_WIDTH, top: 300, side: 'left' });
  });

  it('returns null when neither side fits (a phone: the card stays inline)', () => {
    expect(placeBeside({ left: 12, right: 378, top: 100, bottom: 700 }, anchor, card, { width: 390, height: 844 })).toBeNull();
  });

  it('keeps the card inside the viewport vertically', () => {
    const low = { left: 620, right: 980, top: 850, bottom: 890 };
    const placed = placeBeside(panel, low, card, { width: 1600, height: 900 });
    expect(placed.top + card.height).toBeLessThanOrEqual(900 - 12);
  });
});
