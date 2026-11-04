import { renderHook, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const mockStore = (state) => {
    const hook = (selector) => selector(state);
    hook.getState = () => state;
    return hook;
  };
  return { axiosPost: vi.fn(), apiFetch: vi.fn(), mockStore };
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
vi.mock('../utils/apiFetch', () => ({ default: (...a) => h.apiFetch(...a) }));
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
import { useExportStore } from '../stores/exportStore';

const props = {
  editorMode: 'overlay', projectId: 123, projectName: 'My Reel',
  highlightEffectType: 'dark_overlay', includeAudio: true, onIncludeAudioChange: vi.fn(),
  onExportStart: vi.fn(), onExportEnd: vi.fn(), onExportComplete: vi.fn(),
};

async function exportWith(healthImpl) {
  h.apiFetch.mockImplementation(healthImpl);
  const { result } = renderHook(() => ExportButtonContainer(props));
  await act(async () => { await result.current.handleExport(); });
  return result.current;
}

describe('T14530: export panel connection errors', () => {
  beforeEach(() => {
    useExportStore.getState().reset();
    h.axiosPost.mockReset();
    h.apiFetch.mockReset();
  });
  afterEach(cleanup);

  it('T14530:C4 an unreachable server reads plainly and logs the cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = await exportWith(async () => { throw new TypeError('Failed to fetch'); });
    expect(view.error).toMatch(/We couldn't connect/);
    expect(view.error).not.toMatch(/backend|port|8000|server/i);
    expect(logged.mock.calls.flat().map(String).join(' ')).toContain('Failed to fetch');
    logged.mockRestore();
  });

  it('T14530:C4 a failing health check shows no status code', async () => {
    const view = await exportWith(async () => ({ ok: false, status: 503, statusText: 'Unavailable' }));
    expect(view.error).toMatch(/We couldn't connect/);
    expect(view.error).not.toMatch(/\d{3}|Unavailable/);
  });

  it('T14530:C4 a 500 with no reason asks the parent to try again', async () => {
    h.axiosPost.mockRejectedValue({
      message: 'Request failed with status code 500',
      response: { status: 500, statusText: 'Internal Server Error', data: {}, headers: {} },
    });
    const view = await exportWith(async () => ({ ok: true }));
    expect(view.error).toMatch(/We couldn't make your highlight/);
    expect(view.error).not.toMatch(/500|server/i);
  });
});
