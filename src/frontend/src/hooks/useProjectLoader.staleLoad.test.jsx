import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// T14970: back and forward can start a new open while an older one is still loading. The
// older load must not land its clips in the newer play's editor, where the next gesture
// would pair the new project id with the old play's clip ids.

const { fetchClipsSpy, setProjectClipsSpy, setClipMetadataCacheSpy, setLoadingSpy } = vi.hoisted(() => ({
  fetchClipsSpy: vi.fn(),
  setProjectClipsSpy: vi.fn(),
  setClipMetadataCacheSpy: vi.fn(),
  setLoadingSpy: vi.fn(),
}));

vi.mock('../stores/projectDataStore', () => ({
  useProjectDataStore: () => ({
    setProjectClips: setProjectClipsSpy,
    setWorkingVideo: vi.fn(),
    setLoading: setLoadingSpy,
    updateClipMetadata: vi.fn(),
    setClipMetadataCache: setClipMetadataCacheSpy,
    fetchClips: fetchClipsSpy,
    reset: vi.fn(),
  }),
}));
vi.mock('../stores/focusStore', () => ({ useFocusStore: (sel) => sel({ reset: vi.fn() }) }));
vi.mock('../stores/overlayStore', () => ({ useOverlayStore: (sel) => sel({ reset: vi.fn() }) }));
vi.mock('../stores/videoStore', () => ({ useVideoStore: (sel) => sel({ reset: vi.fn() }) }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn(() => Promise.resolve({ ok: true })) }));
vi.mock('../api/focusActions', () => ({ seedClipVersion: vi.fn() }));

import { useProjectLoader } from './useProjectLoader';

const play = (id) => ({ id, name: `Play ${id}`, working_video_id: null, has_final_video: false, clip_count: 1 });
const clipsOf = (id) => [{ id: id * 10, framing_version: 1 }];

describe('useProjectLoader: an older load loses to a newer one (T14970)', () => {
  let resolveClips;

  beforeEach(() => {
    vi.clearAllMocks();
    resolveClips = {};
    fetchClipsSpy.mockImplementation((id) => new Promise((resolve) => { resolveClips[id] = resolve; }));
  });

  it('drops the older play when its clips land last', async () => {
    const { result } = renderHook(() => useProjectLoader());
    const older = result.current.loadProject(play(1), {});
    const newer = result.current.loadProject(play(2), {});

    resolveClips[2](clipsOf(2));
    await expect(newer).resolves.toMatchObject({ mode: 'framing' });
    setLoadingSpy.mockClear();

    resolveClips[1](clipsOf(1));
    await expect(older).resolves.toMatchObject({ stale: true });

    expect(setProjectClipsSpy).toHaveBeenCalledTimes(1);
    expect(setProjectClipsSpy).toHaveBeenCalledWith({ clips: clipsOf(2) });
    expect(setLoadingSpy).not.toHaveBeenCalled();
  });

  it('drops the older play when its clips land first, and leaves the loading flag to the newer load', async () => {
    const { result } = renderHook(() => useProjectLoader());
    const older = result.current.loadProject(play(1), {});
    const newer = result.current.loadProject(play(2), {});
    setLoadingSpy.mockClear();

    resolveClips[1](clipsOf(1));
    await expect(older).resolves.toMatchObject({ stale: true });
    expect(setProjectClipsSpy).not.toHaveBeenCalled();
    expect(setClipMetadataCacheSpy).not.toHaveBeenCalled();
    expect(setLoadingSpy).not.toHaveBeenCalled();

    resolveClips[2](clipsOf(2));
    await newer;
    expect(setProjectClipsSpy).toHaveBeenCalledWith({ clips: clipsOf(2) });
  });
});
