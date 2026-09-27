import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T11240 C1: a project is now exactly one clip (T11220 refuses Framing entry for
// clip_count > 1), so Framing export must ALWAYS post /api/export/render and never
// /api/export/multi-clip. Today (master) `handleExport` still branches on
// `clips.length > 1` and posts /api/export/multi-clip — this is the RED half of the
// C1 -> C5 red-to-green proof. The single-clip case is a characterization: it
// already posts /render on master and must keep doing so after C5.

const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return {
    axiosPost: vi.fn(),
    wsConnect: vi.fn(async () => ({ connected: true })),
    mockStore,
  };
});

vi.mock('axios', () => ({ default: { post: (...a) => h.axiosPost(...a), get: vi.fn() } }));
vi.mock('../components/shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/ExportWebSocketManager', () => ({
  default: { connect: (...a) => h.wsConnect(...a), disconnect: vi.fn(), resetReconnect: vi.fn() },
}));
vi.mock('../contexts', () => ({
  useAppState: () => ({
    editorMode: 'framing',
    selectedProjectId: 123,
    selectedProject: { name: 'My Reel' },
    exportingProject: null,
    setExportingProject: vi.fn(),
    globalExportProgress: null,
    setGlobalExportProgress: vi.fn(),
  }),
}));
vi.mock('../stores', () => ({
  useExportStore: h.mockStore({
    activeExports: {}, completeExport: vi.fn(), failExport: vi.fn(), removeExport: vi.fn(),
  }),
  useAuthStore: h.mockStore({ requireAuth: (action) => action() }),
  useSyncStore: h.mockStore({ isOffline: false }),
  EDITOR_MODES: { FRAMING: 'framing', OVERLAY: 'overlay' },
}));
vi.mock('../stores/creditStore', () => ({
  useCreditStore: h.mockStore({
    balance: 100, fetchCredits: vi.fn(async () => {}), canAffordExport: () => true,
    getRequiredCredits: () => 0, setBalance: vi.fn(),
  }),
}));
vi.mock('../stores/questStore', () => ({ useQuestStore: h.mockStore({ fetchProgress: vi.fn() }) }));
vi.mock('../stores/overlayActionStore', () => ({
  useOverlayActionStore: h.mockStore({ failedActions: [], retryFailedOverlayActions: vi.fn() }),
}));

import { ExportButtonContainer } from './ExportButtonContainer';

const axiosPost = h.axiosPost;

function makeClip(id) {
  return { id, fileName: `clip-${id}.mp4`, duration: 10, segments: {}, cropKeyframes: [{ frame: 0, x: 0, y: 0, width: 10, height: 10 }] };
}

const baseProps = {
  editorMode: 'framing',
  projectId: 123,
  projectName: 'My Reel',
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  saveCurrentClipState: vi.fn().mockResolvedValue(),
  onExportComplete: vi.fn(),
};

beforeEach(() => {
  axiosPost.mockReset();
  axiosPost.mockResolvedValue({ status: 202, data: { export_id: 'e1' } });
  h.wsConnect.mockClear();
});

describe('T11240 C1 — Framing export always posts /api/export/render', () => {
  it('a project with 2 clips still posts /api/export/render, never /api/export/multi-clip', async () => {
    const clips = [makeClip(1), makeClip(2)];
    const { result } = renderHook(() => ExportButtonContainer({ ...baseProps, clips, cropKeyframes: clips[0].cropKeyframes }));

    await act(async () => {
      result.current.handleExport();
    });

    await waitFor(() => expect(axiosPost).toHaveBeenCalled());
    const urls = axiosPost.mock.calls.map((call) => call[0]);
    expect(urls.some((u) => u.includes('/api/export/render'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/export/multi-clip'))).toBe(false);
  });

  it('a single-clip project posts /api/export/render (characterization — true on master and after the fix)', async () => {
    const clips = [makeClip(1)];
    const { result } = renderHook(() => ExportButtonContainer({ ...baseProps, clips, cropKeyframes: clips[0].cropKeyframes }));

    await act(async () => {
      result.current.handleExport();
    });

    await waitFor(() => expect(axiosPost).toHaveBeenCalled());
    const urls = axiosPost.mock.calls.map((call) => call[0]);
    expect(urls.some((u) => u.includes('/api/export/render'))).toBe(true);
    expect(urls.some((u) => u.includes('/api/export/multi-clip'))).toBe(false);
  });
});
