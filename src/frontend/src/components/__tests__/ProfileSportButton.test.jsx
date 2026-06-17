import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mutable store state so individual tests can vary auth / profile.
const h = vi.hoisted(() => ({
  auth: true,
  isInitialized: true,
  profiles: [{ id: 'vb1', name: 'Fall Volleyball', color: '#06B6D4', sport: 'volleyball', isCurrent: true }],
  currentProfileId: 'vb1',
}));

vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({
    profiles: h.profiles,
    currentProfileId: h.currentProfileId,
    isInitialized: h.isInitialized,
  }),
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ isAuthenticated: h.auth }),
}));
vi.mock('../ManageProfilesModal', () => ({
  ManageProfilesModal: ({ isOpen }) => (isOpen ? <div data-testid="manage-modal" /> : null),
}));

import { ProfileSportButton } from '../ProfileSportButton';

beforeEach(() => {
  h.auth = true;
  h.isInitialized = true;
  h.profiles = [{ id: 'vb1', name: 'Fall Volleyball', color: '#06B6D4', sport: 'volleyball', isCurrent: true }];
  h.currentProfileId = 'vb1';
});

describe('ProfileSportButton', () => {
  it('shows the current sport glyph + profile name and opens the manager on click', () => {
    render(<ProfileSportButton />);
    const btn = screen.getByRole('button', { name: /Volleyball\. Switch sport or profile\./ });
    expect(btn.textContent).toContain('🏐');           // dynamic per current sport
    expect(btn.textContent).toContain('Fall Volleyball'); // bucket label, not an athlete name
    expect(screen.queryByTestId('manage-modal')).toBeNull();

    fireEvent.click(btn);
    expect(screen.getByTestId('manage-modal')).toBeTruthy();
  });

  it('renders nothing when unauthenticated or before profiles initialize', () => {
    h.auth = false;
    const { unmount } = render(<ProfileSportButton />);
    expect(screen.queryByRole('button')).toBeNull();
    unmount();

    h.auth = true;
    h.isInitialized = false;
    render(<ProfileSportButton />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
