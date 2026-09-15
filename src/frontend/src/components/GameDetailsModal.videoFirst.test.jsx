import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8500: the Add Game modal is video-first. The cost line renders BEFORE any
// file is selected, all four metadata fields are defaulted inside a collapsed
// disclosure, and the ONLY thing gating submit is a selected video - so a new
// user can start an upload with two gestures (pick file, tap Add Game).
// T9930: opponent/date/type are collapsed behind a "Game details (optional)"
// disclosure again, and untouched metadata is submitted EMPTY (no fabricated
// "Unnamed opponent"/today) so the backend titles the game by its upload date.

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

import { GameDetailsModal } from './GameDetailsModal';
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

  it('T9930: opponent/date/type sit behind a collapsed "Game details (optional)" disclosure', () => {
    renderModal();
    const disclosure = screen.getByTestId('game-details-disclosure');
    // Collapsed by default (native <details> without the `open` attribute), so
    // the metadata does not compete with the file picker on first upload.
    expect(disclosure.tagName).toBe('DETAILS');
    expect(disclosure.open).toBe(false);
    expect(screen.getByText('Game details (optional)')).toBeTruthy();
    // The fields still live in the DOM inside the disclosure (Game Type buttons,
    // the opponent input, the date input) — reachable, just not front-and-center.
    expect(within(disclosure).getByRole('button', { name: 'Unknown' })).toBeTruthy();
    expect(within(disclosure).getByPlaceholderText('e.g., Carlsbad SC')).toBeTruthy();
    expect(disclosure.querySelector('input[type="date"]')).toBeTruthy();
  });

  it('keeps Opponent + Date reachable inside the disclosure (T9930 — collapsed, not removed)', () => {
    const { container } = renderModal();
    // T9930 re-collapsed these behind "Game details (optional)" (was first-class
    // per T8700); they must still be present/reachable in the DOM, just not
    // front-and-center. jsdom keeps <details> children mounted regardless of open.
    expect(screen.getByPlaceholderText('e.g., Carlsbad SC')).toBeTruthy();
    expect(container.querySelector('input[type="date"]')).toBeTruthy();
  });

  it('disables submit until a file is selected, then enables it with zero typing', () => {
    const { container } = renderModal();
    const submit = screen.getByRole('button', { name: 'Upload game' });
    expect(submit.disabled).toBe(true);

    pickFile(container);
    expect(submit.disabled).toBe(false);
  });

  it('submits HONEST empty defaults (T9930): no fabricated opponent, no today date', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });

    const file = pickFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'Upload game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    // T8810: uniform ordered list — a single file is a 1-element list, no videoMode.
    // T9930: an untouched opponent and date submit EMPTY (createGame maps '' -> null),
    // so the backend titles the game "Game uploaded <date>" instead of claiming a
    // match opponent/date the parent never gave. Game Type still defaults to Unknown.
    expect(onCreateGame).toHaveBeenCalledWith({
      opponentName: '',
      gameDate: '',
      gameType: GameType.UNKNOWN,
      tournamentName: null,
      files: [{ file, sequence: 1 }],
    });
  });

  it('a typed opponent is sent as-is', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });

    pickFile(container);
    fireEvent.change(screen.getByPlaceholderText('e.g., Carlsbad SC'), {
      target: { value: 'Carlsbad SC' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Upload game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    expect(onCreateGame.mock.calls[0][0].opponentName).toBe('Carlsbad SC');
  });

  it('still fires upload_file_selected from the file-select gesture after the reorder', () => {
    const { container } = renderModal();
    pickFile(container);
    expect(recordAchievementSpy).toHaveBeenCalledWith('upload_file_selected');
  });
});
