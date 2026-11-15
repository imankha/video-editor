import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
vi.mock('../stores/overlayActionStore', () => ({
  useOverlayActionStore: h.mockStore({ failedActions: [], retryFailedOverlayActions: vi.fn() }),
}));


import apiFetch from '../utils/apiFetch';
import { ExportButtonContainer } from './ExportButtonContainer';

// T4400 C2: pressing the render button sends no crop or segment data. The server
// renders from what each gesture already saved, so a stale tab cannot overwrite
// newer edits made in another tab. Before T4400 the button awaited the screen's
// saveCurrentClipState (a full-state PUT of crop_data + segments_data) first.

const FRAMING_KEYS = /crop|keyframe|segment|trim|speed|boundar/i;

function bodyText(body) {
  if (body == null) return '';
  if (typeof body === 'string') return body;
  if (body instanceof FormData) return JSON.stringify([...body.entries()]);
  return JSON.stringify(body);
}

beforeEach(() => {
  h.axiosPost.mockReset();
  h.axiosPost.mockResolvedValue({ status: 202, data: { export_id: 'e1' } });
  apiFetch.mockClear();
});

describe('T4400 C2: the render button sends no framing state', () => {
  it('posts /api/export/render with ids and options only, and no other request carries crop or segments', async () => {
    const clip = { id: 1, fileName: 'clip-1.mp4', duration: 10, segments: {}, cropKeyframes: [{ frame: 0, x: 0, y: 0, width: 10, height: 10 }] };
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
    const { result } = renderHook(() => ExportButtonContainer(props));

    await act(async () => {
      result.current.handleExport();
    });

    await waitFor(() => expect(h.axiosPost).toHaveBeenCalled());
    const renderCall = h.axiosPost.mock.calls.find(([url]) => url.includes('/api/export/render'));
    expect(renderCall).toBeTruthy();
    expect(Object.keys(renderCall[1]).sort()).toEqual(
      ['export_id', 'export_mode', 'include_audio', 'project_id', 'target_fps'],
    );

    const sent = [
      ...h.axiosPost.mock.calls.map(([url, body]) => `${url} ${bodyText(body)}`),
      ...apiFetch.mock.calls.map(([url, init]) => `${url} ${init?.method || 'GET'} ${bodyText(init?.body)}`),
    ];
    sent.forEach((line) => expect(line).not.toMatch(FRAMING_KEYS));
  });
});
