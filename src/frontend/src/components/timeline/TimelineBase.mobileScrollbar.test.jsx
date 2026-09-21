import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TimelineBase } from './TimelineBase';

/**
 * T10780 — the mobile scrollbar must be a REAL finger control (user ruling
 * 2026-09-20): >= 44 px hit area (the whole row is the target), thumb >= 56 px
 * with a grip, 8 px above / 12 px below (mt-2 / mb-3). A touch anywhere in the row
 * drags the window (no dead zone at the row's vertical edges). The bar renders in
 * the DOM whenever timelineScale > 1; `lg:hidden` hides it on true desktop (CSS,
 * not exercised by jsdom).
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

  it('is hidden on lg (desktop) via lg:hidden, and offset to match the label column', () => {
    const { track } = renderBar();
    expect(track.className).toContain('lg:hidden');
    expect(track.className).toContain('ml-20');
    expect(track.className).toContain('lg:ml-32');
  });

  it('native scrollbar visibility is class-driven, never an inline style (one bar at a time)', () => {
    // T10780 regression: an inline `scrollbarWidth: 'auto'` beat index.css's
    // mobile hide rule the moment Annotate went 3x, so the native bar rendered
    // UNDER the custom finger bar (two scrollbars), and on Windows its layout
    // height spawned a vertical scrollbar too. The container must carry the
    // `timeline-scroll-zoomed` marker (index.css shows the native bar only at
    // lg+ with it) and no inline scrollbar style at all.
    renderBar();
    const zoomed = document.querySelector('.timeline-scroll-container');
    expect(zoomed.className).toContain('timeline-scroll-zoomed');
    expect(zoomed.style.scrollbarWidth).toBe('');
    expect(zoomed.getAttribute('style')).toBeNull();
    cleanup();
    render(<TimelineBase {...baseProps} timelineScale={1} />);
    const flat = document.querySelector('.timeline-scroll-container');
    expect(flat.className).not.toContain('timeline-scroll-zoomed');
    expect(flat.getAttribute('style')).toBeNull();
    expect(screen.queryByTestId('mobile-scrollbar-track')).toBeNull();
  });

  it('a touchstart + touchmove on the track scrolls the container', () => {
    const { track } = renderBar();
    const container = document.querySelector('.timeline-scroll-container');
    let scrollLeft = 0;
    Object.defineProperty(container, 'scrollWidth', { configurable: true, get: () => 900 });
    Object.defineProperty(container, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(container, 'scrollLeft', {
      configurable: true,
      get: () => scrollLeft,
      set: (v) => { scrollLeft = v; },
    });

    // touch at 50% of the 300px row -> fraction 0.5 -> 0.5 * (900-300) = 300
    fireEvent.touchStart(track, { touches: [{ clientX: 150 }] });
    expect(container.scrollLeft).toBeCloseTo(300, 5);

    // a move to the far right edge drives it to maxScroll
    fireEvent.touchMove(document, { touches: [{ clientX: 300 }] });
    expect(container.scrollLeft).toBeCloseTo(600, 5);
  });
});
