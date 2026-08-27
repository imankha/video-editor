import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// T7850: the Tags section is a three-way branch driven by the current profile's
// sport — known tag set / "No Sport" warning / custom-sport silent.
const h = vi.hoisted(() => ({ sport: 'no_sport' }));

vi.mock('../../stores', () => ({
  useCurrentProfile: () => ({ sport: h.sport }),
}));

import { UploadClipModal } from '../UploadClipModal';

const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });

function renderModal() {
  return render(
    <UploadClipModal
      isOpen
      onClose={() => {}}
      onUpload={() => {}}
      selectedFile={file}
      existingClips={[]}
    />
  );
}

beforeEach(() => {
  h.sport = 'no_sport';
});

describe('UploadClipModal — Tags section by sport (T7850)', () => {
  it('shows the "No Sport" warning (not a blank section) when sport is unset', () => {
    h.sport = 'no_sport';
    renderModal();
    expect(screen.getByText(/Set your sport to see sport-specific tags/i)).toBeTruthy();
    // The tag picker must not render for a no-sport profile.
    expect(screen.queryByRole('button', { name: 'Goal' })).toBeNull();
  });

  it('renders the tag picker (no warning) for a known sport', () => {
    h.sport = 'soccer';
    renderModal();
    expect(screen.queryByText(/Set your sport to see sport-specific tags/i)).toBeNull();
    expect(screen.getByRole('button', { name: 'Goal' })).toBeTruthy();
  });

  it('stays silent (no warning, no tags) for a custom/"Other" sport', () => {
    h.sport = 'pickleball';
    renderModal();
    expect(screen.queryByText(/Set your sport to see sport-specific tags/i)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Goal' })).toBeNull();
  });
});
