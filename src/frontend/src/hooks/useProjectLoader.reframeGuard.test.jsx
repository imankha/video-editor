import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// T11220 — loadProject is a SEPARATE Framing entry point from the mode-switch
// guards: it computes the project's default open mode. A framing-only legacy
// multi-clip draft (clip_count > 1, no working video) opened with no explicit
// mode (e.g. Home "continue finishing", which calls onSelectProject) resolves
// targetMode='framing' and used to drop straight into Focus. This proves the
// project-load guard refuses it — with PRODUCTION-shaped input: `project` is the
// ProjectDetailResponse (which now carries clip_count) that selectProject returns.

const { fetchClipsSpy, resetSpy, setLoadingSpy, toastInfoSpy, apiFetchSpy } = vi.hoisted(() => ({
  fetchClipsSpy: vi.fn(async () => []),
  resetSpy: vi.fn(),
  setLoadingSpy: vi.fn(),
  toastInfoSpy: vi.fn(),
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
// allowEnterFraming toasts through this singleton; spy on it.
vi.mock('../components/shared/Toast', () => ({
  toast: { info: toastInfoSpy, success: vi.fn(), error: vi.fn() },
}));

import { useProjectLoader } from './useProjectLoader';
import { EDITOR_MODES } from '../stores/editorStore';
import { LEGACY_MULTICLIP_REFRAME_MESSAGE } from '../utils/reelReEditable';

// Production shapes: exactly what GET /api/projects/{id} (ProjectDetailResponse)
// returns for these two cases — clip_count is a real field on that response now.
const multiClipDraft = { id: 70, name: 'Legacy Reel', working_video_id: null, has_final_video: false, clip_count: 2 };
const singleClipDraft = { id: 71, name: 'Clip', working_video_id: null, has_final_video: false, clip_count: 1 };

describe('useProjectLoader.loadProject re-frame guard (T11220)', () => {
  beforeEach(() => {
    fetchClipsSpy.mockClear();
    toastInfoSpy.mockClear();
    apiFetchSpy.mockClear();
  });

  it('REFUSES a framing-only multi-clip draft: lands on ProjectManager, no clip fetch, clear toast', async () => {
    const { result } = renderHook(() => useProjectLoader());

    const loaded = await result.current.loadProject(multiClipDraft, {});

    expect(loaded.mode).toBe(EDITOR_MODES.PROJECT_MANAGER); // NOT framing
    expect(loaded.refused).toBe(true);
    expect(fetchClipsSpy).not.toHaveBeenCalled();           // expensive load skipped
    expect(apiFetchSpy).not.toHaveBeenCalled();             // no current_mode=framing PATCH
    expect(toastInfoSpy).toHaveBeenCalledWith(LEGACY_MULTICLIP_REFRAME_MESSAGE);
  });

  it('a single-clip draft still defaults into Framing and loads normally (no false positive)', async () => {
    const { result } = renderHook(() => useProjectLoader());

    const loaded = await result.current.loadProject(singleClipDraft, {});

    expect(loaded.mode).toBe('framing');
    expect(fetchClipsSpy).toHaveBeenCalledWith(71);
    expect(toastInfoSpy).not.toHaveBeenCalled();
  });
});
