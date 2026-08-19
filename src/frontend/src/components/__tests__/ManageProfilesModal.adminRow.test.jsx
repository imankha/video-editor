import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T7200: the floating, mispositioned AdminButton was removed from App.jsx.
// Admin access now surfaces as a gated row at the top of the profile
// switcher instead, so an admin never has to hunt for a separate control.

const initialProfiles = () => [
  { id: 'p1', name: 'Active Player', color: '#3B82F6', sport: 'soccer', isCurrent: true },
];

const h = vi.hoisted(() => ({
  profiles: [],
  isAdmin: false,
  setEditorMode: vi.fn(),
}));

vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({
    profiles: h.profiles,
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    switchProfile: vi.fn(),
  }),
  useEditorStore: (sel) => sel({ setEditorMode: h.setEditorMode }),
  EDITOR_MODES: { ADMIN: 'admin' },
}));
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ isAdmin: h.isAdmin }),
}));
vi.mock('../ProfileIntroSection', () => ({
  ProfileIntroSection: () => <div data-testid="profile-intro-section" />,
}));
vi.mock('../introcards/IntroCardsModal', () => ({
  IntroCardsModal: () => null,
}));

import { ManageProfilesModal } from '../ManageProfilesModal';

beforeEach(() => {
  h.profiles = initialProfiles();
  h.isAdmin = false;
  h.setEditorMode.mockReset();
});

describe('ManageProfilesModal — Admin row (T7200)', () => {
  it('shows no Admin row for a non-admin user', () => {
    render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  });

  it('shows an Admin row for an admin user, above the real profiles', () => {
    h.isAdmin = true;
    render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
    const adminRow = screen.getByRole('button', { name: 'Admin' });
    const profileRow = screen.getByText('Active Player');
    // DOCUMENT_POSITION_FOLLOWING (4) on profileRow means adminRow comes first.
    expect(adminRow.compareDocumentPosition(profileRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('has no sport/edit/delete controls, unlike a real profile row', () => {
    h.isAdmin = true;
    render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
    // Real profile rows expose a sport selector and an Edit icon button; the
    // Admin row is a plain navigation button with none of those. With one
    // real profile in the list, exactly one of each should exist overall —
    // proving the Admin row doesn't carry its own copy.
    expect(screen.getAllByTitle('Change sport')).toHaveLength(1);
    expect(screen.getAllByTitle(/Edit name/)).toHaveLength(1);
  });

  it('clicking the Admin row closes the modal and opens the Admin panel', () => {
    h.isAdmin = true;
    const onClose = vi.fn();
    render(<ManageProfilesModal isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }));
    expect(onClose).toHaveBeenCalled();
    expect(h.setEditorMode).toHaveBeenCalledWith('admin');
  });
});
