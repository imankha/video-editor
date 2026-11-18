import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T17200: the floating "You start with N free credits" caption under the chip sat under
// the coach's shade and was gone after Got it. The sentence now lives in the Home coach /
// empty Games state; the chip is bare and carries a testid so the coach can cut it out.

vi.mock('../stores/creditStore', () => {
  const state = { balance: 88, loaded: true, fetchCredits: vi.fn() };
  const useCreditStore = (sel) => sel(state);
  useCreditStore.getState = () => state;
  return { useCreditStore };
});
vi.mock('../stores/authStore', () => ({ useIsAuthenticated: () => true }));
vi.mock('../services/ExportWebSocketManager', () => ({ default: { addEventListener: vi.fn(() => vi.fn()) } }));
vi.mock('./shared', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));

import { CreditBalance } from './CreditBalance';

describe('CreditBalance (T17200)', () => {
  it('shows only the chip: no free-credits caption, chip has the credit-balance testid', () => {
    render(<CreditBalance showFirstRunHint />);
    expect(screen.queryByText(/free credits/)).toBeNull();
    expect(screen.queryByTestId('credit-first-run-hint')).toBeNull();
    expect(screen.getByTestId('credit-balance').textContent).toBe('88');
  });
});
