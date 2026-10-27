import { describe, it, expect } from 'vitest';
import { transientSlot } from './placement';

// T13570 B: the Highlight-ready card (256x104, bottom-24 right-4) on a 390x844 phone, measured live at staging/dev.
const vp = { width: 390, height: 844 };
const size = { width: 256, height: 104 };
const home = { left: 390 - 16 - 256, top: 844 - 96 - 104 };
const r = (left, top, right, bottom) => ({ left, top, right, bottom });
const hits = (p, o) => p.left < o.right && p.left + size.width > o.left && p.top < o.bottom && p.top + size.height > o.top;

describe('T13570 transientSlot', () => {
  it('keeps its own spot (null) when nothing the guide names is under it', () => {
    expect(transientSlot(size, vp, [r(12, 56, 378, 204)], home)).toBeNull();
  });

  it('moves off the pulsing game tile and Upload game, nearest its own spot on the same edge', () => {
    const keepOut = [r(12, 56, 378, 204), r(107, 575, 278, 623), r(16, 705, 374, 906)];
    const p = transientSlot(size, vp, keepOut, home);
    expect(p.left).toBe(home.left);
    for (const o of keepOut) expect(hits(p, o)).toBe(false);
    expect(p.top + size.height).toBeLessThanOrEqual(575);
  });

  it('returns null when no spot on screen is clear', () => {
    expect(transientSlot(size, vp, [r(0, 0, 390, 844)], home)).toBeNull();
  });
});
