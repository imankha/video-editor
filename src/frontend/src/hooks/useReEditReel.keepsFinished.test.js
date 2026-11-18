// T17140: "Edit highlight" opens the highlight in Frame WITHOUT taking it out of
// Highlights. Opening to look must not unpublish it (the old restore-project path
// did, moving it to Plays as a private in-progress draft); only a new sharpen
// replaces it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../utils/apiFetch', () => ({ default: apiFetch }));
vi.mock('../utils/reelReEditable', () => ({ canReEditReel: () => true }));

import { useReEditReel } from './useReEditReel';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';

const reel = { id: 3, project_id: 9, clip_count: 1, game_ids: [4] };

describe('useReEditReel keeps the highlight finished (T17140)', () => {
  let fetchCount, notify, fetchProjects;
  beforeEach(() => {
    vi.restoreAllMocks();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ project_id: 9, restored: false }) });
    useGamesDataStore.setState({ games: [{ id: 4, status: 'ready', reel_count: 1 }], readyGames: [{ id: 4, status: 'ready', reel_count: 1 }] });
    fetchCount = vi.spyOn(useGalleryStore.getState(), 'fetchCount').mockImplementation(() => {});
    notify = vi.spyOn(useGalleryStore.getState(), 'notifyCollectionsChanged').mockImplementation(() => {});
    fetchProjects = vi.spyOn(useProjectsStore.getState(), 'fetchProjects').mockImplementation(() => {});
  });

  it('T17140:C1 opens through open-for-redo (never restore-project) and navigates', async () => {
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    const urls = apiFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/restore-project'))).toBe(false);
    expect(urls).toContainEqual(expect.stringContaining('/api/downloads/3/open-for-redo'));
    expect(nav).toHaveBeenCalledWith(9);
  });

  it('T17140:C1 the highlight stays counted: no unpublish change events', async () => {
    const { result } = renderHook(() => useReEditReel(() => {}));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(useGamesDataStore.getState().games[0].reel_count).toBe(1);
    expect(fetchCount).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(fetchProjects).not.toHaveBeenCalled();
  });

  it('T17140:C2 the same for a highlight whose game video has expired', async () => {
    const expired = { id: 4, status: 'ready', reel_count: 1, storage_status: 'expired', can_extend: false };
    useGamesDataStore.setState({ games: [expired], readyGames: [expired] });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    const urls = apiFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/restore-project'))).toBe(false);
    expect(urls).toContainEqual(expect.stringContaining('/api/downloads/3/open-for-redo'));
    expect(nav).toHaveBeenCalledWith(9);
    expect(useGamesDataStore.getState().games[0].reel_count).toBe(1);
    expect(fetchCount).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
