import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));

vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetchMock(...a) }));

vi.mock('../stores/profileStore', () => {
  const state = { profiles: [], currentProfileId: null };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});

import { useCollections } from './useCollections';

const jsonResponse = (body) => ({ ok: true, json: async () => body });

describe('useCollections.fetchMembers -- T13690 (Play all during the expand fetch)', () => {
  beforeEach(() => { apiFetchMock.mockReset(); });

  it('a second request while the first is in flight resolves with the real members, not []', async () => {
    let resolveMembers;
    apiFetchMock.mockImplementation((url) => {
      if (String(url).includes('/collections/summary')) return Promise.resolve(jsonResponse({ games: [] }));
      return new Promise((resolve) => { resolveMembers = () => resolve(jsonResponse({ downloads: [{ id: 1 }, { id: 2 }, { id: 3 }] })); });
    });

    const { result } = renderHook(() => useCollections(true));
    await waitFor(() => expect(result.current.summary).not.toBeNull());

    // Expand fires the first request; the user taps Play all before it lands.
    let first; let second;
    await act(async () => {
      first = result.current.fetchMembers({ key: 'game:1', query: 'game_id=1' });
    });
    await act(async () => {
      second = result.current.fetchMembers({ key: 'game:1', query: 'game_id=1' });
    });
    await act(async () => { resolveMembers(); });

    expect((await first).map((m) => m.id)).toEqual([1, 2, 3]);
    expect((await second).map((m) => m.id)).toEqual([1, 2, 3]);
    expect(apiFetchMock.mock.calls.filter(([u]) => String(u).includes('game_id=1'))).toHaveLength(1);
  });
});
