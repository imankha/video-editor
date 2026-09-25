/**
 * T10430: every rating renders as a drawn disc icon (RatingIcon) instead of
 * notation text on a filled rectangle, everywhere the badge appears. The icon
 * keeps a visually hidden notation so textContent-based assertions (and screen
 * readers) still see "!!", "!", "!?", "?", "??".
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RatingIcon } from './RatingIcon';
import { RATING_BADGE_COLORS, RATING_NOTATION, RATING_GLYPH_COLORS } from './clipConstants';
import { NotesOverlay } from '../../modes/annotate/components/NotesOverlay';
import { ClipListItem } from '../../modes/annotate/components/ClipListItem';

describe('RatingIcon', () => {
  it.each([1, 2, 3, 4, 5])('rating %i draws a disc in its palette color and keeps its notation in textContent', (rating) => {
    const { container, unmount } = render(<RatingIcon rating={rating} size={24} />);
    const icon = screen.getByTestId('rating-icon');
    expect(icon.dataset.rating).toBe(String(rating));
    expect(icon.textContent).toBe(RATING_NOTATION[rating]);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const discFills = [...svg.querySelectorAll('circle')].map((c) => c.getAttribute('fill'));
    expect(discFills).toContain(RATING_BADGE_COLORS[rating]);
    // Glyph shapes are drawn (paths/rects), not text.
    expect(svg.querySelector('text')).toBeNull();
    expect(svg.querySelectorAll('path, rect').length).toBeGreaterThan(0);
    unmount();
  });

  it('T10690: renders a dedicated unrated disc for null/undefined, never a fabricated 3-star', () => {
    render(<RatingIcon rating={undefined} />);
    const icon = screen.getByTestId('rating-icon');
    expect(icon.dataset.rating).toBe('unrated');
    expect(icon.textContent).toMatch(/not rated/i);
  });

  it('T11110: Highlight (5) is gold, distinct from the 4-star green', () => {
    expect(RATING_BADGE_COLORS[5]).toBe('#F5B700');
    expect(RATING_BADGE_COLORS[5]).not.toBe(RATING_BADGE_COLORS[4]);
  });

  it('T11110: draws the notation glyph in a dark color on the gold 5-star face (never white on gold)', () => {
    const { container } = render(<RatingIcon rating={5} size={24} />);
    const svg = container.querySelector('svg');
    // The notation glyph group is filled with the per-rating glyph color; on
    // gold that must be the dark tone, never #ffffff.
    const fills = [...svg.querySelectorAll('g')].map((g) => g.getAttribute('fill'));
    expect(fills).toContain(RATING_GLYPH_COLORS[5]);
    expect(RATING_GLYPH_COLORS[5]).toBe('#1a1300');
    expect(fills).not.toContain('#ffffff');
  });
});

describe('NotesOverlay rating notation', () => {
  it('renders the rating icon with the human label for 5-star and 4-star plays', () => {
    const { rerender } = render(
      <NotesOverlay name="Great goal" notes="" rating={5} isVisible />
    );
    expect(screen.getByTestId('rating-icon').dataset.rating).toBe('5');
    expect(screen.getByLabelText('5 stars · Highlight').textContent).toBe('!!');

    rerender(<NotesOverlay name="Nice pass" notes="" rating={4} isVisible />);
    expect(screen.getByTestId('rating-icon').dataset.rating).toBe('4');
    expect(screen.getByLabelText('4 stars · Good').textContent).toBe('!');
  });
});

describe('ClipListItem rating badge', () => {
  const region = (rating) => ({
    id: `r${rating}`, index: 0, startTime: 0, endTime: 8, rating, tags: [], notes: '', name: 'Play',
  });

  it.each([5, 4, 1])('renders the disc icon (no filled rectangle) for a %i-star play', (rating) => {
    const { unmount } = render(<ClipListItem region={region(rating)} isSelected={false} onClick={() => {}} />);
    const badge = screen.getByTitle(/stars? · /);
    const icon = badge.querySelector('[data-testid="rating-icon"]');
    expect(icon).not.toBeNull();
    expect(icon.dataset.rating).toBe(String(rating));
    expect(badge.style.backgroundColor).toBe('');
    unmount();
  });
});
