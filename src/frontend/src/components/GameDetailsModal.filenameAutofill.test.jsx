import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Filename autofill: a recognizable "match-<team>-vs-<opponent>-<date>" export
// (Veo and similar) pre-fills Opponent/Date and opens the "Game details
// (optional)" disclosure so the parent can review it, without overwriting
// anything already typed. A successful submit confirms the guessed team onto
// the profile, but only when the profile doesn't already have one on record.

const { recordAchievementSpy, setIntroFactSpy, profileState } = vi.hoisted(() => ({
  recordAchievementSpy: vi.fn(),
  setIntroFactSpy: vi.fn(() => Promise.resolve('ok')),
  profileState: { profile: { id: 'p1', team: '' } },
}));

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

vi.mock('../stores/profileStore', () => ({
  useProfileStore: (sel) =>
    sel({
      profiles: [profileState.profile],
      currentProfileId: profileState.profile.id,
      setIntroFact: setIntroFactSpy,
    }),
}));

vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ tournaments: [] }) })),
}));

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

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

function renderModal(props = {}) {
  return render(
    <GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={vi.fn(() => Promise.resolve())} {...props} />
  );
}

function pickFile(container, name) {
  const input = container.querySelector('input[type="file"]');
  const file = new File(['x'.repeat(1024)], name, { type: 'video/mp4' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

const VEO_NAME = 'match-west-coast-fc-ecnl-vs-sporting-ca-ecnl-2026-09-13.mp4';

describe('GameDetailsModal — filename autofill', () => {
  beforeEach(() => {
    recordAchievementSpy.mockClear();
    setIntroFactSpy.mockClear();
    profileState.profile = { id: 'p1', team: '' };
  });

  it('fills opponent + date from a recognizable filename and opens the details disclosure', () => {
    const { container } = renderModal();
    pickFile(container, VEO_NAME);

    const disclosure = screen.getByTestId('game-details-disclosure');
    expect(disclosure.open).toBe(true);
    expect(screen.getByPlaceholderText('e.g., Carlsbad SC').value).toBe('Sporting CA ECNL');
    expect(disclosure.querySelector('input[type="date"]').value).toBe('2026-09-13');
  });

  it('leaves the form untouched for a filename with no recognizable pattern', () => {
    const { container } = renderModal();
    pickFile(container, 'GX010045.mp4');

    const disclosure = screen.getByTestId('game-details-disclosure');
    expect(disclosure.open).toBe(false);
    expect(screen.getByPlaceholderText('e.g., Carlsbad SC').value).toBe('');
  });

  it('never overwrites a value the parent already typed', () => {
    const { container } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g., Carlsbad SC'), {
      target: { value: 'My Typed Opponent' },
    });
    pickFile(container, VEO_NAME);

    expect(screen.getByPlaceholderText('e.g., Carlsbad SC').value).toBe('My Typed Opponent');
  });

  it('confirms the parsed team onto the profile on submit when the profile has none on record', async () => {
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });
    pickFile(container, VEO_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Upload game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(setIntroFactSpy).toHaveBeenCalledWith('p1', 'team', 'West Coast FC ECNL')
    );
  });

  it('does not overwrite an existing profile team', async () => {
    profileState.profile = { id: 'p1', team: 'Existing Club' };
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = renderModal({ onCreateGame });
    pickFile(container, VEO_NAME);
    fireEvent.click(screen.getByRole('button', { name: 'Upload game' }));

    await waitFor(() => expect(onCreateGame).toHaveBeenCalledTimes(1));
    expect(setIntroFactSpy).not.toHaveBeenCalled();
  });
});
