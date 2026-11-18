/**
 * T17170:C3: the rating badge shows the STAR COUNT on its colored disc, never a
 * chess glyph ("!!", "!", "!?", "?", "??" read as nothing to parents). Colors
 * stay RATING_BADGE_COLORS; dark text on the gold 5-star face. A 28px+ badge
 * reads "4★"; a smaller timeline dot shows the digit only. Unrated is grey with
 * no number. (Replaces the T10430 drawn-glyph tests.)
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RatingIcon } from './RatingIcon';
import * as clipConstants from './clipConstants';
import { NotesOverlay } from '../../modes/annotate/components/NotesOverlay';
import { ClipListItem } from '../../modes/annotate/components/ClipListItem';

const { RATING_BADGE_COLORS, RATING_GLYPH_COLORS, UNRATED_BADGE_COLOR } = clipConstants;
const CHESS = /[!?]/;

// jsdom normalizes inline colors to rgb(); compare the same way.
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

describe('RatingIcon star count', () => {
  it.each([1, 2, 3, 4, 5])('rating %i at 28px reads "N★" on its palette color', (rating) => {
    const { unmount } = render(<RatingIcon rating={rating} size={28} />);
    const icon = screen.getByTestId('rating-icon');
    expect(icon.dataset.rating).toBe(String(rating));
    expect(icon.textContent).toBe(`${rating}★`);
    expect(icon.getAttribute('aria-label')).toBe(`${rating} star${rating === 1 ? '' : 's'}`);
    expect(icon.style.backgroundColor).toBe(rgb(RATING_BADGE_COLORS[rating]));
    expect(icon.style.width).toBe('28px');
    expect(icon.style.fontSize).toBe('13px');
    unmount();
  });

  it('a 20px timeline dot shows the digit only', () => {
    render(<RatingIcon rating={3} size={20} />);
    expect(screen.getByTestId('rating-icon').textContent).toBe('3');
  });

  it('5 stars draws dark text on gold (never white on gold)', () => {
    render(<RatingIcon rating={5} size={28} />);
    const icon = screen.getByTestId('rating-icon');
    expect(icon.style.backgroundColor).toBe(rgb('#F5B700'));
    expect(icon.style.color).toBe(rgb(RATING_GLYPH_COLORS[5]));
  });

  it('null/undefined renders as Good (4)', () => {
    render(<RatingIcon rating={undefined} size={28} />);
    expect(screen.getByTestId('rating-icon').textContent).toBe('4★');
  });

  it('an out-of-range rating is unrated: neutral grey, no number', () => {
    render(<RatingIcon rating={0} size={28} />);
    const icon = screen.getByTestId('rating-icon');
    expect(icon.textContent).toBe('');
    expect(icon.style.backgroundColor).toBe(rgb(UNRATED_BADGE_COLOR));
  });

  it('chess notation is retired', () => {
    expect(clipConstants.RATING_NOTATION).toBeUndefined();
    expect(clipConstants.getRatingDisplay(5).notation).toBeUndefined();
  });
});

describe('rating badge callers show stars, never chess glyphs', () => {
  it('NotesOverlay', () => {
    render(<NotesOverlay name="Great goal" notes="" rating={5} isVisible />);
    const icon = screen.getByTestId('rating-icon');
    expect(icon.dataset.rating).toBe('5');
    expect(icon.textContent).not.toMatch(CHESS);
  });

  it.each([true, false])('ClipListItem row badge is 28px "N★" with aria-label "N stars" (mobile=%s)', (isMobile) => {
    render(<ClipListItem region={{ id: 'r', index: 0, startTime: 0, endTime: 8, rating: 4, tags: [], notes: '', name: 'Play' }}
      isSelected={false} isMobile={isMobile} onClick={() => {}} onJumpToClip={() => {}} />);
    const icon = screen.getByLabelText('4 stars');
    expect(icon.textContent).toBe('4★');
    expect(icon.style.width).toBe('28px');
  });
});
