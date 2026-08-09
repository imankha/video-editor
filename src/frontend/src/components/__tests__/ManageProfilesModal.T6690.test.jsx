import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// T6690: editing a non-active profile used to render dead grey text ("Switch to
// this profile to manage its intro cards.") with no affordance at all. It must
// now be a real button that switches to that profile AND opens its card
// library in one action.

const initialProfiles = () => [
  { id: 'p1', name: 'Active Player', color: '#3B82F6', sport: 'soccer', isCurrent: true },
  { id: 'p2', name: 'Other Player', color: '#10B981', sport: 'soccer', isCurrent: false },
];

const h = vi.hoisted(() => ({
  profiles: [],
  switchProfile: vi.fn(),
}));

vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({
    profiles: h.profiles,
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    switchProfile: h.switchProfile,
  }),
}));
vi.mock('../ProfileIntroSection', () => ({
  ProfileIntroSection: () => <div data-testid="profile-intro-section" />,
}));
vi.mock('../introcards/IntroCardsModal', () => ({
  IntroCardsModal: ({ isOpen }) => (isOpen ? <div data-testid="intro-cards-modal" /> : null),
}));

import { ManageProfilesModal } from '../ManageProfilesModal';

beforeEach(() => {
  h.profiles = initialProfiles();
  h.switchProfile.mockReset();
  h.switchProfile.mockResolvedValue(undefined);
  // Switching flips isCurrent in the store, mirroring the real gesture's effect
  // (editingProfile is derived live from `profiles`, per the component's own comment).
  h.switchProfile.mockImplementation(async (id) => {
    h.profiles = h.profiles.map(p => ({ ...p, isCurrent: p.id === id }));
  });
});

function openEditForNonActiveProfile() {
  render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
  // Row order matches h.profiles: [Active Player, Other Player] -> edit-pencil index 1.
  fireEvent.click(screen.getAllByTitle(/Edit name/)[1]);
}

describe('ManageProfilesModal — non-active-profile card management (T6690)', () => {
  it('shows a real button instead of dead grey text for a non-active profile', () => {
    openEditForNonActiveProfile();
    expect(screen.queryByText(/Switch to this profile to manage its intro cards/)).toBeNull();
    expect(screen.getByRole('button', { name: /Switch to "Other Player" & manage Athlete Intro Cards/ })).toBeTruthy();
  });

  it('clicking it switches profile and opens the card library in one action', async () => {
    openEditForNonActiveProfile();
    fireEvent.click(screen.getByRole('button', { name: /Switch to "Other Player" & manage Athlete Intro Cards/ }));

    expect(h.switchProfile).toHaveBeenCalledWith('p2');
    await waitFor(() => expect(screen.getByTestId('intro-cards-modal')).toBeTruthy());
  });

  it('the active profile still shows the real "Athlete Intro Cards" button unchanged', () => {
    render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByTitle(/Edit name/)[0]);
    expect(screen.getByRole('button', { name: 'Athlete Intro Cards' })).toBeTruthy();
  });
});
