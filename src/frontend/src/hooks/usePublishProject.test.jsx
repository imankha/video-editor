import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// apiFetch + store fns are referenced inside hoisted vi.mock factories.
const {
  apiFetchMock, fetchProjectsMock, fetchCountMock, notifyMock, openMock,
  recordAchievementMock, toastErrorMock,
} = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  fetchProjectsMock: vi.fn(),
  fetchCountMock: vi.fn(),
  notifyMock: vi.fn(),
  openMock: vi.fn(),
  recordAchievementMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: fetchProjectsMock };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: fetchCountMock, notifyCollectionsChanged: notifyMock, open: openMock };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: recordAchievementMock };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});
vi.mock('../components/shared/Toast', () => ({
  toast: { error: (...a) => toastErrorMock(...a), success: vi.fn() },
}));

import { usePublishProject } from './usePublishProject';

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const project = { id: 42 };

describe('usePublishProject (T8530 — T4050 contract carried through the extraction)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    fetchProjectsMock.mockReset();
    fetchCountMock.mockReset();
    notifyMock.mockReset();
    openMock.mockReset();
    recordAchievementMock.mockReset();
    toastErrorMock.mockReset();
  });

  it('success: POSTs publish, fires fetchCount/notify/fetchProjects/recordAchievement, no optimistic removal', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(200, { success: true, archived: true, final_video_id: 99 })
    );
    const { result } = renderHook(() => usePublishProject(project));

    let ret;
    await act(async () => { ret = await result.current.publish({ openGallery: false }); });

    expect(ret).toBe(true);
    expect(apiFetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/downloads\/publish\/42$/),
      expect.objectContaining({ method: 'POST' })
    );
    // The whole T4050/quest side-effect chain fires exactly once.
    expect(fetchCountMock).toHaveBeenCalledWith({ force: true });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(fetchProjectsMock).toHaveBeenCalledWith({ force: true });
    expect(recordAchievementMock).toHaveBeenCalledWith('moved_to_my_reels');
    // openGallery:false -> the gallery drawer is NOT opened.
    expect(openMock).not.toHaveBeenCalled();
    // Card removal is driven by the refetch, never an optimistic local removal:
    // there is no publishRetry state after success.
    expect(result.current.publishRetry).toBeNull();
  });

  it('success with openGallery:true opens the gallery drawer', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(200, { archived: true, final_video_id: 99 })
    );
    const { result } = renderHook(() => usePublishProject(project));
    await act(async () => { await result.current.publish({ openGallery: true }); });
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it('503 sync_failed: sets publishRetry, does NOT refetch (no optimistic removal), returns false', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(503, { code: 'sync_failed', retryable: true, detail: 'Could not save to the cloud.' })
    );
    const { result } = renderHook(() => usePublishProject(project));

    let ret;
    await act(async () => { ret = await result.current.publish({ openGallery: false }); });

    expect(ret).toBe(false);
    expect(result.current.publishRetry).toEqual({ openGallery: false });
    // The durable-sync guard: NO refetch, so the card is never optimistically removed.
    expect(fetchProjectsMock).not.toHaveBeenCalled();
    expect(recordAchievementMock).not.toHaveBeenCalled();
    // 503 is not a generic error -> no error toast.
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it('generic failure: toast.error (NOT alert), no refetch, no publishRetry stash, returns false', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(500, { detail: 'boom' })
    );
    const { result } = renderHook(() => usePublishProject(project));

    let ret;
    await act(async () => { ret = await result.current.publish({ openGallery: false }); });

    expect(ret).toBe(false);
    expect(toastErrorMock).toHaveBeenCalledWith('Could not publish', { message: 'boom' });
    expect(fetchProjectsMock).not.toHaveBeenCalled();
    // Generic failure does NOT stash publishRetry (matches the DraftTile original);
    // the surface drives its own retry off the false return.
    expect(result.current.publishRetry).toBeNull();
  });
});
