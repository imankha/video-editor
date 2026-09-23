import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TimelineBase } from './TimelineBase';

/**
 * T10780 — the mobile scrollbar must be a REAL finger control (user ruling
 * 2026-09-20): >= 44 px hit area (the whole row is the target), thumb >= 56 px
 * with a grip, 8 px above / 12 px below (mt-2 / mb-3). A touch anywhere in the row
 * drags the window (no dead zone at the row's vertical edges). The bar renders in
 * the DOM whenever timelineScale > 1. Input is Pointer Events (mouse AND touch,
 * with capture) - see the drag contract tests below.
 *
 * T11030 — the bar used to carry `lg:hidden` (desktop fell back to the
 * OS-native scrollbar via a `.timeline-scroll-zoomed` CSS class); a real
 * desktop user reported that native bar too easy to miss, so it now renders at
 * every width and the native bar is unconditionally hidden instead.
 */

afterEach(() => cleanup());

const baseProps = {
  currentTime: 0,
  duration: 100,
  onSeek: () => {},
  layerLabels: <div />,
  timelineScale: 3,
};

function renderBar() {
  const utils = render(<TimelineBase {...baseProps} />);
  const track = screen.getByTestId('mobile-scrollbar-track');
  // jsdom gives zeros; pin a deterministic 300px-wide row so drag math is real.
  track.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 300, bottom: 44, width: 300, height: 44, x: 0, y: 0,
  });
  return { track, ...utils };
}

