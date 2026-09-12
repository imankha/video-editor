import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T9740 (fix v3) — Test 1: onExportComplete must fire AT MOST ONCE per export.
// The no-keyframes overlay render takes the backend synchronous-200 path, which
// sends the WS `status:"complete"` frame AND returns HTTP 200 — so both transports
// deliver the same completion and (pre-fix) onExportComplete fired TWICE. That
// double-fire is the root of the stranding bug (two handleExportComplete
// invocations racing fetchProjects, the second aborting the first onto a stale
// snapshot). This locks the one-shot `fireExportComplete` guard.
//
// Mock surface mirrors ExportButtonContainer.doubleClick.test.jsx (same idiom).

const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return {
    axiosPost: vi.fn(),
    toastError: vi.fn(),
    // capture the onComplete handler the container registers so the test can
    // deliver a WS `complete` frame for the same export.
    wsOnComplete: { current: null },
    wsConnect: vi.fn(async (id, opts) => { h.wsOnComplete.current = opts?.onComplete ?? null; return { connected: true }; }),
    mockStore,
  };
});

vi.mock('axios', () => ({ default: { post: (...a) => h.axiosPost(...a), get: vi.fn() } }));
vi.mock('../components/shared', () => ({
  toast: { error: (...a) => h.toastError(...a), success: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn(async () => ({ ok: true })) }));
vi.mock('../services/ExportWebSocketManager', () => ({
  default: { connect: (...a) => h.wsConnect(...a), disconnect: vi.fn(), resetReconnect: vi.fn() },
}));
vi.mock('../contexts', () => ({
  useAppState: () => ({
    editorMode: 'overlay',
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
const wsConnect = h.wsConnect;

function makeProps(overrides = {}) {
  return {
    editorMode: 'overlay',
    projectId: 123,
    projectName: 'My Reel',
    highlightEffectType: 'dark_overlay',
    includeAudio: true,
    onIncludeAudioChange: vi.fn(),
    onExportStart: vi.fn(),
    onExportEnd: vi.fn(),
    onExportComplete: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  axiosPost.mockReset();
  wsConnect.mockClear();
  h.wsOnComplete.current = null;
});

describe('T9740 — onExportComplete one-shot guard (ExportButtonContainer)', () => {
  it('synchronous-200 + WS complete (BOTH transports) -> onExportComplete fires EXACTLY ONCE', async () => {
    // Backend no-keyframes path: HTTP 200 (not 202) AND a WS complete frame.
    axiosPost.mockResolvedValue({ status: 200, data: { final_video_id: 6, filename: 'r.mp4' } });
    const props = makeProps();
    const { result } = renderHook(() => ExportButtonContainer(props));

    await act(async () => {
      await result.current.handleExport();
    });
    // HTTP-200 branch already fired onExportComplete once. Now deliver the WS
    // completion frame for the same export (the second transport).
    await act(async () => {
      await h.wsOnComplete.current?.({ status: 'complete' });
    });

    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost.mock.calls[0][0]).toContain('/api/export/render-overlay');
    expect(props.onExportComplete).toHaveBeenCalledTimes(1);
  });

  it('normal 202-then-WS-only path -> onExportComplete fires EXACTLY ONCE (regression guard for the common case)', async () => {
    // 202 = background; the HTTP branch does NOT fire completion — only the WS does.
    axiosPost.mockResolvedValue({ status: 202, data: { export_id: 'e1' } });
    const props = makeProps();
    const { result } = renderHook(() => ExportButtonContainer(props));

    await act(async () => {
      await result.current.handleExport();
    });
    await act(async () => {
      await h.wsOnComplete.current?.({ status: 'complete' });
    });

    expect(props.onExportComplete).toHaveBeenCalledTimes(1);
    expect(props.onExportComplete).toHaveBeenCalledWith({ projectId: 123, mode: 'overlay' });
  });
});
