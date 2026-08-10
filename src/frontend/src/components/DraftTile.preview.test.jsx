import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same jsdom stubbing rationale as DraftTile.test.jsx / ReelTile.preview.test.jsx —
// exercise the REAL useTilePreview -> useIsCoarsePointer path, not a mocked hook.
let coarsePointer = false;
beforeEach(() => {
  coarsePointer = false;
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse') ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.load = vi.fn();
  HTMLMediaElement.prototype.pause = vi.fn();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

vi.mock('./MediaPlayer', () => ({
  MediaPlayer: ({ src }) => <video data-testid="preview-video" src={src} />,
}));
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

import { DraftTile } from './DraftTile';
import { PREVIEW_WARM_DELAY_MS } from '../hooks/useTilePreview';

const baseProject = {
  id: 7,
  name: 'Brilliant Dribble',
  aspect_ratio: '9:16',
  clip_count: 1,
  clips_in_progress: 1,
  clips_exported: 0,
  has_working_video: false,
  has_final_video: false,
  is_published: false,
  is_auto_created: false,
  game_ids: [],
};

function renderTile(overrides = {}) {
  const result = render(
    <DraftTile
      project={{ ...baseProject, ...overrides }}
      onSelect={vi.fn()}
      onSelectWithMode={vi.fn()}
      onDelete={vi.fn()}
    />
  );
  const video = () => result.container.querySelector('video[preload="none"]');
  const hoverAndWarm = () => {
    fireEvent.pointerEnter(screen.getByTestId('project-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
  };
  return { ...result, video, hoverAndWarm };
}

describe('T6441 DraftTile hover preview — In Overlay fallback', () => {
  it('"In Overlay" draft (has_working_video, no final_video_id) warms from the working-video stream', () => {
    const { video, hoverAndWarm } = renderTile({ has_working_video: true, final_video_id: null });
    hoverAndWarm();
    expect(video().getAttribute('src')).toBe('/api/projects/7/working_video/stream');
  });

  it('"Ready"/"Done" draft still prefers the final-video stream even if has_working_video is also true', () => {
    const { video, hoverAndWarm } = renderTile({
      has_working_video: true,
      has_final_video: true,
      final_video_id: 99,
    });
    hoverAndWarm();
    expect(video().getAttribute('src')).toBe('/api/downloads/99/stream');
  });

  it('"Not Started"/"Framing" draft (neither working nor final video) shows no preview at all', () => {
    const { video, hoverAndWarm } = renderTile({ has_working_video: false, final_video_id: null });
    hoverAndWarm();
    expect(video()).toBeNull();
  });
});
