import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardCarousel, pickPeekGap } from './CardCarousel';

describe('CardCarousel (T5672)', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollBy — spy so paging is observable.
    Element.prototype.scrollBy = vi.fn();
    // Mock fine-pointer detection: default to desktop (fine pointer). The
    // component queries '(hover: hover) and (pointer: fine)' verbatim.
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: query === '(hover: hover) and (pointer: fine)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children inside a labelled, snap-scrolling region', () => {
    render(
      <CardCarousel ariaLabel="Vs Carlsbad drafts">
        <div>tile-a</div>
        <div>tile-b</div>
      </CardCarousel>
    );
    const region = screen.getByRole('group', { name: 'Vs Carlsbad drafts' });
    expect(region.className).toMatch(/snap-x/);
    expect(region.className).toMatch(/scrollbar-hide/);
    expect(screen.getByText('tile-a')).toBeTruthy();
    expect(screen.getByText('tile-b')).toBeTruthy();
  });

  it('does not show arrows on coarse-pointer (mobile)', () => {
    // Mock coarse pointer
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false, // coarse pointer
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    // Arrows should not be rendered on mobile
    expect(screen.queryByRole('button', { name: 'Scroll left' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scroll right' })).toBeNull();
  });

  it('pages left/right with smooth scroll on arrow click', () => {
    const { container } = render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    const scrollDiv = container.querySelector('div[role="group"]');

    // Mock overflow to make arrows appear
    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 1000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 350, configurable: true },
    });

    // Trigger initial layout detection
    fireEvent.scroll(scrollDiv);

    const rightBtn = screen.getByRole('button', { name: 'Scroll right' });
    const leftBtn = screen.getByRole('button', { name: 'Scroll left' });

    fireEvent.click(rightBtn);
    fireEvent.click(leftBtn);
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(2);
    // Verify smooth scroll behavior
    for (const call of Element.prototype.scrollBy.mock.calls) {
      expect(call[0]).toMatchObject({ behavior: 'smooth' });
    }
  });

  it('renders solid circular arrow buttons positioned outside the row edge, vertically centered', () => {
    const { container } = render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    const scrollDiv = container.querySelector('div[role="group"]');

    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 1000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 350, configurable: true }, // middle: both enabled
    });
    fireEvent.scroll(scrollDiv);

    const leftBtn = screen.getByRole('button', { name: 'Scroll left' });
    const rightBtn = screen.getByRole('button', { name: 'Scroll right' });

    for (const btn of [leftBtn, rightBtn]) {
      // Solid circle: rounded, sized, bordered, shadowed
      expect(btn.className).toMatch(/rounded-full/);
      expect(btn.className).toMatch(/w-9/);
      expect(btn.className).toMatch(/h-9/);
      expect(btn.className).toMatch(/border-gray-600/);
      expect(btn.className).toMatch(/shadow-lg/);
      // Vertically centered on the row
      expect(btn.className).toMatch(/top-1\/2/);
      expect(btn.className).toMatch(/-translate-y-1\/2/);
      // Enabled (mid-scroll) state is the solid dark fill, not the dimmed disabled one
      expect(btn.className).toMatch(/bg-gray-800\/95/);
      expect(btn.className).toMatch(/text-white/);
    }

    // Positioned half-out past the row's own edges
    expect(leftBtn.className).toMatch(/-left-4/);
    expect(rightBtn.className).toMatch(/-right-4/);
  });

  it('dims and disables the left arrow at scroll start, right arrow at scroll end', () => {
    const { container } = render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    const scrollDiv = container.querySelector('div[role="group"]');

    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 1000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 0, configurable: true }, // at start
    });
    fireEvent.scroll(scrollDiv);

    const leftBtn = screen.getByRole('button', { name: 'Scroll left' });
    expect(leftBtn.disabled).toBe(true);
    expect(leftBtn.className).toMatch(/text-gray-500/);

    const rightBtn = screen.getByRole('button', { name: 'Scroll right' });
    expect(rightBtn.disabled).toBe(false);
  });

  it('keeps the left arrow disabled at a sub-pixel scroll start (item 2 fix)', () => {
    const { container } = render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    const scrollDiv = container.querySelector('div[role="group"]');
    // A fractional scrollLeft (0.4px) is a visual scroll-start; the left arrow
    // must stay disabled despite scrollLeft > 0.
    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 1000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 0.4, configurable: true },
    });
    fireEvent.scroll(scrollDiv);
    expect(screen.getByRole('button', { name: 'Scroll left' }).disabled).toBe(true);
  });

  it('shows an ephemeral scroll-progress indicator only when overflowing (item 4)', () => {
    const { container } = render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    const scrollDiv = container.querySelector('div[role="group"]');

    // Not overflowing -> no progress indicator
    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 300, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 0, configurable: true },
    });
    fireEvent.scroll(scrollDiv);
    expect(screen.queryByTestId('carousel-progress-dots')).toBeNull();
    expect(screen.queryByTestId('carousel-progress-bar')).toBeNull();

    // Overflowing with few pages (1000/300 -> 4 pages) -> page dots
    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 1000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 0, configurable: true },
    });
    fireEvent.scroll(scrollDiv);
    const dots = screen.getByTestId('carousel-progress-dots');
    expect(dots).toBeTruthy();
    expect(dots.children.length).toBe(4); // ceil(1000/300)

    // Overflowing with many pages (>6) -> a thin progress bar instead of dots
    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 3000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 1350, configurable: true }, // mid-scroll
    });
    fireEvent.scroll(scrollDiv);
    expect(screen.queryByTestId('carousel-progress-dots')).toBeNull();
    expect(screen.getByTestId('carousel-progress-bar')).toBeTruthy();
  });
});

