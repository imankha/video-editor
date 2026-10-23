import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T12830: a file the browser cannot read as video must be rejected inside the
// Upload dialog (dialog stays open, readable error) BEFORE handing off to Annotate.

const { extractSpy } = vi.hoisted(() => ({ extractSpy: vi.fn() }));
vi.mock('../utils/videoMetadata', () => ({ extractVideoMetadata: extractSpy }));
vi.mock('../stores/questStore', () => {
  const state = { recordAchievement: vi.fn() };
  const useQuestStore = (sel) => (sel ? sel(state) : state);
  useQuestStore.getState = () => state;
  return { useQuestStore };
});
vi.mock('../stores/creditStore', () => {
  const state = { balance: 88, loaded: true, fetchCredits: vi.fn() };
  const useCreditStore = (sel) => sel(state);
  useCreditStore.getState = () => state;
  return { useCreditStore };
});
vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ tournaments: [] }) })),
}));
vi.mock('./shared', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('./GameFootagePicker', () => ({
  GameFootagePicker: ({ onFootageChange, onFileSelected }) => (
    <input
      type="file"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        onFileSelected?.();
        onFootageChange?.({ files: [{ file, sequence: 1 }], totalBytes: file.size, proxies: {} });
      }}
    />
  ),
}));

import { GameDetailsModal } from './GameDetailsModal';

function setup() {
  const onCreateGame = vi.fn();
  const onClose = vi.fn();
  const { container } = render(
    <GameDetailsModal isOpen onClose={onClose} onCreateGame={onCreateGame} />
  );
  const file = new File(['not a video'], 'tiny.txt', { type: 'text/plain' });
  fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } });
  return { onCreateGame, onClose };
}

describe('GameDetailsModal invalid file (T12830)', () => {
  it('keeps the dialog open with an error and never hands off when the probe rejects', async () => {
    extractSpy.mockRejectedValueOnce(new Error('Failed to load video metadata'));
    const { onCreateGame, onClose } = setup();
    fireEvent.submit(document.querySelector('form'));
    expect((await screen.findByRole('alert')).textContent).toMatch(/isn't a video we can open/);
    expect(onCreateGame).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('hands off when the probe succeeds', async () => {
    extractSpy.mockResolvedValueOnce({ width: 1, height: 1, duration: 1 });
    const { onCreateGame } = setup();
    fireEvent.submit(document.querySelector('form'));
    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
  });
});
