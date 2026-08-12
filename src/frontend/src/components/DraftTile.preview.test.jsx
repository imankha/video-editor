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
  // The close control stops propagation like the real backdrop/X controls, so
  // it doesn't bubble through the portal back to the card's preview handler.
  MediaPlayer: ({ src, onClose }) => (
    <div>
      <video data-testid="preview-video" src={src} />
      <button data-testid="mp-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>close</button>
    </div>
  ),
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
import { useQuestStore } from '../stores/questStore';
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

// T6840: playing a finished draft's preview for ~1s records previewed_draft_reel_1s
// (quest_4 "Watch Your Preview"). Fires after ~1s, not on open, and cancels if the
// preview is closed before the second elapses — mirrors watched_gallery_video_1s.
describe('T6840 preview-watched achievement', () => {
  const readyProject = { has_final_video: true, is_published: false, final_video_id: 99 };

  beforeEach(() => {
    useQuestStore.getState().recordAchievement.mockClear();
  });

  const openPreview = () => {
    // Ready-state action bar carries the "Preview video" button.
    fireEvent.click(screen.getByLabelText('Preview video'));
  };

  it('records previewed_draft_reel_1s after ~1s of playback, not on open', () => {
    renderTile(readyProject);
    openPreview();
    expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalledWith('previewed_draft_reel_1s');
    act(() => vi.advanceTimersByTime(1000));
    expect(useQuestStore.getState().recordAchievement).toHaveBeenCalledWith('previewed_draft_reel_1s');
  });

  it('does NOT record it if the preview is closed before ~1s', () => {
    renderTile(readyProject);
    openPreview();
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(screen.getByTestId('mp-close'));
    act(() => vi.advanceTimersByTime(1000));
    expect(useQuestStore.getState().recordAchievement).not.toHaveBeenCalledWith('previewed_draft_reel_1s');
  });
});
