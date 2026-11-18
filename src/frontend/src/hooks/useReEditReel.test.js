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
import { useToastStore } from '../components/shared/Toast';

const reel = { id: 7, project_id: 3, clip_count: 1 };

describe('useReEditReel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // T17140: opening keeps the highlight finished, so nothing needs refreshing.
  it('navigates to the returned project without refreshing any holder', async () => {
    apiFetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ project_id: 3 }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(fetchCountMock).not.toHaveBeenCalled();
    expect(notifyMock).not.toHaveBeenCalled();
    expect(fetchProjectsMock).not.toHaveBeenCalled();
    expect(nav).toHaveBeenCalledWith(3);
  });

  it('503 sync_failed does not navigate', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(nav).not.toHaveBeenCalled();
  });

  it('refreshes nothing on a non-ok response', async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: 'nope' }) });
    const nav = vi.fn();
    const { result } = renderHook(() => useReEditReel(nav));
    await act(async () => { await result.current.openReelAsProject(reel); });
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(fetchCountMock).not.toHaveBeenCalled();
    expect(fetchProjectsMock).not.toHaveBeenCalled();
    expect(nav).not.toHaveBeenCalled();
  });
});
