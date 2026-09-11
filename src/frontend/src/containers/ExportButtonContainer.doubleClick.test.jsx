import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T9540 §3a/§5/§6: the two substantive FE guarantees of the double-click fix —
//   (a) a rapid double-click issues exactly ONE render POST (the synchronous inFlightRef
//       latch closes the pre-dispatch await window the button-disable can't cover), and
//   (b) a backend 409 export_in_flight is SWALLOWED (no "Export failed" toast/error) —
//       the first job already drives the UI.
// The durable no-duplicate-charge guarantee is the backend guard (test_t9540_double_
// dispatch_guard.py); these lock the client behavior the design named as owed.
//
// Overlay mode is used because it is the simplest dispatch path (no credit gating).

// ---- Mocked module surface (established renderHook + vi.mock idiom) --------------------
// vi.mock is hoisted above top-level consts, so everything the factories close over lives
// in vi.hoisted().
const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return {
    axiosPost: vi.fn(),
    toastError: vi.fn(),
    wsConnect: vi.fn(async () => ({ connected: true })),
    mockStore,
  };
});

vi.mock('axios', () => ({ default: { post: (...a) => h.axiosPost(...a), get: vi.fn() } }));
vi.mock('../components/shared', () => ({
  toast: { error: (...a) => h.toastError(...a), success: vi.fn(), info: vi.fn() },
}));
// Health check always OK so handleExport reaches the dispatch.
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
  useAuthStore: h.mockStore({ requireAuth: (action) => action() }), // authenticated: run now
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
const toastError = h.toastError;
const wsConnect = h.wsConnect;

const props = {
  editorMode: 'overlay',
  projectId: 123,
  projectName: 'My Reel',
  highlightEffectType: 'dark_overlay',
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  onExportStart: vi.fn(),
  onExportEnd: vi.fn(),
  onExportComplete: vi.fn(),
};

beforeEach(() => {
  axiosPost.mockReset();
  toastError.mockReset();
  wsConnect.mockClear();
});

describe('T9540 — double-click / 409 export_in_flight (ExportButtonContainer)', () => {
  it('(a) a rapid double-click issues exactly ONE render POST (inFlightRef latch)', async () => {
    axiosPost.mockResolvedValue({ status: 202, data: { export_id: 'e1' } });
    const { result } = renderHook(() => ExportButtonContainer(props));

    // Two synchronous clicks — the second must bail at the latch before any POST.
    await act(async () => {
      result.current.handleExport();
      result.current.handleExport();
    });

    await waitFor(() => expect(axiosPost).toHaveBeenCalledTimes(1));
    expect(axiosPost.mock.calls[0][0]).toContain('/api/export/render-overlay');
  });

  it('(b) a 409 export_in_flight is swallowed — no error state, no error toast', async () => {
    axiosPost.mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'export_in_flight' } } },
    });
    const { result } = renderHook(() => ExportButtonContainer(props));

    await act(async () => {
      result.current.handleExport();
    });

    await waitFor(() => expect(axiosPost).toHaveBeenCalled());
    // The duplicate is not a failure: no error surfaced, no failure toast.
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(toastError).not.toHaveBeenCalled();
    expect(result.current.isExporting).toBe(false);
  });
});
