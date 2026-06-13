import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useCollections } from '../useCollections';

const h = vi.hoisted(() => ({ profileId: 'p1' }));

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../stores/profileStore', () => ({
  useProfileStore: (selector) => selector({ currentProfileId: h.profileId }),
}));

import apiFetch from '../../utils/apiFetch';

const jsonRes = (data) => ({ ok: true, json: async () => data });
const SUMMARY = { games: [], mixes: { reel_count: 0 }, season_totals: [], tag_totals: [], total_reel_count: 0 };

beforeEach(() => {
  h.profileId = 'p1';
  apiFetch.mockReset();
});

describe('useCollections', () => {
  it('does not fetch the summary while inactive', () => {
    apiFetch.mockResolvedValue(jsonRes(SUMMARY));
    renderHook(() => useCollections(false));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('fetches the summary once when activated', async () => {
    apiFetch.mockResolvedValue(jsonRes(SUMMARY));
    const { result } = renderHook(() => useCollections(true));

    await waitFor(() => expect(result.current.summaryState).toBe('ready'));
    const summaryCalls = apiFetch.mock.calls.filter(([url]) =>
      url.includes('/collections/summary'));
    expect(summaryCalls).toHaveLength(1);
    expect(result.current.summary).toEqual(SUMMARY);
  });

  it('sets error state when the summary fetch fails', async () => {
    apiFetch.mockResolvedValue({ ok: false });
    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summaryState).toBe('error'));
  });

  it('fetches members once per group key and caches subsequent expands', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/collections/summary')) return Promise.resolve(jsonRes(SUMMARY));
      return Promise.resolve(jsonRes({ downloads: [{ id: 1 }, { id: 2 }] }));
    });
    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summaryState).toBe('ready'));

    await act(async () => { await result.current.fetchMembers({ gameId: 12 }); });
    const memberCalls = () => apiFetch.mock.calls.filter(([url]) =>
      url.includes('game_id=12'));
    expect(memberCalls()).toHaveLength(1);
    expect(result.current.members['game:12']).toHaveLength(2);

    // Second expand of the same group: no additional request (cache).
    await act(async () => { await result.current.fetchMembers({ gameId: 12 }); });
    expect(memberCalls()).toHaveLength(1);
  });

  it('fetches mixes members via ?mixes=true', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/collections/summary')) return Promise.resolve(jsonRes(SUMMARY));
      return Promise.resolve(jsonRes({ downloads: [{ id: 9 }] }));
    });
    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summaryState).toBe('ready'));

    await act(async () => { await result.current.fetchMembers({ mixes: true }); });
    expect(apiFetch.mock.calls.some(([url]) => url.includes('mixes=true'))).toBe(true);
    expect(result.current.members.mixes).toHaveLength(1);
  });

  it('resets all state on profile switch', async () => {
    apiFetch.mockResolvedValue(jsonRes(SUMMARY));
    const { result, rerender } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summaryState).toBe('ready'));

    act(() => { h.profileId = 'p2'; });
    rerender();
    await waitFor(() => expect(result.current.summary).toBeNull());
  });
});
