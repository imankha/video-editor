import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardCarousel, CAROUSEL_EDGE_HIDE } from './CardCarousel';

/**
 * T17850: a tile cut off at either end of the row is marked
 * `data-carousel-clipped`, so its overlay controls (CAROUSEL_EDGE_HIDE) hide
 * instead of sitting under the previous/next arrow. Fully visible tiles are not
 * marked, and scrolling a clipped tile fully into view clears the mark.
 *
 * jsdom measures nothing, so the row and tile boxes are stubbed: a 300px row
 * showing 120px tiles. While arrows are drawn (fine pointer + overflow) the row
 * is inset 28px on both sides, the arrows' reach, so the safe box is [28, 272].
 */
function stubBox(el, left, width) {
  el.getBoundingClientRect = () => ({ left, right: left + width, width, top: 0, bottom: 200, height: 200 });
  Object.defineProperty(el, 'offsetWidth', { value: width, configurable: true });
}

function mockPointer(fine) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches: fine && query === '(hover: hover) and (pointer: fine)',
    media: query,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }));
}

describe('CardCarousel edge tiles (T17850)', () => {
  beforeEach(() => mockPointer(true));
  afterEach(() => vi.restoreAllMocks());

  function renderRow() {
    const { container } = render(
      <CardCarousel ariaLabel="row">
        <div data-testid="t0">a</div>
        <div data-testid="t1">b</div>
        <div data-testid="t2">c</div>
        <div data-testid="t3">d</div>
      </CardCarousel>
    );
    const row = container.querySelector('div[role="group"]');
    Object.defineProperties(row, {
      scrollWidth: { value: 540, configurable: true },
      clientWidth: { value: 300, configurable: true },
    });
    stubBox(row, 0, 300);
    const tiles = [0, 1, 2, 3].map((i) => container.querySelector(`[data-testid="t${i}"]`));
    return { row, tiles };
  }

  const clipped = (tiles) => tiles.map((t) => t.hasAttribute('data-carousel-clipped'));

  it('marks the tiles cut off at the left and right ends, not the fully visible one', () => {
    const { row, tiles } = renderRow();
    // Scrolled mid-row: t0 cut off left, t1 fully visible, t2 cut off right, t3 off screen.
    stubBox(tiles[0], -60, 120);
    stubBox(tiles[1], 72, 120);
    stubBox(tiles[2], 204, 120);
    stubBox(tiles[3], 336, 120);
    fireEvent.scroll(row);
    expect(clipped(tiles)).toEqual([true, false, true, true]);
  });

  it('clears the mark once a tile scrolls fully into view', () => {
    const { row, tiles } = renderRow();
    stubBox(tiles[0], 28, 120);
    stubBox(tiles[1], 152, 120);
    stubBox(tiles[2], 276, 120);
    stubBox(tiles[3], 400, 120);
    fireEvent.scroll(row);
    expect(clipped(tiles)).toEqual([false, false, true, true]);

    stubBox(tiles[0], -96, 120);
    stubBox(tiles[1], 28, 120);
    stubBox(tiles[2], 152, 120);
    stubBox(tiles[3], 276, 120);
    fireEvent.scroll(row);
    expect(clipped(tiles)).toEqual([true, false, false, true]);
  });

  it('counts a tile reaching under a drawn arrow as cut off', () => {
    const { row, tiles } = renderRow();
    // t0 fully inside the row box but its first 24px are under the left arrow.
    stubBox(tiles[0], 4, 120);
    stubBox(tiles[1], 136, 120);
    stubBox(tiles[2], 268, 120);
    stubBox(tiles[3], 400, 120);
    fireEvent.scroll(row);
    expect(clipped(tiles)).toEqual([true, false, true, true]);
  });

  it('insets the row by the arrows\' reach while they are drawn, so the row start card clears the arrow', () => {
    const { row } = renderRow();
    fireEvent.scroll(row);
    expect(row.style.paddingLeft).toBe('28px');
    expect(row.style.paddingRight).toBe('28px');
    expect(row.style.scrollPaddingLeft).toBe('28px');
  });

  it('keeps the plain row box on a coarse pointer (no arrows, no inset)', () => {
    mockPointer(false);
    const { row, tiles } = renderRow();
    stubBox(tiles[0], 4, 120);
    stubBox(tiles[1], 136, 120);
    stubBox(tiles[2], 268, 120);
    stubBox(tiles[3], 400, 120);
    fireEvent.scroll(row);
    expect(row.style.paddingLeft).toBe('4px');
    expect(clipped(tiles)).toEqual([false, false, true, true]);
  });

  it('ignores a hover scale on a fully visible tile (untransformed box decides)', () => {
    const { row, tiles } = renderRow();
    stubBox(tiles[0], 28, 120);
    // t1 hovered at scale 1.03: its rect pokes past the safe box edge, its layout box does not.
    tiles[1].getBoundingClientRect = () => ({ left: 150.2, right: 273.8, width: 123.6, top: 0, bottom: 200, height: 200 });
    Object.defineProperty(tiles[1], 'offsetWidth', { value: 120, configurable: true });
    stubBox(tiles[2], 276, 120);
    stubBox(tiles[3], 400, 120);
    fireEvent.scroll(row);
    expect(clipped(tiles)).toEqual([false, false, true, true]);
  });

  it('exports the control class that hides a control inside a clipped tile', () => {
    expect(CAROUSEL_EDGE_HIDE).toContain('[[data-carousel-clipped]_&]:opacity-0');
    expect(CAROUSEL_EDGE_HIDE).toContain('[[data-carousel-clipped]_&]:pointer-events-none');
  });
});
