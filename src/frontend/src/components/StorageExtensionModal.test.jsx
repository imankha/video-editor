/**
 * T2855: Verify StorageExtensionModal works with shared game data.
 *
 * Shared games have the same fields as uploaded games (video_size,
 * storage_expires_at, id, name) -- materialization guarantees this.
 * These tests verify the modal renders correctly and calls the right
 * endpoint regardless of whether the game was uploaded or shared.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageExtensionModal } from './StorageExtensionModal';
import { useCreditStore } from '../stores/creditStore';

vi.mock('./shared', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./BuyCreditsModal', () => ({
  BuyCreditsModal: () => <div data-testid="buy-credits-modal" />,
}));

function makeGame(overrides = {}) {
  return {
    id: 42,
    name: 'vs Rival FC - 2026-05-01',
    video_size: 5 * 1024 ** 3, // 5 GB
    storage_expires_at: new Date(Date.now() + 10 * 86400000).toISOString(), // 10 days
    ...overrides,
  };
}

describe('StorageExtensionModal', () => {
  const defaultProps = {
    game: makeGame(),
    onClose: vi.fn(),
    onExtensionSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useCreditStore.setState({ balance: 10, loaded: true, fetchCredits: vi.fn() });
  });

  afterEach(() => {
    if (globalThis.fetch?.mockRestore) globalThis.fetch.mockRestore();
  });

  it('renders game name and expiry', () => {
    render(<StorageExtensionModal {...defaultProps} />);
    expect(screen.getByText('vs Rival FC - 2026-05-01')).toBeTruthy();
    expect(screen.getByText(/Expires in 10 day/)).toBeTruthy();
  });

  it('shows correct game size for shared game', () => {
    render(<StorageExtensionModal {...defaultProps} />);
    expect(screen.getByText('5.0 GB')).toBeTruthy();
  });

  it('shows Expired for expired shared game', () => {
    const game = makeGame({
      storage_expires_at: new Date(Date.now() - 86400000).toISOString(),
    });
    render(<StorageExtensionModal {...defaultProps} game={game} />);
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('calculates correct days-per-credit step for 5 GB', () => {
    render(<StorageExtensionModal {...defaultProps} />);
    // 5 GB -> daysPerCredit = 26 days
    expect(screen.getByText(/1 credit \(26d\)/)).toBeTruthy();
  });

  it('calls correct endpoint on extend', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        new_expires_at: new Date(Date.now() + 40 * 86400000).toISOString(),
        cost_credits: 1,
        new_balance: 9,
      }),
    }));
    globalThis.fetch = fetchMock;

    render(<StorageExtensionModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Extend Storage/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/games/42/extend-storage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"days":26'),
        }),
      );
    });
  });

  it('shows buy credits modal when balance insufficient', async () => {
    useCreditStore.setState({ balance: 0 });
    render(<StorageExtensionModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Extend Storage/ }));
    // BuyCreditsModal is lazy-loaded behind Suspense, so it resolves async.
    await waitFor(() => {
      expect(screen.getByTestId('buy-credits-modal')).toBeTruthy();
    });
  });

  it('handles zero video_size gracefully', () => {
    const game = makeGame({ video_size: 0 });
    render(<StorageExtensionModal {...defaultProps} game={game} />);
    // 0 GB -> daysPerCredit returns 30 (STORAGE_DURATION_DAYS default)
    expect(screen.getByText(/1 credit \(30d\)/)).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
  });

  it('handles null video_size gracefully', () => {
    const game = makeGame({ video_size: null });
    render(<StorageExtensionModal {...defaultProps} game={game} />);
    expect(screen.getByText(/1 credit \(30d\)/)).toBeTruthy();
  });

  it('slider adjusts credit count and days', () => {
    render(<StorageExtensionModal {...defaultProps} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '3' } });
    // 3 credits * 26 days/credit = 78 days
    expect(screen.getByText(/\+78 days/)).toBeTruthy();
    expect(screen.getByText(/3 credits for 78 days/)).toBeTruthy();
  });

  it('shows credit balance', () => {
    render(<StorageExtensionModal {...defaultProps} />);
    expect(screen.getByText('Balance: 10')).toBeTruthy();
  });

  it('does not close when backdrop clicked (no accidental dismiss)', () => {
    const onClose = vi.fn();
    render(<StorageExtensionModal {...defaultProps} onClose={onClose} />);
    const backdrop = document.querySelector('.bg-black\\/70');
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
