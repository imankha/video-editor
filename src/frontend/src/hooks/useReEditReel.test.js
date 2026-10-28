import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock, fetchCountMock, notifyMock, fetchProjectsMock } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  fetchCountMock: vi.fn(),
  notifyMock: vi.fn(),
  fetchProjectsMock: vi.fn(),
}));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: fetchCountMock, notifyCollectionsChanged: notifyMock };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('../stores/projectsStore', () => {
  const api = { fetchProjects: fetchProjectsMock };
  const useProjectsStore = (sel) => sel(api);
  useProjectsStore.getState = () => api;
  return { useProjectsStore };
});

import { useReEditReel } from './useReEditReel';

const reel = { id: 7, project_id: 3, clip_count: 1 };

describe('useReEditReel (T13800)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('refreshes count, collections and projects, then navigates, on a successful restore', async () => {
    apiFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ project_id: 3 }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(fetchCountMock).toHaveBeenCalledTimes(1);
    expect(fetchCountMock).toHaveBeenCalledWith({ force: true });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(fetchProjectsMock).toHaveBeenCalledTimes(1);
    expect(fetchProjectsMock).toHaveBeenCalledWith({ force: true });
    expect(nav).toHaveBeenCalledWith(3);
    expect(fetchCountMock.mock.invocationCallOrder[0]).toBeLessThan(nav.mock.invocationCallOrder[0]);
  });

  it('refreshes nothing on 503 sync_failed', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(window.alert).toHaveBeenCalled();
    expect(fetchCountMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(fetchProjectsMock).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });

  it('refreshes nothing on a non-ok response', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'nope' }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(window.alert).toHaveBeenCalled();
    expect(fetchCountMock).not.toHaveBeenCalled();
    expect(fetchProjectsMock).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });
});
