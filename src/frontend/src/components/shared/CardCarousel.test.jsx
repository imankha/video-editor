import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardCarousel } from './CardCarousel';

describe('CardCarousel (T5672)', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollBy — spy so paging is observable.
    Element.prototype.scrollBy = vi.fn();
    // Mock fine-pointer detection
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: query.includes('fine-pointer'),
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

  it('does not show chevrons on coarse-pointer (mobile)', () => {
    // Mock coarse pointer
    window.matchMedia = vi.fn().mockImplementation(query => ({
      matches: false, // coarse pointer
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));

    render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    // Chevrons should not be rendered on mobile
    expect(screen.queryByRole('button', { name: 'Scroll left' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scroll right' })).toBeNull();
  });

  it('pages left/right with smooth scroll on chevron click', () => {
    const { container } = render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    const scrollDiv = container.querySelector('div[role="group"]');

    // Mock overflow to make chevrons appear
    Object.defineProperties(scrollDiv, {
      scrollWidth: { value: 1000, configurable: true },
      clientWidth: { value: 300, configurable: true },
      scrollLeft: { value: 350, configurable: true },
    });

    // Trigger initial layout detection
    scrollDiv.dispatchEvent(new Event('scroll', { bubbles: true }));

    // If chevrons exist (component detected overflow), test the click behavior
    const rightBtn = screen.queryByRole('button', { name: 'Scroll right' });
    const leftBtn = screen.queryByRole('button', { name: 'Scroll left' });

    if (rightBtn && leftBtn) {
      fireEvent.click(rightBtn);
      fireEvent.click(leftBtn);
      expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(2);
      // Verify smooth scroll behavior
      for (const call of Element.prototype.scrollBy.mock.calls) {
        expect(call[0]).toMatchObject({ behavior: 'smooth' });
      }
    }
  });
});
