import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T12160 (Q9 = B): upload modal 'Sport (for play tags)' row, shown only while the
// profile sport is no_sport, nothing preselected, written to the profile only on Upload.

const { recordAchievementSpy } = vi.hoisted(() => ({ recordAchievementSpy: vi.fn() }));
// T12830: submit probes footage; jsdom cannot decode video, so stub the probe.
vi.mock('../utils/videoMetadata', () => ({ extractVideoMetadata: vi.fn().mockResolvedValue({}) }));
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
import { useProfileStore } from '../stores/profileStore';

const updateProfile = vi.fn(() => Promise.resolve());

function setProfileSport(sport) {
  useProfileStore.setState({
    profiles: [{ id: 'p1', sport, team: 'Hawks' }],
    currentProfileId: 'p1',
    updateProfile,
  });
}

function renderModal(onCreateGame = vi.fn(() => Promise.resolve())) {
  const utils = render(<GameDetailsModal isOpen onClose={vi.fn()} onCreateGame={onCreateGame} />);
  return { ...utils, onCreateGame };
}

function pickFile(container) {
  const input = container.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [new File(['x'.repeat(1024)], 'game.mp4', { type: 'video/mp4' })] } });
}

describe('GameDetailsModal sport picker (T12160)', () => {
  beforeEach(() => updateProfile.mockClear());

  it('shows a Sport (for play tags) row with nothing preselected while the profile sport is no_sport', () => {
    setProfileSport('no_sport');
    renderModal();
    expect(screen.getByText('Sport (for play tags)')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /sport \(for play tags\)/i }).value).toBe('');
  });

  it('is absent once the profile has a sport', () => {
    setProfileSport('soccer');
    renderModal();
    expect(screen.queryByText('Sport (for play tags)')).toBeNull();
  });

  it('does not write the profile when a sport is picked, only on Upload', async () => {
    setProfileSport('no_sport');
    const { container, onCreateGame } = renderModal();
    fireEvent.change(screen.getByRole('combobox', { name: /sport \(for play tags\)/i }), { target: { value: 'soccer' } });
    expect(updateProfile).not.toHaveBeenCalled();
    pickFile(container);
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(onCreateGame).toHaveBeenCalled());
    await waitFor(() => expect(updateProfile).toHaveBeenCalledWith('p1', { sport: 'soccer' }));
  });

  it('leaves the profile alone when no sport was picked', async () => {
    setProfileSport('no_sport');
    const { container, onCreateGame } = renderModal();
    pickFile(container);
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(onCreateGame).toHaveBeenCalled());
    expect(updateProfile).not.toHaveBeenCalled();
  });
});

describe('GameDetailsModal sport picker ordering (T12810)', () => {
  beforeEach(() => updateProfile.mockClear());

  it('saves the picked sport BEFORE handing off to Annotate', async () => {
    setProfileSport('no_sport');
    const sportAtHandoff = [];
    // The real store applies the optimistic patch synchronously inside updateProfile.
    useProfileStore.setState({
      updateProfile: vi.fn(async (id, updates) => {
        useProfileStore.setState(s => ({
          profiles: s.profiles.map(p => (p.id === id ? { ...p, ...updates } : p)),
        }));
      }),
    });
    const onCreateGame = vi.fn(async () => {
      // Annotate mounts here and the tag panel reads the profile sport.
      sportAtHandoff.push(useProfileStore.getState().profiles[0].sport);
    });
    const { container } = renderModal(onCreateGame);
    fireEvent.change(screen.getByRole('combobox', { name: /sport \(for play tags\)/i }), { target: { value: 'soccer' } });
    pickFile(container);
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(onCreateGame).toHaveBeenCalled());
    expect(sportAtHandoff).toEqual(['soccer']);
  });

  it('surfaces a failed sport save and does not hand off or close', async () => {
    setProfileSport('no_sport');
    const { toast } = await import('./shared');
    toast.error.mockClear();
    useProfileStore.setState({ updateProfile: vi.fn(() => Promise.reject(new Error('boom'))) });
    const onClose = vi.fn();
    const onCreateGame = vi.fn(() => Promise.resolve());
    const { container } = render(<GameDetailsModal isOpen onClose={onClose} onCreateGame={onCreateGame} />);
    fireEvent.change(screen.getByRole('combobox', { name: /sport \(for play tags\)/i }), { target: { value: 'soccer' } });
    pickFile(container);
    fireEvent.submit(container.querySelector('form'));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onCreateGame).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
