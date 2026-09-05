import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8500: the Add Game modal is video-first. The cost line renders BEFORE any
// file is selected, all four metadata fields are defaulted inside a collapsed
// disclosure, and the ONLY thing gating submit is a selected video - so a new
// user can start an upload with two gestures (pick file, tap Add Game).

const { recordAchievementSpy } = vi.hoisted(() => ({ recordAchievementSpy: vi.fn() }));
vi.mock('../stores/questStore', () => {
  const state = { recordAchievement: recordAchievementSpy };
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

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// Stub the picker (its own suite covers intake/probe/folder behavior). The stub
// exposes a file input that, on change, reports the normalized footage payload up
// exactly as the real picker does: files:[{file, sequence}] + totalBytes.
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

import { GameDetailsModal, localTodayISO } from './GameDetailsModal';
import { GameType } from '../constants/gameConstants';

function renderModal(props = {}) {
  return render(
    <GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={vi.fn()} {...props} />
  );
}

function pickFile(container) {
  const input = container.querySelector('input[type="file"]');
  const file = new File(['x'.repeat(1024)], 'game.mp4', { type: 'video/mp4' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('GameDetailsModal — T8500 video-first', () => {
  beforeEach(() => {
    recordAchievementSpy.mockClear();
  });

  it('shows the cost line (credits + 30-day expiry + balance) BEFORE any file is selected', () => {
    renderModal();
    // 2 credits = the pre-selection minimum (1 storage credit + auto-export surcharge)
    expect(screen.getByText(/2 credits - keeps your video for 30 days/)).toBeTruthy();
    expect(screen.getByText(/Balance:\s*88/)).toBeTruthy();
  });

  it('T8955: has no "More options" disclosure at all — Game Type is always visible', () => {
    renderModal();
    // The collapsed disclosure is gone outright, not just defaulted-open.
    expect(screen.queryByTestId('game-details-disclosure')).toBeNull();
    expect(screen.queryByText('More options')).toBeNull();
    // Game Type's four buttons are reachable with zero interaction.
    expect(screen.getByRole('button', { name: 'Unknown' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Away' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tournament' })).toBeTruthy();
  });

  it('surfaces Opponent + Date as first-class fields (T8700)', () => {
    const { container } = renderModal();
    // Opponent input (its placeholder) and the date input are reachable with
    // zero interaction — they read as wanted, not skippable.
    expect(screen.getByPlaceholderText('e.g., Carlsbad SC')).toBeTruthy();
    expect(container.querySelector('input[type="date"]')).toBeTruthy();
  });

  it('disables submit until a file is selected, then enables it with zero typing', () => {
    const { container } = renderModal();
    const submit = screen.getByRole('button', { name: 'Add Game' });
    expect(submit.disabled).toBe(true);

    pickFile(container);
    expect(submit.disabled).toBe(false);
  });

  it('submits the defaults in the create payload: placeholder opponent, today, Unknown type + a 1-element footage list', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });

    const file = pickFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    // T8810: uniform ordered list — a single file is a 1-element list, no videoMode.
    // T8930: Game Type defaults to Unknown (never a silently-assumed Home) unless the
    // user picks one of the always-visible buttons (T8955 removed the disclosure).
    expect(onCreateGame).toHaveBeenCalledWith({
      opponentName: 'Unnamed opponent',
      gameDate: localTodayISO(),
      gameType: GameType.UNKNOWN,
      tournamentName: null,
      files: [{ file, sequence: 1 }],
    });
  });

  it('a typed opponent wins over the placeholder', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });

    pickFile(container);
    fireEvent.change(screen.getByPlaceholderText('e.g., Carlsbad SC'), {
      target: { value: 'Carlsbad SC' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    expect(onCreateGame.mock.calls[0][0].opponentName).toBe('Carlsbad SC');
  });

  it('still fires upload_file_selected from the file-select gesture after the reorder', () => {
    const { container } = renderModal();
    pickFile(container);
    expect(recordAchievementSpy).toHaveBeenCalledWith('upload_file_selected');
  });
});
