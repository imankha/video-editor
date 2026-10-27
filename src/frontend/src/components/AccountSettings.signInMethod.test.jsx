import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T13410: Account Settings must say how the account actually signs in.
// An email-code account used to read "Signed in with Google" / "Google Account: Linked"
// because the label keyed off `!!email`.

vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import { AccountSettings } from './AccountSettings';
import { useAuthStore } from '../stores/authStore';
import { useCreditStore } from '../stores/creditStore';

function openAs({ googleLinked }) {
  useAuthStore.setState({
    showAccountSettings: true,
    email: 'player@example.com',
    pictureUrl: null,
    googleLinked,
  });
  useCreditStore.setState({ loaded: false, balance: 0 });
}

describe('AccountSettings sign-in method (T13410)', () => {
  beforeEach(() => {
    useAuthStore.setState({ showAccountSettings: false });
  });

  it('T13410:C1 email-code account shows email sign-in and no Google linked', () => {
    openAs({ googleLinked: false });
    render(<AccountSettings />);
    expect(screen.getByText('Signed in with email code')).toBeTruthy();
    expect(screen.queryByText('Signed in with Google')).toBeNull();
    expect(screen.queryByText('Linked')).toBeNull();
  });

  it('T13410:C2 Google account still shows Google and Linked', () => {
    openAs({ googleLinked: true });
    render(<AccountSettings />);
    expect(screen.getByText('Signed in with Google')).toBeTruthy();
    expect(screen.getByText('Linked')).toBeTruthy();
  });
});
