// T14570: restore failures show an in-app toast, never a native alert, and the toast
// never carries raw error text.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../utils/apiFetch', () => ({ default: apiFetch }));
vi.mock('../utils/reelReEditable', () => ({ canReEditReel: () => true }));

import { useReEditReel } from './useReEditReel';
import { useToastStore } from '../components/shared/Toast';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';
import { ERROR_COPY } from '../config/displayNames';

const reel = { id: 3, project_id: 9, game_ids: [] };
const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

async function restore(nav = vi.fn()) {
  const { result } = renderHook(() => useReEditReel(nav));
  let outcome;
  await act(async () => { outcome = await result.current.openReelAsProject(reel); });
  return outcome;
}

describe('useReEditReel in-app notices (T14570)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiFetch.mockReset();
    useToastStore.setState({ toasts: [] });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(useGalleryStore.getState(), 'fetchCount').mockImplementation(() => {});
    vi.spyOn(useGalleryStore.getState(), 'notifyCollectionsChanged').mockImplementation(() => {});
    vi.spyOn(useProjectsStore.getState(), 'fetchProjects').mockImplementation(() => {});
  });

  it('T14570:C2 503 sync_failed toasts the not-synced copy and keeps the restored outcome', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ code: 'sync_failed' }) });
    const outcome = await restore();
    expect(outcome).toEqual({ restored: true, navigated: false });
    expect(toastTitles()).toEqual([ERROR_COPY.REOPEN_NOT_SYNCED]);
    expect(window.alert).not.toHaveBeenCalled();
  });

  it('T14570:C3 a thrown network error toasts fixed copy, not its message', async () => {
    apiFetch.mockRejectedValue(new TypeError('NetworkError when attempting to fetch resource'));
    const outcome = await restore();
    expect(outcome).toEqual({ restored: false, navigated: false });
    expect(toastTitles()).toEqual([ERROR_COPY.OPEN_HIGHLIGHT]);
    expect(window.alert).not.toHaveBeenCalled();
  });
});