describe('MobileScrollbar — finger-sized geometry (T10780)', () => {
  it('gives the row a >= 44px hit area with mt-2 / mb-3 spacing', () => {
    const { track } = renderBar();
    expect(track.className).toContain('min-h-[44px]');
    expect(track.className).toContain('mt-2');
    expect(track.className).toContain('mb-3');
  });

  it('renders a thumb at least 56px wide with a visible grip', () => {
    renderBar();
    const thumb = screen.getByTestId('mobile-scrollbar-thumb');
    expect(thumb.className).toContain('min-w-[56px]');
    // grip glyph: at least 3 bars inside the thumb
    expect(thumb.querySelectorAll('span').length).toBeGreaterThanOrEqual(3);
  });

  it('renders at every width (no lg:hidden), offset to match the label column', () => {
    // T11030: used to carry `lg:hidden` and hand off to the OS-native
    // scrollbar on desktop; a real user found that native bar too easy to
    // miss, so the custom bar is now the one affordance at every width.
    const { track } = renderBar();
    expect(track.className).not.toContain('lg:hidden');
    expect(track.className).toContain('ml-20');
    expect(track.className).toContain('lg:ml-32');
  });

  it('native scrollbar stays hidden via class, never an inline style, whether zoomed or not', () => {
    // T10780 regression: an inline `scrollbarWidth: 'auto'` beat index.css's
    // hide rule the moment Annotate went 3x, so the native bar rendered UNDER
    // the custom finger bar (two scrollbars), and on Windows its layout height
    // spawned a vertical scrollbar too. index.css hides the native bar
    // unconditionally (T11030 removed the lg+ zoomed fallback that used to
    // show it) - no inline scrollbar style must ever reappear.
    renderBar();
    const zoomed = document.querySelector('.timeline-scroll-container');
    expect(zoomed.style.scrollbarWidth).toBe('');
    expect(zoomed.getAttribute('style')).toBeNull();
    cleanup();
    render(<TimelineBase {...baseProps} timelineScale={1} />);
    const flat = document.querySelector('.timeline-scroll-container');
    expect(flat.getAttribute('style')).toBeNull();
    expect(screen.queryByTestId('mobile-scrollbar-track')).toBeNull();
  });

  // Pointer-event drag contract (user ruling 2026-09-21: "work great using
  // touch or mouse"). The first cut listened to touch + click only, so a mouse
  // could not drag at all (click-to-jump read as "finite positions").
  function scrollable(container) {
    let scrollLeft = 0;
    Object.defineProperty(container, 'scrollWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(container, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v) => { scrollLeft = v; },
    });
  }
  // Pin the thumb at 100px wide sitting at the rail's left edge (rail = 300px,
  // so the thumb travels 0..200px and maps onto scrollLeft 0..600).
  function pinThumb(left = 0) {
    const thumb = screen.getByTestId('mobile-scrollbar-thumb');
    thumb.getBoundingClientRect = () => ({
      left, top: 4, right: left + 100, bottom: 40, width: 100, height: 36, x: left, y: 4,
    });
    return thumb;
  }

  for (const pointerType of ['mouse', 'touch']) {
    it(`${pointerType}: pressing on the rail centers the thumb under the pointer, then a drag follows 1:1`, () => {
      const { track } = renderBar();
      const container = document.querySelector('.timeline-scroll-container');
      scrollable(container);
      pinThumb(0);

      // press at x=150 on the rail (thumb spans 0..100 -> not on the thumb):
      // thumb centers under the pointer -> thumbLeft 100 -> 100/200 * 600 = 300
      fireEvent.pointerDown(track, { pointerType, button: 0, pointerId: 1, clientX: 150, clientY: 20 });
      expect(container.scrollLeft).toBeCloseTo(300, 5);

      // move to x=250 -> thumbLeft 200 (max) -> 600
      fireEvent.pointerMove(track, { pointerType, pointerId: 1, clientX: 250, clientY: 20 });
      expect(container.scrollLeft).toBeCloseTo(600, 5);

      // move back to x=100 -> thumbLeft 50 -> 150 (continuous, no steps)
      fireEvent.pointerMove(track, { pointerType, pointerId: 1, clientX: 100, clientY: 20 });
      expect(container.scrollLeft).toBeCloseTo(150, 5);

      // release -> further moves do nothing
      fireEvent.pointerUp(track, { pointerType, pointerId: 1, clientX: 100, clientY: 20 });
      fireEvent.pointerMove(track, { pointerType, pointerId: 1, clientX: 250, clientY: 20 });
      expect(container.scrollLeft).toBeCloseTo(150, 5);
    });

    it(`${pointerType}: pressing ON the thumb grabs it without a jump and keeps the grab offset`, () => {
      const { track } = renderBar();
      const container = document.querySelector('.timeline-scroll-container');
      scrollable(container);
      pinThumb(0);

      // press at x=80, inside the thumb (0..100): no jump
      fireEvent.pointerDown(track, { pointerType, button: 0, pointerId: 2, clientX: 80, clientY: 20 });
      expect(container.scrollLeft).toBe(0);

      // drag +40px -> thumbLeft 40 -> 40/200 * 600 = 120 (offset 80 preserved)
      fireEvent.pointerMove(track, { pointerType, pointerId: 2, clientX: 120, clientY: 20 });
      expect(container.scrollLeft).toBeCloseTo(120, 5);
    });
  }

  it('a drag keeps working when the pointer leaves the row (capture), and clamps at the ends', () => {
    const { track } = renderBar();
    const container = document.querySelector('.timeline-scroll-container');
    scrollable(container);
    pinThumb(0);
    fireEvent.pointerDown(track, { pointerType: 'mouse', button: 0, pointerId: 3, clientX: 50, clientY: 20 });
    // way off to the right and below the row -> clamps to the end, still dragging
    fireEvent.pointerMove(track, { pointerType: 'mouse', pointerId: 3, clientX: 900, clientY: 400 });
    expect(container.scrollLeft).toBeCloseTo(600, 5);
    // way off to the left -> clamps to 0
    fireEvent.pointerMove(track, { pointerType: 'mouse', pointerId: 3, clientX: -500, clientY: -50 });
    expect(container.scrollLeft).toBe(0);
  });

  it('a secondary mouse button does not start a drag', () => {
    const { track } = renderBar();
    const container = document.querySelector('.timeline-scroll-container');
    scrollable(container);
    pinThumb(0);
    fireEvent.pointerDown(track, { pointerType: 'mouse', button: 2, pointerId: 4, clientX: 150, clientY: 20 });
    fireEvent.pointerMove(track, { pointerType: 'mouse', pointerId: 4, clientX: 250, clientY: 20 });
    expect(container.scrollLeft).toBe(0);
  });
});
