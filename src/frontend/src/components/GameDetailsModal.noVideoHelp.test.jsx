import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T14810: a parent with no game video on this device must find, inside the
// Upload game modal, how to get it and a one-tap way to upload a play instead.
// The disclosure is collapsed by default and never gates the real upload path.

vi.mock('../stores/questStore', () => {
  const state = { recordAchievement: vi.fn() };
  const useQuestStore = (sel) => (sel ? sel(state) : state);
  useQuestStore.getState = () => state;
  return { useQuestStore };
});

vi.mock('../stores/creditStore', () => {
  const state = { balance: 100, loaded: true, fetchCredits: vi.fn() };
  const useCreditStore = (sel) => sel(state);
  useCreditStore.getState = () => state;
  return { useCreditStore };
});

vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ tournaments: [] }) })),
}));

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

vi.mock('./GameFootagePicker', () => ({
  GameFootagePicker: () => <div data-testid="stub-footage-picker" />,
}));

import { GameDetailsModal } from './GameDetailsModal';

describe('GameDetailsModal - no-video-on-this-phone disclosure (T14810)', () => {
  it('is collapsed by default and reveals the camera steps + switch-to-clip-upload on tap', () => {
    const onSwitchToClipUpload = vi.fn();
    const { container } = render(
      <GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={vi.fn()} onSwitchToClipUpload={onSwitchToClipUpload} />
    );

    const details = container.querySelector('[data-testid="no-video-help"]');
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText("Don't have the game video on this phone?"));

    expect(details.open).toBe(true);
    expect(screen.getByText(/Download the game from your camera/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Upload a play instead' }));
    expect(onSwitchToClipUpload).toHaveBeenCalledTimes(1);
  });
});
