// T13870: a 503 sync_failed restore already committed the unpublish locally, so the
// holders get the same change events as a successful restore (no navigation, no refetch-all).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../utils/apiFetch', () => ({ default: apiFetch }));
vi.mock('../utils/reelReEditable', () => ({ canReEditReel: () => true }));

import { useReEditReel } from './useReEditReel';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';

describe('useReEditReel failed restore (T13870)', () => {
  let fetchCount, notify, fetchProjects;
  beforeEach(() => {
    vi.restoreAllMocks();
    apiFetch.mockReset();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    useGamesDataStore.setState({ games: [{ id: 4, status: 'ready', reel_count: 1 }], readyGames: [{ id: 4, status: 'ready', reel_count: 1 }] });
    fetchCount = vi.spyOn(useGalleryStore.getState(), 'fetchCount').mockImplementation(() => {});
    notify = vi.spyOn(useGalleryStore.getState(), 'notifyCollectionsChanged').mockImplementation(() => {});
    fetchProjects = vi.spyOn(useProjectsStore.getState(), 'fetchProjects').mockImplementation(() => {});
  });

  it('T13870:C1 503 sync_failed applies the restore change events but does not navigate', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    let outcome;
    await act(async () => { outcome = await result.current.openReelAsProject({ id: 3, project_id: 9, game_ids: [4] }); });
    // The caller (PublishedReelsPanel) applies its own member change events only when
    // the DB changed but nothing navigated away.
    expect(outcome).toEqual({ restored: true, navigated: false });
    expect(useGamesDataStore.getState().games[0].reel_count).toBe(0);
    expect(fetchCount).toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
    expect(fetchProjects).toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalled();
  });

  it('T13870:C2 a 404/500 restore leaves every holder untouched', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 404, json: async () => ({ detail: 'Project archive not found' }) });
    const { result } = renderHook(() => useReEditReel(() => {}));
    let outcome;
    await act(async () => { outcome = await result.current.openReelAsProject({ id: 3, project_id: 9, game_ids: [4] }); });
    expect(outcome).toEqual({ restored: false, navigated: false });
    expect(useGamesDataStore.getState().games[0].reel_count).toBe(1);
    expect(fetchCount).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(fetchProjects).not.toHaveBeenCalled();
  });
});
