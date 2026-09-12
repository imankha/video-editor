import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { ClipLibraryModal } from './ClipLibraryModal';

/**
 * T9480 Stage D4 -- a genuinely zero-duration clip must still read "0:00"
 * (it's a real, honest value), not disappear or be conflated with a missing
 * duration. Audited the other #8/#14 consumer call sites (design section
 * 1.2): all are either already externally null-guarded (ClipSelectorSidebar,
 * OverlayModeView:793) or feed values that are structurally never null
 * (region bounds, computed sums, gated OutputLengthChip props) -- Stage C's
 * move to formatInstant/formatLength (which return null, not a fake zero,
 * for genuinely missing input) already closed the "undefined reads as a
 * plausible 0:00" gap at those sites, so no further D4 change was needed
 * there.
 */

const GAMES = [{ id: 1, name: 'Test Game' }];

afterEach(cleanup);

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve([
        { id: 1, game_id: 1, rating: 4, tags: [], start_time: 5, end_time: 5, name: 'Zero-length clip' },
      ]),
    }),
  );
});

describe('ClipLibraryModal honest zero duration (T9480 Stage D4)', () => {
  it('shows 0:00 for a genuinely zero-duration clip, not a blank/missing state', async () => {
    render(<ClipLibraryModal isOpen onClose={() => {}} onSelectClip={() => {}} games={GAMES} />);
    await waitFor(() => {
      expect(screen.getByText(/Zero-length clip/)).toBeTruthy();
    });
    expect(screen.getAllByText('0:00').length).toBeGreaterThan(0);
  });
});
