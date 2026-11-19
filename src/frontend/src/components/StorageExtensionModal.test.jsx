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
import { daysPerCredit } from '../utils/storageCost';

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
    // 5 GB -> derived from the shared storage formula (T10210), not a literal
    const step = daysPerCredit(5 * 1024 ** 3);
    expect(screen.getByText(`1 credit (${step}d)`, { exact: false })).toBeTruthy();
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
    fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/games/42/extend-storage'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining(`"days":${daysPerCredit(5 * 1024 ** 3)}`),
        }),
      );
    });
  });

  // T17670: the server keys the charge by request_id, so a resend of one tap is one
  // charge. Each tap carries its own id; a double tap sends one request.
  describe('T17670 request id per tap', () => {
    function okFetch() {
      return vi.fn(async () => ({
        ok: true,
        json: async () => ({ success: true, new_expires_at: new Date().toISOString() }),
      }));
    }
    const sentIds = (fetchMock) => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).request_id);

    it('sends a request_id with the extend request', async () => {
      const fetchMock = okFetch();
      globalThis.fetch = fetchMock;
      render(<StorageExtensionModal {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [id] = sentIds(fetchMock);
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(id.length).toBeLessThanOrEqual(64);
    });

    it('a double tap sends one request', async () => {
      const fetchMock = okFetch();
      globalThis.fetch = fetchMock;
      render(<StorageExtensionModal {...defaultProps} />);
      const button = screen.getByRole('button', { name: /Extend storage/ });
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sentIds(fetchMock)[0]).toBeTruthy();
    });

    it('two separate taps send two different request ids', async () => {
      const fetchMock = okFetch();
      globalThis.fetch = fetchMock;
      render(<StorageExtensionModal {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));
      await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledTimes(2));
      const [first, second] = sentIds(fetchMock);
      expect(first).toBeTruthy();
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
    });
  });

  // The backend rejects days > 365 with a 422 (ExtendStorageRequest), so the largest
  // slider position must never send more, whatever the game size does to the step.
  it.each([
    ['zero size (30d step)', 0],
    ['5 GB', 5 * 1024 ** 3],
    ['1 MB (step far above 365d)', 1024 ** 2],
  ])('never sends more than 365 days at the max slider position: %s', async (_label, size) => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ success: true, new_expires_at: new Date().toISOString() }),
    }));
    globalThis.fetch = fetchMock;
    useCreditStore.setState({ balance: 1000 }); // max slider must not route to Buy credits

    render(<StorageExtensionModal {...defaultProps} game={makeGame({ video_size: size })} />);
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: slider.max } });
    fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const { days } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(days).toBeGreaterThanOrEqual(1);
    expect(days).toBeLessThanOrEqual(365);
  });

  it('shows buy credits modal when balance insufficient', async () => {
    useCreditStore.setState({ balance: 0 });
    render(<StorageExtensionModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));
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
    // 3 credits * days-per-credit, derived from the shared storage formula (T10210)
    const days = 3 * daysPerCredit(5 * 1024 ** 3);
    expect(screen.getByText(`+${days} days`, { exact: false })).toBeTruthy();
    // T11770: the cost/duration line is now the stacked CreditCostRow — cost on one
    // line, the "for N days" note below — so the two facts live in separate nodes.
    expect(screen.getByText('Cost: 3 credits')).toBeTruthy();
    expect(screen.getByText(`Adds ${days} days of storage.`)).toBeTruthy();
  });

  it('shows credit balance', () => {
    render(<StorageExtensionModal {...defaultProps} />);
    // T11770: CreditCostRow renders the balance with the "credits" noun attached.
    expect(screen.getByText(/Balance:\s*10 credits/)).toBeTruthy();
  });

  it('does not close when backdrop clicked (no accidental dismiss)', () => {
    const onClose = vi.fn();
    render(<StorageExtensionModal {...defaultProps} onClose={onClose} />);
    const backdrop = document.querySelector('.bg-black\\/70');
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });
});
