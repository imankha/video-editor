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

// A brand new account: one profile, loaded (T17090).
const { profileState } = vi.hoisted(() => ({
  profileState: { isInitialized: true, profiles: [{ id: 'p1' }] },
}));
vi.mock('../stores/profileStore', () => ({
  useProfileStore: (sel) => sel(profileState),
}));

vi.mock('../stores/authStore', () => ({
  useIsAuthenticated: () => true,
}));

vi.mock('../services/ExportWebSocketManager', () => ({
  default: { addEventListener: vi.fn(() => vi.fn()) },
}));

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { CreditBalance, resetFirstRunHintDismissalForTests, isNewAccountForCreditHint } from './CreditBalance';

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

// T12530:C2/C3 the hint is one unbroken line directly under the pill, at every width.
describe('CreditBalance first-run hint layout (T12530)', () => {
  beforeEach(() => resetFirstRunHintDismissalForTests());

  it('never wraps, is not pushed down over the page, and sits right under the pill', () => {
    render(<CreditBalance showFirstRunHint />);
    const cls = screen.getByTestId('credit-first-run-hint').className.split(/\s+/);
    expect(cls).toContain('whitespace-nowrap');
    expect(cls).not.toContain('whitespace-normal');
    expect(cls.some((c) => /^max-w-/.test(c))).toBe(false);
    expect(cls.some((c) => /^(sm:)?mt-\[/.test(c))).toBe(false);
  });
});

// T17090: the bubble is a brand new account's welcome. A second profile has no
// games either, but its credits are the account's own, not a gift.
describe('isNewAccountForCreditHint (T17090)', () => {
  beforeEach(() => {
    resetFirstRunHintDismissalForTests();
    profileState.isInitialized = true;
    profileState.profiles = [{ id: 'p1' }];
  });

  it('a brand new account (one profile, no games) sees the bubble once', () => {
    expect(isNewAccountForCreditHint({ profileHasNoGames: true, profilesLoaded: true, profileCount: 1 })).toBe(true);
    render(<CreditBalance showFirstRunHint />);
    expect(screen.getByTestId('credit-first-run-hint').textContent).toBe('You start with 88 free credits');
    fireEvent.click(document.body);
    expect(screen.queryByTestId('credit-first-run-hint')).toBeNull();
  });

  it('a second profile with no games shows no bubble', () => {
    profileState.profiles = [{ id: 'p1' }, { id: 'p2' }];
    expect(isNewAccountForCreditHint({ profileHasNoGames: true, profilesLoaded: true, profileCount: 2 })).toBe(false);
    render(<CreditBalance showFirstRunHint />);
    expect(screen.queryByTestId('credit-first-run-hint')).toBeNull();
  });

  it('is false while profiles are loading, and when the profile has games', () => {
    expect(isNewAccountForCreditHint({ profileHasNoGames: true, profilesLoaded: false, profileCount: 0 })).toBe(false);
    expect(isNewAccountForCreditHint({ profileHasNoGames: false, profilesLoaded: true, profileCount: 1 })).toBe(false);
  });
});
