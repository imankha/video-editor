import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T9930: the global referral "Invite" control moved OUT of the front-and-center
// home top-right cluster and INTO the account menu (ProfileDropdown), so it no
// longer competes with Upload game on a fresh home. It must stay reachable and
// still invoke the same referral share (`shareInvite`).

const { shareInviteSpy } = vi.hoisted(() => ({ shareInviteSpy: vi.fn() }));
vi.mock('../utils/inviteEmail', () => ({ shareInvite: shareInviteSpy }));

const authState = {
  isAuthenticated: true,
  email: 'parent@example.com',
  pictureUrl: null,
  logout: vi.fn(),
  requireAuth: vi.fn(),
  openAccountSettings: vi.fn(),
};
vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel(authState),
}));

vi.mock('../stores', () => ({
  useProfileStore: (sel) => sel({ isInitialized: true }),
}));

import { ProfileDropdown } from './ProfileDropdown';

describe('ProfileDropdown — T9930 Invite relocation', () => {
  beforeEach(() => {
    shareInviteSpy.mockClear();
  });

  it('exposes "Invite a friend" inside the account menu and calls shareInvite on click', () => {
    render(<ProfileDropdown />);
    // Closed by default — the referral share is one click away, not front-and-center.
    expect(screen.queryByText('Invite a friend')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: authState.email }));

    const invite = screen.getByText('Invite a friend');
    expect(invite).toBeTruthy();
    expect(shareInviteSpy).not.toHaveBeenCalled();

    fireEvent.click(invite);
    expect(shareInviteSpy).toHaveBeenCalledTimes(1);
  });
});
