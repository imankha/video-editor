import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8500: the header credits chip gets a one-time first-run explainer for
// zero-game accounts. Dismissal is IN-MEMORY ONLY (module flag) - no
// localStorage, no backend write - per the project no-persisted-view-state rule.

const { creditState } = vi.hoisted(() => ({
  creditState: { balance: 88, loaded: true, fetchCredits: vi.fn() },
}));
vi.mock('../stores/creditStore', () => {
  const useCreditStore = (sel) => sel(creditState);
  useCreditStore.getState = () => creditState;
  return { useCreditStore };
});

vi.mock('../stores/authStore', () => ({
  useIsAuthenticated: () => true,
}));

vi.mock('../services/ExportWebSocketManager', () => ({
  default: { addEventListener: vi.fn(() => vi.fn()) },
}));

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { CreditBalance, resetFirstRunHintDismissalForTests } from './CreditBalance';

describe('CreditBalance — T8500 first-run hint', () => {
  beforeEach(() => {
    resetFirstRunHintDismissalForTests();
  });

  it('shows the explainer for a zero-game account (showFirstRunHint)', () => {
    render(<CreditBalance showFirstRunHint />);
    expect(screen.getByTestId('credit-first-run-hint').textContent)
      .toBe('You start with 88 free credits');
  });

  it('never shows without the derived zero-game signal (default prop)', () => {
    render(<CreditBalance />);
    expect(screen.queryByTestId('credit-first-run-hint')).toBeNull();
  });

  it('dismisses on any click and stays dismissed across a remount (in-memory only)', () => {
    const { unmount } = render(<CreditBalance showFirstRunHint />);
    expect(screen.getByTestId('credit-first-run-hint')).toBeTruthy();

    fireEvent.click(document.body);
    expect(screen.queryByTestId('credit-first-run-hint')).toBeNull();

    // Remount (e.g. navigating home again): module-level memory keeps it dismissed.
    unmount();
    render(<CreditBalance showFirstRunHint />);
    expect(screen.queryByTestId('credit-first-run-hint')).toBeNull();

    // No view state was persisted anywhere.
    expect(localStorage.length).toBe(0);
  });
});
