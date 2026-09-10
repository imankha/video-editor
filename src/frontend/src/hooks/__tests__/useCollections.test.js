import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useCollections } from '../useCollections';

const h = vi.hoisted(() => ({ profileId: 'p1' }));

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../stores/profileStore', () => {
  const state = () => ({ currentProfileId: h.profileId, profiles: [] });
  return {
    useProfileStore: Object.assign((selector) => selector(state()), { getState: state }),
  };
});

import apiFetch from '../../utils/apiFetch';

const jsonRes = (data) => ({ ok: true, json: async () => data });
const SUMMARY = { games: [], mixes: { reel_count: 0 }, season_totals: [], tag_totals: [], total_reel_count: 0 };

beforeEach(() => {
  h.profileId = 'p1';
  apiFetch.mockReset();
});

describe('useCollections', () => {
  // T9390: the summary is now fetched EAGERLY at mount, even while the Published
  // tab is inactive, so its empty state paints in comparable time to the other
  // three tabs (whose emptiness comes from data Home already holds). Previously
  // this was gated on isActive, which produced the spinner-then-text asymmetry.
  it('fetches the summary eagerly at mount even while inactive (T9390)', async () => {
    apiFetch.mockResolvedValue(jsonRes(SUMMARY));
    const { result } = renderHook(() => useCollections(false));

    await waitFor(() => expect(result.current.summaryState).toBe('ready'));
    const summaryCalls = apiFetch.mock.calls.filter(([url]) =>
      url.includes('/collections/summary'));
    expect(summaryCalls).toHaveLength(1);
    expect(result.current.summary).toEqual(SUMMARY);
  });

  it('fetches the summary exactly once, not again on activation (no re-spinner)', async () => {
    apiFetch.mockResolvedValue(jsonRes(SUMMARY));
    const { result, rerender } = renderHook(({ active }) => useCollections(active), {
      initialProps: { active: false },
    });
    await waitFor(() => expect(result.current.summaryState).toBe('ready'));

    // Activating the tab must NOT trigger a second summary fetch (which would
    // flip summaryState back to 'loading' and re-show the spinner on every visit).
    rerender({ active: true });
    const summaryCalls = () => apiFetch.mock.calls.filter(([url]) =>
      url.includes('/collections/summary'));
    expect(summaryCalls()).toHaveLength(1);
    expect(result.current.summaryState).toBe('ready');
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

    await act(async () => {
      await result.current.fetchMembers({ key: 'game:12', query: 'game_id=12' });
    });
    const memberCalls = () => apiFetch.mock.calls.filter(([url]) =>
      url.includes('game_id=12'));
    expect(memberCalls()).toHaveLength(1);
    expect(result.current.members['game:12']).toHaveLength(2);

    // Second expand of the same group: no additional request (cache).
    await act(async () => {
      await result.current.fetchMembers({ key: 'game:12', query: 'game_id=12' });
    });
    expect(memberCalls()).toHaveLength(1);
  });

  it('fetches mixes members via ?mixes=true', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/collections/summary')) return Promise.resolve(jsonRes(SUMMARY));
      return Promise.resolve(jsonRes({ downloads: [{ id: 9 }] }));
    });
    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summaryState).toBe('ready'));

    await act(async () => {
      await result.current.fetchMembers({ key: 'mixes', query: 'mixes=true' });
    });
    expect(apiFetch.mock.calls.some(([url]) => url.includes('mixes=true'))).toBe(true);
    expect(result.current.members.mixes).toHaveLength(1);
  });

  it('patchMember and removeMember update cached lists', async () => {
    apiFetch.mockImplementation((url) => {
      if (url.includes('/collections/summary')) return Promise.resolve(jsonRes(SUMMARY));
      return Promise.resolve(jsonRes({ downloads: [{ id: 1, project_name: 'a' }, { id: 2 }] }));
    });
    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summaryState).toBe('ready'));
    await act(async () => {
      await result.current.fetchMembers({ key: 'game:5', query: 'game_id=5' });
    });

    act(() => { result.current.patchMember(1, { project_name: 'renamed' }); });
    expect(result.current.members['game:5'].find((m) => m.id === 1).project_name).toBe('renamed');

    act(() => { result.current.removeMember(2); });
    expect(result.current.members['game:5'].some((m) => m.id === 2)).toBe(false);
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
