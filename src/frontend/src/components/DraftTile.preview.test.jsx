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

// T8535: DraftTile no longer mounts its own preview player — Preview calls the
// shared openFinishedReel helper (see DraftTile.test.jsx's "consolidated draft
// preview" coverage, and DraftReelPreview.test.jsx for the moved
// previewed_draft_reel_1s achievement timer).
vi.mock('../utils/finishedReelNav', () => ({ openFinishedReel: vi.fn() }));
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
import { PREVIEW_WARM_DELAY_MS, PREVIEW_REVEAL_DELAY_MS } from '../hooks/useTilePreview';

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

  it('"Not Started"/"Framing" draft with no streamable source clip shows no preview at all', () => {
    // No clips array -> no first-clip stream id -> nothing to preview (T6820 gate).
    const { video, hoverAndWarm } = renderTile({ has_working_video: false, final_video_id: null });
    hoverAndWarm();
    expect(video()).toBeNull();
  });
});

// T6820: a Not-Started draft has neither a final nor a working video, but its source
// clip is streamable via the bounded proxy. clips[0].stream_clip_id (a working_clips.id
// from the projects payload) yields the URL; source_start/end_time seek the preview
// into the clip window. Absent stream_clip_id (expired/no working clip) -> no preview.
describe('T6820 DraftTile hover preview — Not Started source-clip fallback', () => {
  const sourceClip = { id: 5, stream_clip_id: 42, source_start_time: 12.5, source_end_time: 20.0 };

  it('warms from the bounded clip-stream proxy using clips[0].stream_clip_id', () => {
    const { video, hoverAndWarm } = renderTile({
      has_working_video: false,
      final_video_id: null,
      clips: [sourceClip],
    });
    hoverAndWarm();
    expect(video().getAttribute('src')).toBe('/api/clips/projects/7/clips/42/stream');
  });

  it('passes the source-window offsets so the preview seeks into the clip and disables native loop', () => {
    const { container, hoverAndWarm } = renderTile({
      has_working_video: false,
      final_video_id: null,
      clips: [sourceClip],
    });
    hoverAndWarm();
    const video = container.querySelector('video[preload="none"]');
    expect(video.hasAttribute('loop')).toBe(false);
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(12.5);
  });

  it('a final video still wins over the source clip (no window offsets applied)', () => {
    const { video, container, hoverAndWarm } = renderTile({
      has_final_video: true,
      final_video_id: 99,
      clips: [sourceClip],
    });
    hoverAndWarm();
    expect(video().getAttribute('src')).toBe('/api/downloads/99/stream');
    // Final path keeps native loop-from-0 (the file IS the clip).
    expect(container.querySelector('video[preload="none"]').hasAttribute('loop')).toBe(true);
  });

  it('a working video still wins over the source clip', () => {
    const { video, hoverAndWarm } = renderTile({
      has_working_video: true,
      final_video_id: null,
      clips: [sourceClip],
    });
    hoverAndWarm();
    expect(video().getAttribute('src')).toBe('/api/projects/7/working_video/stream');
  });

  it('a clip row without a stream_clip_id (expired / no working clip) shows no preview', () => {
    const { video, hoverAndWarm } = renderTile({
      has_working_video: false,
      final_video_id: null,
      clips: [{ id: 5, tags: ['Goal'] }], // display-only clip, not streamable
    });
    hoverAndWarm();
    expect(video()).toBeNull();
  });

  // Regression (user report 2026-08-14, generalized 2026-08-14): ALL hover-preview
  // tiers reveal at max(the ~450ms floor, real content-load-ready time) -- never
  // floor PLUS load time. The source-clip tier pays real network seek latency
  // (moov + byte-range fetch) that can exceed the floor; once content genuinely
  // becomes ready past the floor, reveal must fire immediately, no further
  // artificial wait stacked on top.
  it('a slow load (past the floor) reveals the INSTANT content is ready, no extra artificial wait', () => {
    const { video } = renderTile({
      has_working_video: false,
      final_video_id: null,
      clips: [sourceClip],
    });
    fireEvent.pointerEnter(screen.getByTestId('project-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    // Well past the reveal floor -- content still hasn't signaled ready.
    act(() => vi.advanceTimersByTime(2000));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    // Real content-load-ready signal finally arrives -- reveal fires immediately,
    // not after another artificial wait.
    fireEvent.loadedData(video());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('a fast load (before the floor) still waits for the ~450ms floor (flicker avoidance)', () => {
    const { video } = renderTile({
      has_working_video: false,
      final_video_id: null,
      clips: [sourceClip],
    });
    fireEvent.pointerEnter(screen.getByTestId('project-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    // Content ready almost immediately -- should NOT reveal yet, floor not reached.
    fireEvent.loadedData(video());
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });
});

// Final/working-video tiers share the exact same max(floor, content-ready) policy
// as the source-clip tier above -- one mechanism, all tiers, per the 2026-08-14
// "artificial delay = floor - load latency" directive.
describe('Shared reveal policy — floor vs. content-ready race (all preview tiers)', () => {
  it('final/working-video tiers still wait for the ~450ms floor even if content is ready instantly', () => {
    const { video } = renderTile({ has_working_video: true, final_video_id: null });
    fireEvent.pointerEnter(screen.getByTestId('project-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    fireEvent.loadedData(video());
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('final/working-video tiers do not reveal on the floor alone -- content-ready is still required', () => {
    renderTile({ has_working_video: true, final_video_id: null });
    fireEvent.pointerEnter(screen.getByTestId('project-card'));
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });
});

// T8535: the previewed_draft_reel_1s achievement timer (formerly T6840, tested
// here against DraftTile's own modal) moved into DraftReelPreview along with
// the preview surface itself — see DraftReelPreview.test.jsx's "T6840/T8535
// preview-watched achievement" coverage.
