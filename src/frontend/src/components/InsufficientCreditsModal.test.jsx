import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';

/**
 * T9480 review fix (MINOR #9) -- single-sourced the fallback detail copy via
 * CREDITS/formatLength (was a bare Math.round with no stated rounding rule),
 * and removed the unconditional "1 credit = 1 second of exported video"
 * footer -- it was already stale vs T9750's round-half-up rule (BuyCreditsModal
 * fixed its own copy of this exact line; this sibling was missed) and is
 * simply WRONG in the modal's actual real usage (a game-upload storage-credit
 * shortfall has nothing to do with a per-second export rate).
 */
describe('InsufficientCreditsModal (T9480 review fix, MINOR #9)', () => {
  it('the real caller-supplied description renders as-is (unchanged production path)', () => {
    render(
      <InsufficientCreditsModal
        required={5}
        available={2}
        description="This upload requires 5 credits for 30 days of storage."
        onClose={vi.fn()}
        onBuyCredits={vi.fn()}
      />,
    );
    expect(screen.getByText('This upload requires 5 credits for 30 days of storage.')).toBeTruthy();
  });

  it('the fallback (no description) states the rounding rule via CREDITS, not a bare Math.round', () => {
    render(
      <InsufficientCreditsModal
        required={7}
        available={2}
        videoSeconds={6.5}
        onClose={vi.fn()}
        onBuyCredits={vi.fn()}
      />,
    );
    expect(screen.getByText(/7 credits for 6\.5s of video/)).toBeTruthy();
    expect(screen.getByText(/rounded to the nearest second/)).toBeTruthy();
  });

  it('no longer shows the stale, out-of-context "1 credit = 1 second of exported video" line', () => {
    render(
      <InsufficientCreditsModal
        required={5}
        available={2}
        description="This upload requires 5 credits for 30 days of storage."
        onClose={vi.fn()}
        onBuyCredits={vi.fn()}
      />,
    );
    expect(screen.queryByText(/1 credit = 1 second/)).toBeNull();
  });
});
