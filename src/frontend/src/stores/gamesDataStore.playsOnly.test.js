import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../services/uploadManager', () => ({ uploadGame: vi.fn() }));
vi.mock('./authStore', () => ({ useAuthStore: { getState: () => ({ isAuthenticated: false }) } }));

import apiFetch from '../utils/apiFetch';
import { useGamesDataStore } from './gamesDataStore';

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const fail = (status, detail) => ({ ok: false, status, json: async () => ({ detail }) });

describe('T12930 gamesDataStore plays-only gestures', () => {
  beforeEach(() => { apiFetch.mockReset(); });

  it('keepOnlyMarkedPlays POSTs the surgical endpoint and returns the result', async () => {
    apiFetch.mockResolvedValue(ok({ plays_only: true, preservation: 'pending' }));
    const r = await useGamesDataStore.getState().keepOnlyMarkedPlays(7);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toContain('/api/games/7/plays-only');
    expect(opts.method).toBe('POST');
    expect(r.plays_only).toBe(true);
  });

  it('restoreFullVideo DELETEs the endpoint', async () => {
    apiFetch.mockResolvedValue(ok({ plays_only: false }));
    await useGamesDataStore.getState().restoreFullVideo(7);
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toContain('/api/games/7/plays-only');
    expect(opts.method).toBe('DELETE');
  });

  it('surfaces the backend 409 code to the caller', async () => {
    apiFetch.mockResolvedValue(fail(409, { code: 'source_expired', error: 'gone' }));
    await expect(useGamesDataStore.getState().restoreFullVideo(7)).rejects.toMatchObject({ code: 'source_expired' });
  });
});
