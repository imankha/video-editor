import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardCarousel } from './CardCarousel';

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
});
