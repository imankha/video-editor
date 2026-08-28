import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// T7850: the Tags section is a three-way branch driven by the current profile's
// sport — known tag set / "No Sport" prompt / custom-sport silent.
// T7922: the "No Sport" prompt is now an actionable inline sport picker.
const h = vi.hoisted(() => ({ sport: 'no_sport' }));

vi.mock('../../stores', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: h.sport }),
  // UploadClipModal reads updateProfile to wire the inline picker (T7922).
  useProfileStore: (selector) => selector({ updateProfile: vi.fn() }),
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

describe('UploadClipModal — Tags section by sport (T7850 / T7922)', () => {
  it('shows the actionable inline sport picker (not a blank section) when sport is unset', () => {
    h.sport = 'no_sport';
    renderModal();
    // T7922: the no_sport prompt is an inline sport picker, not dead prose.
    expect(screen.getByRole('combobox', { name: /change sport/i })).toBeTruthy();
    expect(screen.getByText(/Pick your sport to tag this clip/i)).toBeTruthy();
    // The tag picker must not render for a no-sport profile.
    expect(screen.queryByRole('button', { name: 'Goal' })).toBeNull();
  });

  it('renders the tag picker (no sport picker) for a known sport', () => {
    h.sport = 'soccer';
    renderModal();
    expect(screen.queryByRole('combobox', { name: /change sport/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Goal' })).toBeTruthy();
  });

  it('stays silent (no picker, no tags) for a custom/"Other" sport', () => {
    h.sport = 'pickleball';
    renderModal();
    expect(screen.queryByRole('combobox', { name: /change sport/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Goal' })).toBeNull();
  });
});
