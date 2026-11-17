import { render, screen, fireEvent, act, waitFor, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T16530: the Finished screen offers Add / Redo spotlight and Edit zoom. A redo opens
// the highlight for editing WITHOUT unpublishing it (open-for-redo, never
// restore-project); Edit zoom shows the credit cost and balance before it commits.
const { apiFetchMock, selectProjectMock, toastErrorMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  selectProjectMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: vi.fn(), selectProject: (...a) => selectProjectMock(...a) };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: vi.fn() };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('./shared/Toast', () => ({
  toast: { success: vi.fn(), error: (...a) => toastErrorMock(...a), info: vi.fn() },
}));
vi.mock('../hooks/useWebShare', () => ({
  ShareCapability: { FULL: 'full', LINK_ONLY: 'link', NONE: 'none' },
  useWebShare: () => ({
    copyLink: vi.fn(), shareVideoFile: vi.fn(), shareLink: vi.fn(),
    createShareLink: vi.fn(), repointShareLink: vi.fn(), isMobile: false, capability: 'none',
  }),
}));
vi.mock('../hooks/useDownloads', () => {
  const api = { downloadFile: vi.fn(), downloadingId: null };
  return { useDownloads: () => api, default: () => api };
});
vi.mock('./collections/CollectionPlayer', () => ({
  CollectionPlayer: ({ actionBar }) => <div data-testid="mock-player">{actionBar}</div>,
}));

import { DraftReelPreview } from './DraftReelPreview';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useCreditStore } from '../stores/creditStore';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const snapshot = {
  projectId: 42, finalVideoId: 99, name: 'Brilliant Dribble', aspectRatio: '9:16',
  clipCount: 1, alreadyPublished: true, openMode: EDITOR_MODES.PROJECT_MANAGER,
};

function open(extra = {}) {
  act(() => useEditorStore.getState().setEditorMode(EDITOR_MODES.PROJECT_MANAGER));
  render(<DraftReelPreview />);
  act(() => useReelPreviewStore.getState().open({ ...snapshot, ...extra }));
}

function routeApi({ redoInfo = { project_id: 42, reframe_credits: 7, game_video_available: true } } = {}) {
  apiFetchMock.mockImplementation(async (url, opts) => {
    if (url.endsWith('/api/downloads/99/redo-info')) return json(200, redoInfo);
    if (url.endsWith('/api/downloads/99/open-for-redo') && opts?.method === 'POST') {
      return json(200, { project_id: 42, restored: false });
    }
    if (url.endsWith('/api/credits')) return json(200, { balance: 30 });
    throw new Error(`unexpected request ${url}`);
  });
}

describe('T16530 Finished screen redo', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    selectProjectMock.mockReset();
    selectProjectMock.mockResolvedValue({ id: 42, clip_count: 1 });
    toastErrorMock.mockReset();
    act(() => useReelPreviewStore.getState().close());
  });

  it('T16530:C1 shows Add spotlight and Edit zoom, and Redo spotlight once one exists', () => {
    open();
    expect(screen.getByTestId('finished-redo-spotlight').textContent).toMatch(/Add spotlight/);
    expect(screen.getByTestId('finished-edit-zoom').textContent).toMatch(/Edit zoom/);
    expect(screen.getByTestId('finished-edit-zoom').textContent).toMatch(/Uses credits/);
    cleanup();
    act(() => useReelPreviewStore.getState().close());
    open({ finalVideoId: 100, hasSpotlight: true });
    expect(screen.getByTestId('finished-redo-spotlight').textContent).toMatch(/Redo spotlight/);
  });

  it('T16530:C2 Redo spotlight opens Spotlight without unpublishing the highlight', async () => {
    routeApi();
    open({ hasSpotlight: true });

    fireEvent.click(screen.getByTestId('finished-redo-spotlight'));

    await waitFor(() => expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.OVERLAY));
    const urls = apiFetchMock.mock.calls.map(([url]) => url);
    expect(urls.some((u) => u.endsWith('/open-for-redo'))).toBe(true);
    expect(urls.some((u) => u.includes('restore-project'))).toBe(false);
    expect(selectProjectMock).toHaveBeenCalledWith(42);
  });

  it('T16530:C3 Edit zoom states the credit cost and balance before it opens Frame', async () => {
    routeApi();
    act(() => useCreditStore.setState({ balance: 30 }));
    open();

    fireEvent.click(screen.getByTestId('finished-edit-zoom'));

    const sheet = await screen.findByTestId('edit-zoom-sheet');
    expect(sheet.textContent).toMatch(/Cost: 7 credits/);
    expect(sheet.textContent).toMatch(/Balance: 30 credits/);
    expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
    expect(apiFetchMock.mock.calls.some(([u]) => u.endsWith('/open-for-redo'))).toBe(false);

    fireEvent.click(screen.getByTestId('edit-zoom-confirm'));
    await waitFor(() => expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.FRAMING));
  });

  it('T16530:C3 Edit zoom says it is unavailable once the game video has expired', async () => {
    routeApi({ redoInfo: { project_id: 42, reframe_credits: 7, game_video_available: false } });
    open();

    fireEvent.click(screen.getByTestId('finished-edit-zoom'));

    const sheet = await screen.findByTestId('edit-zoom-sheet');
    expect(sheet.textContent).toMatch(/unavailable/);
    expect(screen.queryByTestId('edit-zoom-confirm')).toBeNull();
  });
});
