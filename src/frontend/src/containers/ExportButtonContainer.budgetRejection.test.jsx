import { renderHook, act, render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * T11330 regression (BLOCKING fix): the "export too large" popup must actually render in the
 * REAL flow. The prior tests only exercised each half in isolation (the WS manager with empty
 * callbacks; the store seeded by hand), so they missed the real bug: ExportButtonContainer's
 * connectWebSocket onError callback performed a SECOND store write for the same terminal WS
 * error, clobbering the structured budgetRejection the manager had just stored back to null.
 * Net effect in production: the modal never appeared and the user saw the plain generic toast —
 * Bug 58p's exact original experience.
 *
 * This test drives the ACTUAL integration seam: the container's real onError (captured from the
 * real connect call) AND the manager's real _handleMessage error branch process one
 * export_too_large frame together, over the REAL export store, then GlobalExportIndicator is
 * rendered and must show ExportTooLargeModal. RED before the fix (budgetRejection clobbered to
 * null -> no modal), GREEN after (single write path -> survives -> modal renders).
 */

const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return { axiosPost: vi.fn(), mockStore };
});

vi.mock('axios', () => ({
  default: {
    post: (...a) => h.axiosPost(...a),
    get: vi.fn(),
    // exportStore -> analytics -> authStore -> sessionInit installs a request interceptor
    // at module load; give the mock the shape so that import chain doesn't crash.
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  },
}));
vi.mock('../components/shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn(async () => ({ ok: true })) }));
// Real export store (imported directly, so the barrel's authStore->sessionInit->axios chain
// is NOT pulled in); auth/sync stubbed so requireAuth runs inline.
vi.mock('../stores', async () => {
  const exportStoreModule = await vi.importActual('../stores/exportStore');
  return {
    useExportStore: exportStoreModule.useExportStore,
    useAuthStore: h.mockStore({ requireAuth: (action) => action() }),
    useSyncStore: h.mockStore({ isOffline: false }),
    EDITOR_MODES: { FRAMING: 'framing', OVERLAY: 'overlay' },
  };
});
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
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { useExportStore } from '../stores/exportStore';
import GlobalExportIndicator from '../components/GlobalExportIndicator';

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

// A faithful copy of the backend WS error frame for a Bug-58p-shaped rejection
// (multi_clip.py error_data + export_cost_guard.to_error_detail()).
const errorFrame = JSON.stringify({
  progress: 0,
  status: 'error',
  recoverable: false,
  message: 'This export needs an estimated 4200s of GPU time, over the 2880s safe limit.',
  error: 'This export needs an estimated 4200s of GPU time, over the 2880s safe limit.',
  code: 'export_too_large',
  estimated_gpu_seconds: 4200.0,
  budget_seconds: 2880.0,
  modal_timeout_seconds: 3600.0,
  budget_fraction: 0.8,
  biggest_contributors: [
    { clip_index: 3, clip_name: 'Big Dunk', frame_count: 170, crop_width: 1920, crop_height: 1080, estimated_gpu_seconds: 600.0 },
  ],
});

// The projectId-bearing progress frame the backend sends first (DB-resolve stage), which
// auto-creates the store entry via updateExportProgress — exactly as in production, so the
// later failExport is not a no-op.
const progressFrame = JSON.stringify({
  progress: 5, status: 'processing', message: 'Starting export...',
  projectId: 123, projectName: 'My Reel', type: 'overlay',
});

let connectSpy;

beforeEach(() => {
  useExportStore.getState().reset();
  h.axiosPost.mockReset();
  h.axiosPost.mockResolvedValue({ status: 202, data: { export_id: 'e1' } });
  // Capture the container's real callbacks without opening a socket.
  connectSpy = vi.spyOn(exportWebSocketManager, 'connect').mockResolvedValue({ connected: true });
});

afterEach(() => {
  cleanup();
  connectSpy.mockRestore();
});

describe('ExportButtonContainer + WS manager — export_too_large popup renders in the real flow (T11330)', () => {
  it('keeps the structured budgetRejection and renders ExportTooLargeModal', async () => {
    const { result } = renderHook(() => ExportButtonContainer(props));

    // Drive a real dispatch so the container registers its REAL onError on the manager.
    await act(async () => { await result.current.handleExport(); });
    expect(connectSpy).toHaveBeenCalled();
    const exportId = result.current.exportIdRef.current;
    const callbacks = connectSpy.mock.calls[connectSpy.mock.calls.length - 1][1];
    expect(exportId).toBeTruthy();

    // The manager's real message handler processes the frames, invoking BOTH its own store
    // write AND the container's real onError — the exact two-writer seam that had the bug.
    act(() => { exportWebSocketManager._handleMessage(exportId, progressFrame, callbacks); });
    act(() => { exportWebSocketManager._handleMessage(exportId, errorFrame, callbacks); });

    // The structured rejection survived the container's onError (single write path).
    const exp = useExportStore.getState().activeExports[exportId];
    expect(exp.status).toBe('error');
    expect(exp.budgetRejection).toBeTruthy();
    expect(exp.budgetRejection.code).toBe('export_too_large');

    // Minor 5: the container does NOT also raise the raw guard text in its inline banner —
    // the popup is the single surface for an over-budget rejection.
    expect(result.current.error).toBeNull();

    // And the popup actually renders from the store, with the offending clip named.
    render(<GlobalExportIndicator />);
    expect(screen.getByTestId('export-too-large-modal')).toBeTruthy();
    expect(document.body.textContent).toContain('Big Dunk');
  });
});
