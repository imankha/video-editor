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

  it('shows a photo thumbnail under the button when the profile has one, none otherwise', () => {
    const { container, rerender } = render(<ProfileSportButton />);
    expect(container.querySelector('img')).toBeNull(); // no introPhotoUrl on the fixture profile

    h.profiles = [{ ...h.profiles[0], introPhotoUrl: 'https://r2/photo.jpg' }];
    rerender(<ProfileSportButton />);
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.src).toBe('https://r2/photo.jpg');
  });

  // The R2 object can be gone while the key survives (T6650: deleting an intro
  // card hard-deletes the object the profile photo also points at). Without the
  // guard this renders a permanent broken-image icon in the header.
  it('hides the thumbnail when the photo object is gone (dead R2 key)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.profiles = [{ ...h.profiles[0], introPhotoUrl: 'https://r2/dead.jpg' }];
    const { container } = render(<ProfileSportButton />);

    fireEvent.error(container.querySelector('img'));

    expect(container.querySelector('img')).toBeNull();
    expect(warn).toHaveBeenCalled();               // dangling key is reported, not swallowed
    expect(screen.getByRole('button')).toBeTruthy(); // the button itself still works
    warn.mockRestore();
  });

  it('retries after a re-upload, since suppression is keyed on the URL', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    h.profiles = [{ ...h.profiles[0], introPhotoUrl: 'https://r2/dead.jpg' }];
    const { container, rerender } = render(<ProfileSportButton />);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();

    h.profiles = [{ ...h.profiles[0], introPhotoUrl: 'https://r2/fresh.jpg' }];
    rerender(<ProfileSportButton />);
    expect(container.querySelector('img')?.src).toBe('https://r2/fresh.jpg');
  });
});
