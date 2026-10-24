// T12860: clicking the card TITLE must open the highlight like the thumbnail does.
// Mirrors the harness in DraftTile.test.jsx (real useIsCoarsePointer, stubbed stores).
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
});

vi.mock('../utils/finishedReelNav', () => ({ openFinishedReel: vi.fn() }));
vi.mock('./shared/Toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: vi.fn(), renameProject: vi.fn(), selectedProjectId: null };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
vi.mock('../stores/syncStore', () => {
  const state = { isOffline: false };
  const useSyncStore = (sel) => sel(state);
  useSyncStore.getState = () => state;
  return { useSyncStore };
});
vi.mock('../stores/exportStore', () => {
  const state = { activeExports: {} };
  const useExportStore = (sel) => sel(state);
  useExportStore.getState = () => state;
  return { useExportStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: vi.fn() };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: vi.fn() };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});
vi.mock('../stores/profileStore', () => ({ useCurrentProfile: () => ({ id: 'p1', sport: 'soccer' }) }));
const { downloadsApi } = vi.hoisted(() => ({
  downloadsApi: { downloadFile: vi.fn().mockResolvedValue(undefined), downloadingId: null },
}));
vi.mock('../hooks/useDownloads', () => ({ useDownloads: () => downloadsApi, default: () => downloadsApi }));

import { DraftTile } from './DraftTile';
import { openFinishedReel } from '../utils/finishedReelNav';

const base = {
  id: 7, name: 'Brilliant Dribble', aspect_ratio: '9:16', clip_count: 1,
  clips_in_progress: 1, clips_exported: 0, has_working_video: false,
  has_final_video: false, is_published: false, is_auto_created: false, game_ids: [],
};

function renderTile(overrides = {}) {
  const onSelect = vi.fn();
  const onSelectWithMode = vi.fn();
  render(<DraftTile project={{ ...base, ...overrides }} onSelect={onSelect}
    onSelectWithMode={onSelectWithMode} onDelete={vi.fn()} />);
  return { onSelect, onSelectWithMode };
}

describe('DraftTile title click (T12860)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('in-progress card: title click opens the draft', () => {
    const { onSelectWithMode } = renderTile();
    fireEvent.click(screen.getByRole('heading', { name: 'Brilliant Dribble' }));
    expect(onSelectWithMode).toHaveBeenCalledWith({ mode: 'framing' });
  });

  it('generated highlight (working video, not finished): title click opens Spotlight', () => {
    const { onSelectWithMode } = renderTile({ has_working_video: true, clips_in_progress: 0 });
    fireEvent.click(screen.getByRole('heading', { name: 'Brilliant Dribble' }));
    expect(onSelectWithMode).toHaveBeenCalledWith({ mode: 'overlay' });
  });

  it('ready card: title click previews the finished video', () => {
    renderTile({ has_final_video: true, final_video_id: 99 });
    fireEvent.click(screen.getByRole('heading', { name: 'Brilliant Dribble' }));
    expect(openFinishedReel).toHaveBeenCalledTimes(1);
  });

  it('ready card with no playable final_video_id still opens the draft (not a dead click)', () => {
    const { onSelectWithMode, onSelect } = renderTile({
      has_final_video: true, has_working_video: true, final_video_id: null, clips_in_progress: 0,
    });
    fireEvent.click(screen.getByRole('heading', { name: 'Brilliant Dribble' }));
    expect(openFinishedReel).not.toHaveBeenCalled();
    expect(onSelectWithMode.mock.calls.length + onSelect.mock.calls.length).toBe(1);
  });

  it('rename pencil still renames without opening the card', () => {
    const { onSelectWithMode, onSelect } = renderTile();
    fireEvent.click(screen.getByRole('button', { name: /rename/i }));
    expect(onSelectWithMode).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Brilliant Dribble')).toBeTruthy();
  });
});
