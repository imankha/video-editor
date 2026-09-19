/**
 * T10430: the 5-star "Brilliant" rating renders a drawn disc icon instead of
 * "!!" text on a rectangle, everywhere the notation badge appears. The icon
 * keeps a visually hidden "!!" so textContent-based assertions (and screen
 * readers) still see the notation.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { BrilliantIcon } from './BrilliantIcon';
import { BRILLIANT_RATING, RATING_BADGE_COLORS, RATING_NOTATION } from './clipConstants';
import { NotesOverlay } from '../../modes/annotate/components/NotesOverlay';
import { ClipListItem } from '../../modes/annotate/components/ClipListItem';

describe('BrilliantIcon', () => {
  it('draws the disc in the Brilliant palette color and keeps "!!" in textContent', () => {
    const { container } = render(<BrilliantIcon size={24} />);
    const icon = screen.getByTestId('brilliant-icon');
    expect(icon.textContent).toBe(RATING_NOTATION[BRILLIANT_RATING]);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    const discFills = [...svg.querySelectorAll('circle')].map((c) => c.getAttribute('fill'));
    expect(discFills).toContain(RATING_BADGE_COLORS[BRILLIANT_RATING]);
  });

  it('Brilliant is teal, distinct from the 4-star green', () => {
    expect(RATING_BADGE_COLORS[5]).toBe('#17B3A3');
    expect(RATING_BADGE_COLORS[5]).not.toBe(RATING_BADGE_COLORS[4]);
  });
});

describe('NotesOverlay rating notation', () => {
  it('renders the Brilliant icon for a 5-star play and plain notation for a 4-star play', () => {
    const { rerender } = render(
      <NotesOverlay name="Great goal" notes="" rating={5} isVisible />
    );
    expect(screen.getByTestId('brilliant-icon')).toBeTruthy();
    expect(screen.getByLabelText('5 stars · Brilliant')).toBeTruthy();

    rerender(<NotesOverlay name="Nice pass" notes="" rating={4} isVisible />);
    expect(screen.queryByTestId('brilliant-icon')).toBeNull();
    expect(screen.getByLabelText('4 stars · Good').textContent).toBe('!');
  });
});

describe('ClipListItem rating badge', () => {
  const region = (rating) => ({
    id: `r${rating}`, index: 0, startTime: 0, endTime: 8, rating, tags: [], notes: '', name: 'Play',
  });

  it('renders the Brilliant icon (no colored rectangle) for a 5-star play', () => {
    render(<ClipListItem region={region(5)} isSelected={false} onClick={() => {}} />);
    const badge = screen.getByLabelText('5 stars · Brilliant');
    expect(badge.querySelector('[data-testid="brilliant-icon"]')).not.toBeNull();
    expect(badge.style.backgroundColor).toBe('');
  });

  it('keeps the notation rectangle for a 4-star play', () => {
    render(<ClipListItem region={region(4)} isSelected={false} onClick={() => {}} />);
    const badge = screen.getByLabelText('4 stars · Good');
    expect(badge.textContent).toBe('!');
    expect(badge.style.backgroundColor).not.toBe('');
  });
});
