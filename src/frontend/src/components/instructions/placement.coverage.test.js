import { describe, it, expect } from 'vitest';
import { placeCoach, dockPlacement } from './placement';

const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const box = (p, card) => ({ left: p.left, top: p.top, right: p.left + card.width, bottom: p.top + card.height });

describe('T12650: guide card never covers the item it describes', () => {
  it('desktop: a bottom-right tile gets the card above it, not beside it', () => {
    for (const [w, h] of [[1440, 900], [1024, 768], [768, 1024]]) {
      const tile = { left: w - 260, top: h - 130, right: w - 60, bottom: h - 70 };
      const card = { width: 416, height: 120 };
      const r = placeCoach(tile, card, { width: w, height: h });
      expect(r).not.toBe('dock');
      expect(box(r, card).bottom).toBeLessThanOrEqual(tile.top);
    }
  });
  it('desktop: a top item gets the card below it', () => {
    const tile = { left: 600, top: 70, right: 800, bottom: 120 };
    const r = placeCoach(tile, { width: 416, height: 120 }, { width: 1440, height: 900 });
    expect(r.top).toBeGreaterThanOrEqual(tile.bottom);
  });
  it('phone: a mid-screen control row moves the dock above the anchor', () => {
    const play = { left: 20, top: 450, right: 370, bottom: 500 };
    const r = dockPlacement(play, 140, { width: 390, height: 844 }, 270);
    expect(r.dockTop).toBe(true);
    expect(hit({ left: 0, right: 390, top: r.top, bottom: r.top + 140 }, play)).toBe(false);
  });
  it('phone: a lower game card docks at the top, not over its lower half', () => {
    const card = { left: 16, top: 400, right: 374, bottom: 700 };
    const r = dockPlacement(card, 150, { width: 390, height: 844 }, 12);
    expect(r.dockTop).toBe(true);
    expect(r.top + 150).toBeLessThanOrEqual(card.top);
  });
  it('phone: keeps the bottom dock when it is clear of the anchor', () => {
    expect(dockPlacement({ left: 20, top: 100, right: 370, bottom: 150 }, 140, { width: 390, height: 844 }, 12)).toBe('dock');
  });
});
