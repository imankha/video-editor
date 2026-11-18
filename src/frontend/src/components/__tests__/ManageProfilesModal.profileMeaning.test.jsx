import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T17260: a profile is one athlete in one sport for one season, and both the
// profile list and the Add profile window must say so.

const h = vi.hoisted(() => ({ profiles: [] }));

vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({
    profiles: h.profiles,
    createProfile: vi.fn(),
    updateProfile: vi.fn(),
    deleteProfile: vi.fn(),
    switchProfile: vi.fn(),
  }),
  useEditorStore: (sel) => sel({ setEditorMode: vi.fn() }),
  EDITOR_MODES: { ADMIN: 'admin' },
}));
vi.mock('../ProfileIntroSection', () => ({
  ProfileIntroSection: () => <div data-testid="profile-intro-section" />,
}));
vi.mock('../introcards/IntroCardsModal', () => ({
  IntroCardsModal: () => null,
}));

import { ManageProfilesModal } from '../ManageProfilesModal';

const MEANING = 'One profile for each athlete, sport and season.';

beforeEach(() => {
  h.profiles = [
    { id: 'p1', name: 'Maya', color: '#3B82F6', sport: 'soccer', isCurrent: true },
    { id: 'p2', name: 'Leo', color: '#10B981', sport: 'basketball', isCurrent: false },
  ];
});

describe('ManageProfilesModal explains what a profile is (T17260)', () => {
  it('the profile list says a profile is for each athlete, sport and season', () => {
    render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText(MEANING)).toBeTruthy();
  });

  it('the Add profile window says it as a subtitle and as the name hint', () => {
    render(<ManageProfilesModal isOpen={true} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Add profile/ }));
    expect(screen.getByText(MEANING)).toBeTruthy();
    expect(screen.getByText('One profile for each athlete, sport and season. Games and highlights stay separate in each.')).toBeTruthy();
    expect(screen.getByText('Profile name')).toBeTruthy();
    expect(screen.getByPlaceholderText('e.g. Maya, Fall Soccer 2026')).toBeTruthy();
  });
});
