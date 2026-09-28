import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RateThisPlayModal } from './RateThisPlayModal';

// T11120: the "Rate this play" gate modal. Verifies the EXACT owner-approved
// copy (title / subtitle / per-rating adjective + meaning / dismiss), that
// picking a row reports the rating, that "Keep editing"/Escape dismiss, and
// that the backdrop is inert (never dismisses on backdrop click).

function baseProps(overrides = {}) {
  return {
    onPick: vi.fn(),
    onDismiss: vi.fn(),
    isMobile: false,
    rating: null,
    ...overrides,
  };
}

describe('RateThisPlayModal (T11120)', () => {
  it('renders the exact approved copy: title, subtitle, 5 rows (adjective + meaning), and Keep editing', () => {
    render(<RateThisPlayModal {...baseProps()} />);
    const dialog = screen.getByTestId('rate-gate-modal');
    expect(within(dialog).getByText('Rate this play')).toBeTruthy();
    expect(within(dialog).getByText('Pick one to finish.')).toBeTruthy();

    // Adjectives
    for (const adj of ['Highlight', 'Good', 'Interesting', 'Technical Lapse', 'Mental Lapse']) {
      expect(within(dialog).getByText(adj)).toBeTruthy();
    }
    // Meanings (exact strings)
    expect(within(dialog).getByText('Brilliant Play! Everyone should see it.')).toBeTruthy();
    expect(within(dialog).getByText('A solid play worth remembering.')).toBeTruthy();
    expect(within(dialog).getByText('Worth a second look.')).toBeTruthy();
    expect(within(dialog).getByText('A touch or skill to work on.')).toBeTruthy();
    expect(within(dialog).getByText('A decision or focus moment to learn from.')).toBeTruthy();

    expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toBeTruthy();

    // Best-first radio order with the shared aria-labels.
    const options = within(dialog).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      '5 stars - Highlight', '4 stars - Good', '3 stars - Interesting',
      '2 stars - Technical Lapse', '1 star - Mental Lapse',
    ]);
  });

  it('picking a rating row reports that rating via onPick', () => {
    const onPick = vi.fn();
    render(<RateThisPlayModal {...baseProps({ onPick })} />);
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Highlight' }));
    expect(onPick).toHaveBeenCalledWith(5);
  });

  it('"Keep editing" dismisses (onDismiss), and picks nothing', () => {
    const onDismiss = vi.fn();
    const onPick = vi.fn();
    render(<RateThisPlayModal {...baseProps({ onDismiss, onPick })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('Escape dismisses; the backdrop is inert (a backdrop click never dismisses)', () => {
    const onDismiss = vi.fn();
    render(<RateThisPlayModal {...baseProps({ onDismiss })} />);

    fireEvent.click(screen.getByTestId('rate-gate-backdrop'));
    expect(onDismiss).not.toHaveBeenCalled(); // backdrop is inert

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
