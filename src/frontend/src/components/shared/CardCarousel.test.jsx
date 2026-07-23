import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardCarousel } from './CardCarousel';

describe('CardCarousel (T5672)', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollBy — spy so paging is observable.
    Element.prototype.scrollBy = vi.fn();
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

  it('renders both paging chevrons', () => {
    render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeTruthy();
  });

  it('pages left/right by scrolling the row on chevron click', () => {
    render(<CardCarousel ariaLabel="row"><div>t</div></CardCarousel>);
    fireEvent.click(screen.getByRole('button', { name: 'Scroll right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scroll left' }));
    expect(Element.prototype.scrollBy).toHaveBeenCalledTimes(2);
    // both calls request a smooth scroll
    for (const call of Element.prototype.scrollBy.mock.calls) {
      expect(call[0]).toMatchObject({ behavior: 'smooth' });
    }
  });
});
