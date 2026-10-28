// T13850: a successful restore decrements the game card's reel_count locally.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../utils/apiFetch', () => ({ default: apiFetch }));
vi.mock('../utils/reelReEditable', () => ({ canReEditReel: () => true }));

import { useReEditReel } from './useReEditReel';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';

describe('useReEditReel -> gamesDataStore reel_count (T13850)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ project_id: 9 }) });
    useGamesDataStore.setState({ games: [{ id: 4, status: 'ready', reel_count: 1 }], readyGames: [{ id: 4, status: 'ready', reel_count: 1 }] });
    vi.spyOn(useGalleryStore.getState(), 'fetchCount').mockImplementation(() => {});
    vi.spyOn(useGalleryStore.getState(), 'notifyCollectionsChanged').mockImplementation(() => {});
    vi.spyOn(useProjectsStore.getState(), 'fetchProjects').mockImplementation(() => {});
  });

  it('T13850:C1 restore decrements the reel game card without fetching /api/games', async () => {
    const { result } = renderHook(() => useReEditReel(() => {}));
    await act(async () => { await result.current.openReelAsProject({ id: 3, project_id: 9, game_ids: [4] }); });
    expect(useGamesDataStore.getState().games[0].reel_count).toBe(0);
    expect(apiFetch.mock.calls.some((c) => String(c[0]).includes('/api/games'))).toBe(false);
  });
});
