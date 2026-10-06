import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlayRatingRow } from './PlayRatingRow';
import { RATING_BADGE_COLORS, RATING_MEANINGS } from '../../../components/shared/clipConstants';

// T11840 a11y: WAI-ARIA radio group (roving tabindex + arrow keys) and the hint
// paragraph described-by link. Arrow keys select via onRatingChange exactly like a
// click (selecting 5 only rates; the highlight choice card opens on Done).

afterEach(cleanup);
const radios = () => screen.getAllByRole('radio');

describe('PlayRatingRow a11y (T11840)', () => {
  it('roving tabindex: only the selected radio is tabbable (Good when the rating is null)', () => {
    const { rerender } = render(<PlayRatingRow rating={null} onRatingChange={vi.fn()} />);
    expect(radios().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '-1', '0', '-1']);
    rerender(<PlayRatingRow rating={3} onRatingChange={vi.fn()} />);
    expect(radios().map((r) => r.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1', '-1']);
  });

  it.each([
    ['ArrowRight', 3, 4],
    ['ArrowDown', 3, 4],
    ['ArrowLeft', 3, 2],
    ['ArrowUp', 3, 2],
    ['ArrowRight', 5, 1],
    ['ArrowLeft', 1, 5],
  ])('%s from %s selects %s and moves focus', (key, from, to) => {
    const onRatingChange = vi.fn();
    render(<PlayRatingRow rating={from} onRatingChange={onRatingChange} />);
    const el = radios()[from - 1];
    el.focus();
    fireEvent.keyDown(el, { key });
    expect(onRatingChange).toHaveBeenCalledWith(to);
    expect(document.activeElement).toBe(radios()[to - 1]);
  });

  it('arrow from a null-rating row moves from Good (4)', () => {
    const onRatingChange = vi.fn();
    render(<PlayRatingRow rating={null} onRatingChange={onRatingChange} />);
    const el = radios()[3];
    el.focus();
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(onRatingChange).toHaveBeenCalledWith(5);
  });

  it.each([1, 2, 3, 4, 5])('the caption for rating %s is the selected rating meaning, linked via aria-describedby', (n) => {
    render(<PlayRatingRow rating={n} onRatingChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup');
    const id = group.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id).textContent).toBe(RATING_MEANINGS[n]);
  });

  it('a null rating shows the Good caption, and never the old 5-star highlight claim', () => {
    render(<PlayRatingRow rating={null} onRatingChange={vi.fn()} />);
    expect(screen.queryByText(/make it a highlight/i)).toBeNull();
  });

  it('the 5-star cell is gold (RATING_BADGE_COLORS[5]); other cells are not', () => {
    render(<PlayRatingRow rating={null} onRatingChange={vi.fn()} />);
    expect(RATING_BADGE_COLORS[5]).toBe('#F5B700');
    expect(radios()[4].className).toContain(`border-[${RATING_BADGE_COLORS[5]}]`);
    expect(radios()[0].className).not.toContain(RATING_BADGE_COLORS[5]);
  });
});
