import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PlayRatingRow } from './PlayRatingRow';
import { RATING_ADJECTIVES } from '../../../components/shared/clipConstants';

// T12140: each rating option shows its OWN star count (cell n = n stars), so the
// scale reads the same whichever option is selected.

afterEach(cleanup);
const radios = () => screen.getAllByRole('radio');
const starCount = (el) => el.querySelectorAll('svg.lucide-star').length;

describe('PlayRatingRow per-cell star count (T12140)', () => {
  it.each([1, 2, 3, 4, 5])('with rating %s selected, cell n still shows n stars', (selected) => {
    render(<PlayRatingRow rating={selected} onRatingChange={vi.fn()} />);
    expect(radios().map(starCount)).toEqual([1, 2, 3, 4, 5]);
  });

  it('only the selected cell has filled stars', () => {
    render(<PlayRatingRow rating={3} onRatingChange={vi.fn()} />);
    const fills = radios().map((r) =>
      [...r.querySelectorAll('svg.lucide-star')].filter((s) => s.getAttribute('fill') === '#fbbf24').length);
    expect(fills).toEqual([0, 0, 3, 0, 0]);
  });

  it('uses plain-word adjectives for the two low ratings', () => {
    expect(RATING_ADJECTIVES[2]).toBe('Skill miss');
    expect(RATING_ADJECTIVES[1]).toBe('Decision miss');
  });
});
