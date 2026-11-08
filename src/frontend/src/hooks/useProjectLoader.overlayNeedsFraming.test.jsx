import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// T15260: Overlay for a project with no working video yet has nothing to show (the
// locked Spotlight tab, T12130). ModeSwitcher already disables that tab in-app, but
// /overlay/p/{id} can ask for Overlay directly. Proves loadProject resolves this to
// Framing and flags the redirect, instead of silently loading the locked Overlay mode.

const { fetchClipsSpy, resetSpy, setLoadingSpy, apiFetchSpy } = vi.hoisted(() => ({
  fetchClipsSpy: vi.fn(async () => []),
  resetSpy: vi.fn(),
  setLoadingSpy: vi.fn(),
  apiFetchSpy: vi.fn(() => Promise.resolve({ ok: true })),
}));

vi.mock('../stores/projectDataStore', () => ({
  useProjectDataStore: () => ({
    setProjectClips: vi.fn(),
    setWorkingVideo: vi.fn(),
    setLoading: setLoadingSpy,
    updateClipMetadata: vi.fn(),
    setClipMetadataCache: vi.fn(),
    fetchClips: fetchClipsSpy,
    reset: resetSpy,
  }),
}));
vi.mock('../stores/focusStore', () => ({ useFocusStore: (sel) => sel({ reset: vi.fn() }) }));
vi.mock('../stores/overlayStore', () => ({ useOverlayStore: (sel) => sel({ reset: vi.fn() }) }));
vi.mock('../stores/videoStore', () => ({ useVideoStore: (sel) => sel({ reset: vi.fn() }) }));
vi.mock('../utils/apiFetch', () => ({ default: apiFetchSpy }));
vi.mock('../api/focusActions', () => ({ seedClipVersion: vi.fn() }));
vi.mock('../components/shared/Toast', () => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}));

import { useProjectLoader } from './useProjectLoader';
import { EDITOR_MODES } from '../stores/editorStore';

// Production shape: GET /api/projects/{id} for a play never framed yet.
const noWorkingVideoProject = { id: 80, name: 'Unframed Play', working_video_id: null, has_final_video: false, clip_count: 1 };
const framedProject = { id: 81, name: 'Framed Play', working_video_id: 9, working_video_url: null, has_final_video: false, clip_count: 1 };

describe('useProjectLoader.loadProject overlay-needs-framing redirect (T15260)', () => {
  beforeEach(() => {
    fetchClipsSpy.mockClear();
    apiFetchSpy.mockClear();
  });

  it('an explicit Overlay request for a project with no working video resolves to Framing and flags the redirect', async () => {
    const { result } = renderHook(() => useProjectLoader());

    const loaded = await result.current.loadProject(noWorkingVideoProject, { mode: EDITOR_MODES.OVERLAY });

    expect(loaded.mode).toBe(EDITOR_MODES.FRAMING);
    expect(loaded.redirectedFromOverlay).toBe(true);
    expect(fetchClipsSpy).toHaveBeenCalledWith(80); // still loads -- Framing needs the clips
  });

  it('an explicit Overlay request for a project that HAS a working video is unaffected (no false positive)', async () => {
    const { result } = renderHook(() => useProjectLoader());

    const loaded = await result.current.loadProject(framedProject, { mode: EDITOR_MODES.OVERLAY });

    expect(loaded.mode).toBe(EDITOR_MODES.OVERLAY);
    expect(loaded.redirectedFromOverlay).toBe(false);
  });
});
