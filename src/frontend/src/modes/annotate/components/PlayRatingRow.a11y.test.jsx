import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlayRatingRow } from './PlayRatingRow';
import { ANNOTATE } from '../../../config/displayNames';
import { RATING_BADGE_COLORS } from '../../../components/shared/clipConstants';

// T11840 a11y: WAI-ARIA radio group (roving tabindex + arrow keys) and the hint
// paragraph described-by link. Arrow keys select via onRatingChange exactly like a
// click (selecting 5 only rates; the highlight choice card opens on Done).

afterEach(cleanup);
const radios = () => screen.getAllByRole('radio');

describe('PlayRatingRow a11y (T11840)', () => {
  it('roving tabindex: only the selected radio is tabbable (first when unrated)', () => {
    const { rerender } = render(<PlayRatingRow rating={null} onRatingChange={vi.fn()} />);
    expect(radios().map((r) => r.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1']);
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

  it('arrow from an unrated row starts at the first/last star', () => {
    const onRatingChange = vi.fn();
    render(<PlayRatingRow rating={null} onRatingChange={onRatingChange} />);
    const el = radios()[0];
    el.focus();
    fireEvent.keyDown(el, { key: 'ArrowRight' });
    expect(onRatingChange).toHaveBeenCalledWith(2);
  });

  it('the hint paragraph is linked to the radiogroup via aria-describedby', () => {
    render(<PlayRatingRow rating={null} onRatingChange={vi.fn()} />);
    const group = screen.getByRole('radiogroup');
    const id = group.getAttribute('aria-describedby');
    expect(id).toBeTruthy();
    expect(document.getElementById(id).textContent).toBe(ANNOTATE.RATING_HIGHLIGHT_HINT);
  });

  it('the 5-star ring is derived from RATING_BADGE_COLORS[5] (gold), others have none', () => {
    render(<PlayRatingRow rating={null} onRatingChange={vi.fn()} />);
    expect(RATING_BADGE_COLORS[5]).toBe('#F5B700');
    expect(radios()[4].style.boxShadow).toContain(RATING_BADGE_COLORS[5]);
    expect(radios()[0].style.boxShadow).toBe('');
  });
});
