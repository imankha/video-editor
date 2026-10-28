import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T13780: a WS reconnect (e.g. after a backend restart orphaned the render) must
// reconcile with the server via /modal-status instead of waiting on a completion
// frame the new process will never push.

const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return {
    axiosPost: vi.fn(),
    axiosGet: vi.fn(),
    wsConnect: vi.fn(async () => ({ connected: true })),
    completeExport: vi.fn(),
    mockStore,
  };
});

vi.mock('axios', () => ({ default: { post: (...a) => h.axiosPost(...a), get: (...a) => h.axiosGet(...a) } }));
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
    activeExports: {}, completeExport: h.completeExport, failExport: vi.fn(), removeExport: vi.fn(),
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

import { API_BASE } from '../config';
import { ExportButtonContainer } from './ExportButtonContainer';

const clip = { id: 1, fileName: 'clip-1.mp4', duration: 10, segments: {}, cropKeyframes: [{ frame: 0, x: 0, y: 0, width: 10, height: 10 }] };

const baseProps = {
  editorMode: 'framing',
  projectId: 123,
  projectName: 'My Reel',
  includeAudio: true,
  onIncludeAudioChange: vi.fn(),
  saveCurrentClipState: vi.fn().mockResolvedValue(),
  onExportComplete: vi.fn(),
  clips: [clip],
  cropKeyframes: clip.cropKeyframes,
};

async function startExportAndGetReconnect() {
  const { result } = renderHook(() => ExportButtonContainer({ ...baseProps }));
  await act(async () => {
    result.current.handleExport();
  });
  await waitFor(() => expect(h.wsConnect).toHaveBeenCalled());
  const callbacks = h.wsConnect.mock.calls[0][1];
  const exportId = h.wsConnect.mock.calls[0][0];
  return { result, callbacks, exportId };
}

beforeEach(() => {
  h.axiosPost.mockReset();
  h.axiosGet.mockReset();
  h.wsConnect.mockClear();
  h.completeExport.mockClear();
  baseProps.onExportComplete.mockClear();
  h.axiosPost.mockResolvedValue({ status: 202, data: { export_id: 'e1' } });
});

describe('T13780 — WS reconnect reconciles with the server', () => {
  it('onReconnect fetches /modal-status for the in-flight export', async () => {
    h.axiosGet.mockResolvedValue({ data: { status: 'running', progress: 15 } });
    const { callbacks, exportId } = await startExportAndGetReconnect();

    await act(async () => {
      await callbacks.onReconnect();
    });

    await waitFor(() => expect(h.axiosGet).toHaveBeenCalled());
    expect(h.axiosGet.mock.calls[0][0]).toBe(`${API_BASE}/api/exports/${exportId}/modal-status`);
  });

  it('running -> POSTs /resume-progress so the new process drives the render', async () => {
    h.axiosGet.mockResolvedValue({ data: { status: 'running', progress: 15 } });
    const { callbacks, exportId } = await startExportAndGetReconnect();

    await act(async () => {
      await callbacks.onReconnect();
    });

    await waitFor(() => {
      const urls = h.axiosPost.mock.calls.map((c) => c[0]);
      expect(urls.some((u) => u === `${API_BASE}/api/exports/${exportId}/resume-progress`)).toBe(true);
    });
  });

  it('complete -> finishes the export exactly once', async () => {
    h.axiosGet.mockResolvedValue({ data: { status: 'complete', working_video_id: 7, output_filename: 'w.mp4' } });
    const { callbacks, exportId } = await startExportAndGetReconnect();

    await act(async () => {
      await callbacks.onReconnect();
    });

    await waitFor(() => expect(baseProps.onExportComplete).toHaveBeenCalledTimes(1));
    expect(h.completeExport).toHaveBeenCalledWith(exportId, 7, 'w.mp4');
    const urls = h.axiosPost.mock.calls.map((c) => c[0]);
    expect(urls.some((u) => u.includes('resume-progress'))).toBe(false);
  });
});
