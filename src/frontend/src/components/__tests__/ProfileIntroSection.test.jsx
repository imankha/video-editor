// T6650 — the Edit Profile intro photo thumbnail must surface a dangling key
// (R2 object gone) as a visible "photo missing" state with a re-upload path,
// never a silently-broken <img>.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ProfileIntroSection } from '../ProfileIntroSection';

afterEach(cleanup);

function renderSection(profileOverrides = {}) {
  const profile = {
    id: 'p',
    isCurrent: false, // avoids the min-duration control (a separate store fetch)
    introConsentAt: '2026-08-08T00:00:00',
    introPhotoKey: 'dev/users/u/profiles/p/intro/dead.png',
    introPhotoUrl: 'http://dead-object',
    full_name: '',
    position: '',
    class: '',
    team: '',
    ...profileOverrides,
  };
  render(<ProfileIntroSection profile={profile} />);
  return profile;
}

describe('ProfileIntroSection intro photo (T6650)', () => {
  it('renders the photo thumbnail when the object loads', () => {
    renderSection();
    expect(screen.getByAltText('Athlete Intro Card')).toBeTruthy();
    expect(screen.queryByTestId('profile-photo-missing')).toBeNull();
  });

  it('shows a visible "photo missing" state with a re-upload path when the image fails to load', () => {
    renderSection();
    fireEvent.error(screen.getByAltText('Athlete Intro Card'));
    expect(screen.getByTestId('profile-photo-missing')).toBeTruthy();
    expect(screen.getByText('Re-upload')).toBeTruthy();
    // Remove is still available (the user-approved recovery is untouched).
    expect(screen.getByText('Remove')).toBeTruthy();
  });
});