describe('pickPeekGap (item 1 — always leave a peek)', () => {
  const PEEK_MIN = (tileW) => tileW * 0.12;
  const PEEK_MAX = (tileW) => tileW * 0.85;

  it('keeps the default gap when every card fits (no overflow)', () => {
    // 3 tiles of 168 + 2*12 gaps = 528 < 1000 container -> no peek needed
    expect(pickPeekGap(168, 1000, 3)).toBe(12);
  });

  it('avoids a flush edge at an exact-multiple width', () => {
    // 6*(168+12) = 1080 -> at gap 12 the remainder is 0 (flush). The picked gap
    // must move the trailing card into the visible peek window.
    const tileW = 168;
    const containerW = 1080;
    const gap = pickPeekGap(tileW, containerW, 20);
    expect(gap).toBeGreaterThanOrEqual(6);
    expect(gap).toBeLessThanOrEqual(28);
    const remainder = containerW % (tileW + gap);
    expect(remainder).toBeGreaterThan(PEEK_MIN(tileW));
    expect(remainder).toBeLessThan(PEEK_MAX(tileW));
  });

  it('never lands flush across a sweep of realistic widths and tile sizes', () => {
    // Honest guarantee: for any overflowing row (container >= ~2.5 tiles), the
    // picked gap always leaves a VISIBLE partial trailing card — never a flush
    // 0px edge and never a full trailing card. (A ~35% peek is the preferred
    // target; very large tiles in a near-multiple-width container degrade to a
    // thinner-but-still-visible sliver, which gap-only tweaks can't avoid.)
    let bad = 0;
    for (const tileW of [140, 150, 168, 200, 260]) {
      for (let containerW = Math.ceil(2.5 * tileW); containerW <= 1700; containerW += 3) {
        const gap = pickPeekGap(tileW, containerW, 60);
        const remainder = containerW % (tileW + gap);
        const visible = remainder >= 6 && remainder <= tileW - 4;
        if (!visible) bad++;
      }
    }
    expect(bad).toBe(0);
  });

  it('prefers a clear ~35% peek at a typical desktop width', () => {
    const tileW = 168;
    const containerW = 1080; // 6 * (168 + 12) -> flush at the default gap
    const gap = pickPeekGap(tileW, containerW, 20);
    const remainder = containerW % (tileW + gap);
    expect(remainder).toBeGreaterThan(PEEK_MIN(tileW));
    expect(remainder).toBeLessThan(PEEK_MAX(tileW));
  });
});
