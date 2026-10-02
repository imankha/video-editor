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
    // T11580: gameId/aspectRatio come from the PUBLISH RESPONSE itself now
    // (server-computed at the exact moment of publish) -- projectsStore is
    // only still used for the post-publish fetchProjects() refetch.
    projectsStoreState: { fetchProjects },
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
  });

  it('success: POSTs publish, fires fetchCount/notify/fetchProjects/recordAchievement, no optimistic removal', async () => {
    apiFetchMock.mockResolvedValueOnce(
      jsonResponse(200, { success: true, archived: true, final_video_id: 99, collection_game_id: null, aspect_ratio: '9:16' })
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
// PUBLISH RESPONSE itself (server-computed, at the exact moment of publish),
// NOT a client-side projectsStore snapshot. Two live-verification bugs found
// here, both fixed:
// (1) 2026-10-02, dev fixture account: the client cache's game_ids could be
//     stale relative to server truth -- a real single-game highlight (server's
//     own GET /api/downloads later showed game_ids:[11]) resolved to
//     gameId: null client-side and auto-expanded "Mixes & compilations"
//     instead of its real game group. Fixed by moving the source of truth to
//     the publish response.
// (2) Independent proof-verifier pass, same day: the FIRST fix for (1) sent a
//     raw game_ids list re-derived via a fresh working_clips join that
//     ignored clip_count -- so a MULTI-CLIP highlight from one game still
//     wrongly targeted that game's group (list_downloads routes any
//     clip_count != 1 reel to Mixes regardless of game count). Fixed by
//     having the backend return `collection_game_id`, its OWN routing
//     decision (route_collection on the frozen final_videos.game_ids/
//     clip_count), not a raw list the frontend re-gates.
// See test_t11580_publish_game_ids_response.py for the backend half + the
// routing-agreement test against the real freeze path + list_downloads.
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

  it('publish response targets a game group: setJustPublished with that collection_game_id verbatim', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
      archived: true, final_video_id: 99, collection_game_id: 7, aspect_ratio: '9:16',
    }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).toHaveBeenCalledWith({
      finalVideoId: 99,
      gameId: 7,
      aspectRatio: '9:16',
    });
  });

  it('publish response targets Mixes (collection_game_id: null): setJustPublished with gameId null', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
      archived: true, final_video_id: 100, collection_game_id: null, aspect_ratio: '16:9',
    }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).toHaveBeenCalledWith({
      finalVideoId: 100,
      gameId: null,
      aspectRatio: '16:9',
    });
  });

  // Rolling-deploy skew: an older backend instance's response predates T11580
  // and carries no collection_game_id/aspect_ratio at all (undefined, never
  // null -- null is Mixes, a legitimate value). Must degrade to "skip the
  // spotlight" (no guessed data), never crash and never guess a game.
  it('publish response missing collection_game_id/aspect_ratio (older backend): skips the spotlight, no crash', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, { archived: true, final_video_id: 102 }));
    const { result } = renderHook(() => usePublishProject(project));

    let ret;
    await act(async () => { ret = await result.current.publish({ openGallery: false }); });

    expect(ret).toBe(true);
    expect(setJustPublishedMock).not.toHaveBeenCalled();
  });

  it('503 sync_failed: never sets justPublished (publish did not actually succeed)', async () => {
    apiFetchMock.mockResolvedValueOnce(jsonResponse(503, { code: 'sync_failed' }));
    const { result } = renderHook(() => usePublishProject(project));

    await act(async () => { await result.current.publish({ openGallery: false }); });

    expect(setJustPublishedMock).not.toHaveBeenCalled();
  });

  // Regression (Branch CI run 37040668288): an earlier version of this block
  // shared the SAME try/catch as the critical post-publish effects, so a
  // throw from the (then client-cache-based) lookup silently swallowed
  // fetchCount/notifyCollectionsChanged/fetchProjects/recordAchievement too.
  // The spotlight block is isolated in its own try/catch -- still true now
  // the data source is the publish response, since setJustPublished itself
  // (a store action) could still throw for unrelated reasons, and it must
  // never prevent the critical effects from running.
  it('a throwing setJustPublished must not prevent the critical post-publish effects from running', async () => {
    setJustPublishedMock.mockImplementationOnce(() => { throw new Error('boom'); });
    apiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
      archived: true, final_video_id: 99, collection_game_id: 7, aspect_ratio: '9:16',
    }));
    const { result } = renderHook(() => usePublishProject(project));

    let ret;
    await act(async () => { ret = await result.current.publish({ openGallery: false }); });

    expect(ret).toBe(true);
    expect(fetchCountMock).toHaveBeenCalledWith({ force: true });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(fetchProjectsMock).toHaveBeenCalledWith({ force: true });
    expect(recordAchievementMock).toHaveBeenCalledWith('moved_to_my_reels');
  });
});
