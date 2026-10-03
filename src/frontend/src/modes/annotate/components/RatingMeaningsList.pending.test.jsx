import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RatingMeaningsList } from './RatingMeaningsList';

/**
 * T11400 — immediate feedback surface. When a rating pick is awaiting its
 * persisted write, the gate passes `pendingRating` so the list renders the busy
 * state: the picked row reads as selected + aria-busy, EVERY row is disabled so a
 * second pick can't fire, yet the component's default (no pendingRating) behaves
 * exactly as before (RatingPill keeps using it unchanged).
 */
afterEach(cleanup);

describe('RatingMeaningsList — pending/busy state (T11400)', () => {
  it('marks the pending row busy, disables all rows, and blocks further picks', () => {
    const onPick = vi.fn();
    render(<RatingMeaningsList rating={null} onPick={onPick} headingId="h" pendingRating={5} />);

    const rows = screen.getAllByRole('radio');
    expect(rows.every((r) => r.disabled)).toBe(true);

    const pendingRow = screen.getByRole('radio', { name: /5 stars/i });
    expect(pendingRow.getAttribute('aria-checked')).toBe('true');
    expect(pendingRow.getAttribute('aria-busy')).toBe('true');

    // A click while pending does nothing (disabled + guarded).
    fireEvent.click(screen.getByRole('radio', { name: /3 stars/i }));
    expect(onPick).not.toHaveBeenCalled();
  });

  it('defaults to the original interactive behavior when no pendingRating is given', () => {
    const onPick = vi.fn();
    render(<RatingMeaningsList rating={null} onPick={onPick} headingId="h" />);
    const rows = screen.getAllByRole('radio');
    expect(rows.some((r) => r.disabled)).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: /4 stars/i }));
    expect(onPick).toHaveBeenCalledWith(4);
  });
});
