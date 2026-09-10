import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardCarousel, pickPeekGap, fillerFits } from './CardCarousel';

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

describe('measurement is transform-independent (T9300 — no "Maximum update depth" loop)', () => {
  // A helper: give a child a stable untransformed layout box (offsetWidth) plus a
  // getBoundingClientRect that reports a DIFFERENT (transform-inflated / drifting)
  // width. The component must read offsetWidth, so a hover/press scale transition on
  // the tile can never perturb the peek-gap / filler verdicts (which would otherwise
  // re-fire setGap/setFillerVisible in the no-deps post-render effect -> infinite loop).
  const setBox = (el, { offsetWidth, rectWidth }) => {
    Object.defineProperty(el, 'offsetWidth', { value: offsetWidth, configurable: true });
    el.getBoundingClientRect = () => ({
      width: typeof rectWidth === 'function' ? rectWidth() : rectWidth,
      height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON() {},
    });
  };

  it('computeGap reads the untransformed offsetWidth, not the scaled getBoundingClientRect', () => {
    const { container } = render(
      <CardCarousel ariaLabel="row"><div>a</div><div>b</div></CardCarousel>
    );
    const scrollDiv = container.querySelector('div[role="group"]');
    Object.defineProperty(scrollDiv, 'clientWidth', { value: 390, configurable: true });
    // 2-card phone row (72vw ~= 281px). Untransformed -> pickPeekGap(281,390,2) = 11px.
    // Transformed by hover:scale-[1.03] -> 289.43px -> pickPeekGap gives 6px. They differ,
    // so the applied gap tells us which width was measured.
    setBox(scrollDiv.firstElementChild, { offsetWidth: 281, rectWidth: 289.43 });
    expect(pickPeekGap(281, 390, 2)).toBe(11);
    expect(pickPeekGap(289.43, 390, 2)).toBe(6);

    fireEvent(window, new Event('resize')); // size-driven recompute -> computeGap
    expect(scrollDiv.style.gap).toBe('11px'); // used offsetWidth, not the scaled rect
  });

  it('gap stays stable while a scale transition drifts the transformed width', () => {
    const { container } = render(
      <CardCarousel ariaLabel="row"><div>a</div><div>b</div></CardCarousel>
    );
    const scrollDiv = container.querySelector('div[role="group"]');
    Object.defineProperty(scrollDiv, 'clientWidth', { value: 390, configurable: true });
    // offsetWidth pinned; getBoundingClientRect() drifts wildly on each read (as it
    // would every frame while `transition-all` eases the hover scale). Pre-fix this
    // flipped the gap each render; post-fix the gap is fixed by the stable offsetWidth.
    const drift = [281, 305, 258, 299, 271];
    let i = 0;
    setBox(scrollDiv.firstElementChild, {
      offsetWidth: 281,
      rectWidth: () => drift[i++ % drift.length],
    });
    for (let n = 0; n < 4; n++) fireEvent(window, new Event('resize'));
    expect(scrollDiv.style.gap).toBe('11px'); // pickPeekGap(281,390,2) — never oscillates
  });

  it('computeFiller reads offsetWidth too, so a scale transition cannot flap the filler', () => {
    const { container } = render(
      <CardCarousel ariaLabel="row" fillerSlot={<div>coach-me</div>}>
        <div>a</div>
      </CardCarousel>
    );
    const scrollDiv = container.querySelector('div[role="group"]');
    Object.defineProperty(scrollDiv, 'clientWidth', { value: 552, configurable: true });
    // At container 552, one 260px tile fits the filler EXACTLY (260+12+280=552<=552).
    // The scaled width 267.8 would push it over (559.8>552) and retire the filler —
    // measuring offsetWidth keeps the verdict correct and stable.
    setBox(scrollDiv.firstElementChild, { offsetWidth: 260, rectWidth: 267.8 });
    expect(fillerFits(260, 552, 1)).toBe(true);
    expect(fillerFits(267.8, 552, 1)).toBe(false);

    fireEvent(window, new Event('resize'));
    expect(screen.getByText('coach-me')).toBeTruthy(); // filler mounted (used offsetWidth)
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

describe('fillerFits (T8990 - mount the coaching filler only while it fits)', () => {
  // The filler needs >= MIN_FILLER_WIDTH (280) beyond the tiles + one gap each.
  it('returns false on degenerate inputs (no layout engine / empty row)', () => {
    expect(fillerFits(0, 1000, 3)).toBe(false);
    expect(fillerFits(260, 0, 3)).toBe(false);
    expect(fillerFits(260, 1000, 0)).toBe(false);
    expect(fillerFits(NaN, 1000, 3)).toBe(false);
  });

  it('fits beside a short landscape row at the Clips container width (1152)', () => {
    // 1 landscape tile (260): 260 + 12 + 280 = 552 <= 1152 -> fits
    expect(fillerFits(260, 1152, 1)).toBe(true);
    // 3 tiles: 780 + 36 + 280 = 1096 <= 1152 -> still fits
    expect(fillerFits(260, 1152, 3)).toBe(true);
  });

  it('retires once landscape tiles fill the row (4-up at 1152)', () => {
    // 4 tiles: 1040 + 48 + 280 = 1368 > 1152 -> no longer fits
    expect(fillerFits(260, 1152, 4)).toBe(false);
  });

  it('never fits on a phone: one 72vw tile already fills the row', () => {
    // ~390px viewport, tile ~281 (72vw): 281 + 12 + 280 = 573 > 390 -> false
    expect(fillerFits(281, 390, 1)).toBe(false);
  });

  it('is decided from the tiles only, so at the exact boundary adding a tile flips it', () => {
    // Construct a container exactly at the 1-tile threshold: 260 + 12 + 280 = 552.
    expect(fillerFits(260, 552, 1)).toBe(true);   // exactly fits
    expect(fillerFits(260, 551, 1)).toBe(false);  // one px short
    // Portrait tiles (168) pack more before the filler retires.
    expect(fillerFits(168, 1152, 3)).toBe(true);  // 504 + 36 + 280 = 820 <= 1152
  });
});
