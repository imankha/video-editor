// T14220: finishing a highlight (the publish gesture) bumps the game card's
// reel_count by the publish response's change event -- no /api/games refetch.
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock, galleryApi } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  galleryApi: {
    fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: vi.fn(), setJustPublished: vi.fn(),
  },
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));
vi.mock('../stores/projectsStore', () => {
  const api = { fetchProjects: vi.fn() };
  const useProjectsStore = (sel) => sel(api);
  useProjectsStore.getState = () => api;
  return { useProjectsStore };
});
vi.mock('../stores/galleryStore', () => {
  const useGalleryStore = () => galleryApi;
  useGalleryStore.getState = () => galleryApi;
  return { useGalleryStore };
});
vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: vi.fn() };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});
vi.mock('../components/shared/Toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { usePublishProject } from './usePublishProject';
import { useGamesDataStore } from '../stores/gamesDataStore';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const games = () => [
  { id: 1, status: 'ready', reel_count: 1 },
  { id: 2, status: 'ready', reel_count: 6 },
];
const publishWith = async (body) => {
  apiFetchMock.mockResolvedValueOnce(jsonResponse(200, {
    success: true, archived: true, final_video_id: 9, collection_game_id: null, aspect_ratio: '9:16', ...body,
  }));
  const { result } = renderHook(() => usePublishProject({ id: 42 }));
  await act(async () => { await result.current.publish({ openGallery: false }); });
};
const counts = () => {
  const { games: g, readyGames } = useGamesDataStore.getState();
  return { games: g.map((x) => x.reel_count), readyGames: readyGames.map((x) => x.reel_count) };
};

describe('usePublishProject -> game card reel_count (T14220)', () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
    useGamesDataStore.setState({ games: games(), readyGames: games() });
  });

  it('T14220:C1 a newly published single-game reel bumps that game by 1 in games and readyGames', async () => {
    await publishWith({ newly_published: true, game_ids: [1] });
    expect(counts()).toEqual({ games: [2, 6], readyGames: [2, 6] });
  });

  it('T14220:C1 a newly published mix (2+ game_ids) bumps no game', async () => {
    await publishWith({ newly_published: true, game_ids: [1, 2] });
    expect(counts()).toEqual({ games: [1, 6], readyGames: [1, 6] });
  });

  it('T14220:C3 re-publishing an already-published latest version does not double count', async () => {
    await publishWith({ newly_published: false, game_ids: [2] });
    expect(counts()).toEqual({ games: [1, 6], readyGames: [1, 6] });
  });

  it('T14220:C4 publish never refetches the games list', async () => {
    await publishWith({ newly_published: true, game_ids: [2] });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0][0]).toContain('/api/downloads/publish/42');
  });
});
