import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T12250: the upload modal owns its inline guide (choose -> submit).

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
import { GUIDE } from '../config/displayNames';

describe('GameDetailsModal guide (T12250)', () => {
  it('shows the choose guide, then the submit guide once a file is picked; guide sits in the dropzone block', () => {
    render(<GameDetailsModal isOpen onClose={() => {}} onCreateGame={vi.fn()} />);
    const dropzone = screen.getByTestId('upload-dropzone');
    expect(dropzone.contains(screen.getByTestId('upload-guide'))).toBe(true);
    expect(screen.getByText(GUIDE.upload.choose.title)).toBeTruthy();

    const file = new File(['x'], 'g.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByTestId('stub-footage-input'), { target: { files: [file] } });
    expect(screen.getByText(GUIDE.upload.submit.title)).toBeTruthy();
    expect(screen.queryByText(GUIDE.upload.choose.title)).toBeNull();
  });
});
