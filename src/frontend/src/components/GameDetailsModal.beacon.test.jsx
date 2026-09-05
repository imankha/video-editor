import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T7890: `upload_file_selected` must fire at the real file-select gesture (input
// change or dropzone drop) inside GameDetailsModal — NOT at upload start — so a
// user who picks a file but abandons the details form / hits the T7590 dead-end is
// distinguishable from one who never picked a file (task acceptance criterion).

const { recordAchievementSpy } = vi.hoisted(() => ({ recordAchievementSpy: vi.fn() }));
vi.mock('../stores/questStore', () => {
  const state = { recordAchievement: recordAchievementSpy };
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

// Stub the picker so this file tests the MODAL's beacon wiring (onFileSelected ->
// recordAchievement). The per-path beacon coverage lives in GameFootagePicker.test.
vi.mock('./GameFootagePicker', () => ({
  GameFootagePicker: ({ onFootageChange, onFileSelected }) => (
    <input
      type="file"
      data-testid="stub-footage-input"
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

describe('GameDetailsModal — T7890 upload_file_selected beacon', () => {
  beforeEach(() => {
    recordAchievementSpy.mockClear();
  });

  function renderModal() {
    return render(
      <GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={vi.fn()} />
    );
  }

  it('fires upload_file_selected when a file is chosen via the input', () => {
    const { container } = renderModal();
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();

    const file = new File(['x'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.change(input, { target: { files: [file] } });

    expect(recordAchievementSpy).toHaveBeenCalledWith('upload_file_selected');
  });

  it('does NOT fire before any file is chosen (opening the picker alone is not a selection)', () => {
    renderModal();
    // Modal is open (its own gesture add_game_opened is ProjectManager's job), but
    // no file picked yet -> no File Selected footprint.
    expect(screen.getByText('Add New Game')).toBeTruthy();
    expect(recordAchievementSpy).not.toHaveBeenCalled();
  });
});
