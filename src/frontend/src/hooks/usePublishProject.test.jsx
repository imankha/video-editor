import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// apiFetch + store fns are referenced inside hoisted vi.mock factories.
const {
  apiFetchMock, fetchProjectsMock, fetchCountMock, notifyMock, openMock,
  recordAchievementMock, toastErrorMock, setJustPublishedMock, projectsStoreState,
} = vi.hoisted(() => {
  const fetchProjects = vi.fn();
  return {
    apiFetchMock: vi.fn(),
    fetchProjectsMock: fetchProjects,
    fetchCountMock: vi.fn(),
    notifyMock: vi.fn(),
    openMock: vi.fn(),
    recordAchievementMock: vi.fn(),
    toastErrorMock: vi.fn(),
    setJustPublishedMock: vi.fn(),
    // T11580: the publish success path reads projectsStore.getState().projects
    // (BEFORE the fetchProjects refetch below replaces it) to source
    // justPublished's gameId/aspectRatio -- the publish response itself only
    // carries final_video_id/archived. Mutated per-test via .projects.
    projectsStoreState: { fetchProjects, projects: [] },
  };
});

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

vi.mock('../stores/projectsStore', () => {
  const useProjectsStore = (sel) => sel(projectsStoreState);
  useProjectsStore.getState = () => projectsStoreState;
  return { useProjectsStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = {
    fetchCount: fetchCountMock,
    notifyCollectionsChanged: notifyMock,
    open: openMock,
    setJustPublished: setJustPublishedMock,
  };
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
    setJustPublishedMock.mockReset();
    projectsStoreState.projects = [project];
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

// T11580: justPublished spotlight wiring. gameId/aspectRatio come from the
// PROJECT row in projectsStore (read before the post-publish refetch replaces
// it), not from the publish response (which only carries final_video_id).
describe('usePublishProject justPublished wiring (T11580)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    fetchProjectsMock.mockReset();
    fetchCountMock.mockReset();
    notifyMock.mockReset();
    openMock.mockReset();
    recordAchievementMock.mockReset();
    toastErrorMock.mockReset();
    setJustPublishedMock.mockReset();
  });

  it('single-game project: setJustPublished with that one gameId', async () => {
    projectsStoreState.projects = [{ id: 42, aspect_ratio: '9:16', game_ids: [7] }];
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 99 }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).toHaveBeenCalledWith({
      finalVideoId: 99,
      gameId: 7,
      aspectRatio: '9:16',
    });
  });

  it('multi-game (Mix) project: gameId null, same gating as finishedReelNav', async () => {
    projectsStoreState.projects = [{ id: 42, aspect_ratio: '16:9', game_ids: [7, 8] }];
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 100 }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).toHaveBeenCalledWith({
      finalVideoId: 100,
      gameId: null,
      aspectRatio: '16:9',
    });
  });

  it('project not found in projectsStore at success time: skips the spotlight (no guessed data)', async () => {
    projectsStoreState.projects = []; // targetId 42 not present
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 101 }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).not.toHaveBeenCalled();
  });

  it('503 sync_failed: never sets justPublished (publish did not actually succeed)', async () => {
    projectsStoreState.projects = [{ id: 42, aspect_ratio: '9:16', game_ids: [7] }];
    apiFetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 'sync_failed' }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).not.toHaveBeenCalled();
  });
});
