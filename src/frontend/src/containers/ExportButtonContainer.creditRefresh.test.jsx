import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T17030: the server takes the sharpen's credits when it accepts POST /api/export/render,
// so the credit chip must re-read the balance right then, not when the render finishes
// minutes later. The pre-flight fetchCredits() runs BEFORE the POST (pre-charge balance);
// this asserts a fetch AFTER the POST was accepted.

const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return {
    axiosPost: vi.fn(),
    fetchCredits: vi.fn(async () => {}),
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
    balance: 100, fetchCredits: (...a) => h.fetchCredits(...a), canAffordExport: () => true,
    getRequiredCredits: () => 8, setBalance: vi.fn(),
  }),
}));
vi.mock('../stores/overlayActionStore', () => ({
  useOverlayActionStore: h.mockStore({ failedActions: [], retryFailedOverlayActions: vi.fn() }),
}));

import { ExportButtonContainer } from './ExportButtonContainer';

const clip = { id: 1, fileName: 'clip-1.mp4', duration: 8, segments: {}, cropKeyframes: [{ frame: 0, x: 0, y: 0, width: 10, height: 10 }] };

const props = {
  editorMode: 'framing',
  projectId: 123,
  projectName: 'My Reel',
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  onExportComplete: vi.fn(),
  clips: [clip],
  cropKeyframes: clip.cropKeyframes,
};

beforeEach(() => {
  h.axiosPost.mockReset();
  h.fetchCredits.mockClear();
  h.wsConnect.mockClear();
});

function renderCalls() {
  return h.axiosPost.mock.invocationCallOrder.filter((_, i) => h.axiosPost.mock.calls[i][0].includes('/api/export/render'));
}

describe('T17030: credit balance refreshes as soon as a sharpen is accepted', () => {
  it('re-reads /api/credits after POST /api/export/render returns 202 (charge taken)', async () => {
    h.axiosPost.mockResolvedValue({ status: 202, data: { status: 'accepted', export_id: 'e1' } });
    const { result } = renderHook(() => ExportButtonContainer(props));

    await act(async () => {
      await result.current.handleExport();
    });

    await waitFor(() => expect(renderCalls().length).toBe(1));
    const [renderOrder] = renderCalls();
    const fetchesAfterCharge = h.fetchCredits.mock.invocationCallOrder.filter((o) => o > renderOrder);
    expect(fetchesAfterCharge.length).toBeGreaterThanOrEqual(1);
  });

  it('does not re-read when the render POST is refused before any charge (409 in flight)', async () => {
    h.axiosPost.mockRejectedValue({ response: { status: 409, data: { detail: { code: 'export_in_flight' } } } });
    const { result } = renderHook(() => ExportButtonContainer(props));

    await act(async () => {
      await result.current.handleExport();
    });

    await waitFor(() => expect(renderCalls().length).toBe(1));
    const [renderOrder] = renderCalls();
    expect(h.fetchCredits.mock.invocationCallOrder.filter((o) => o > renderOrder)).toEqual([]);
  });
});
