/**
 * T4940: CreditHistoryModal renders usage history from /credits/transactions
 * with a correct running balance derived from the authoritative current balance.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { CreditHistoryModal } from './CreditHistoryModal';
import { useCreditStore } from '../stores/creditStore';

// Newest-first, as the endpoint returns. Current balance = 67.
const TXNS = [
  { id: 3, amount: 60, source: 'stripe_purchase', reference_id: 'pi_1', video_seconds: null, created_at: '2026-07-24 10:00:00' },
  { id: 2, amount: -6, source: 'framing_export', reference_id: 'job_9', video_seconds: 6, created_at: '2026-07-23 10:00:00' },
  { id: 1, amount: 13, source: 'quest_reward', reference_id: 'q1', video_seconds: null, created_at: '2026-07-22 10:00:00' },
];

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: true, json: async () => TXNS });
  useCreditStore.setState({ balance: 67, loaded: true });
});

describe('CreditHistoryModal (T4940)', () => {
  it('renders humanized source labels', async () => {
    render(<CreditHistoryModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Credit purchase')).toBeTruthy());
    expect(screen.getByText('Video export')).toBeTruthy();
    expect(screen.getByText('Quest reward')).toBeTruthy();
  });

  it('shows signed amounts', async () => {
    render(<CreditHistoryModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('+60')).toBeTruthy());
    expect(screen.getByText('-6')).toBeTruthy();
    expect(screen.getByText('+13')).toBeTruthy();
  });

  it('computes running balance backward from current balance', async () => {
    render(<CreditHistoryModal onClose={vi.fn()} />);
    // Balance after newest (purchase) = 67 (current).
    // After export row = 67 - 60 = 7. After quest row = 7 - (-6) = 13.
    await waitFor(() => expect(screen.getByText('67')).toBeTruthy());
    expect(screen.getByText('7')).toBeTruthy();
    expect(screen.getByText('13')).toBeTruthy();
  });

  it('shows an empty state when there is no activity', async () => {
    apiFetch.mockResolvedValue({ ok: true, json: async () => [] });
    render(<CreditHistoryModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/No credit activity yet/)).toBeTruthy());
  });
});
