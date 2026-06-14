import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useRanking } from '../useRanking';

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
import apiFetch from '../../utils/apiFetch';

const pair = (aId, bId) => ({
  a: { id: aId, name: `R${aId}`, aspect_ratio: '9:16', tags: [], stream_url: `/api/downloads/${aId}/stream` },
  b: { id: bId, name: `R${bId}`, aspect_ratio: '9:16', tags: [], stream_url: `/api/downloads/${bId}/stream` },
});
const okJson = (data, status = 200) => ({ ok: true, status, json: async () => data });
const CONF = { confidence_pct: 30, ranked_count: 1, total: 4 };

// Drive /rank/next from a queue; /confidence + /result are constant.
function wireNext(queue) {
  apiFetch.mockImplementation((url = '', opts) => {
    if (url.includes('/rank/result')) return Promise.resolve(okJson({ ...CONF, confidence_pct: 45 }));
    if (url.includes('/rank/confidence')) return Promise.resolve(okJson(CONF));
    if (url.includes('/rank/next')) {
      const r = queue.shift();
      if (r === '204') return Promise.resolve({ ok: true, status: 204 });
      return Promise.resolve(okJson(r));
    }
    return Promise.resolve(okJson({}));
  });
}

beforeEach(() => apiFetch.mockReset());

describe('useRanking (T3630 matchup loop)', () => {
  it('loads the first pair and reports ready', async () => {
    wireNext([pair(1, 2), pair(3, 4)]); // first + prefetch
    const { result } = renderHook(() => useRanking('9:16'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.pair.a.id).toBe(1);
    expect(result.current.confidence).toEqual(CONF);
  });

  it('pick posts a result and advances to the prefetched pair (no skip endpoint)', async () => {
    wireNext([pair(1, 2), pair(3, 4), pair(5, 6)]);
    const { result } = renderHook(() => useRanking('9:16'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await act(async () => { await result.current.pick(1, 2); });

    // result POST fired with the winner/loser; advanced to the prefetched pair.
    const posted = apiFetch.mock.calls.find(([url, o]) => url.includes('/rank/result') && o?.method === 'POST');
    expect(JSON.parse(posted[1].body)).toEqual({ winner_id: 1, loser_id: 2 });
    expect(result.current.pair.a.id).toBe(3);
    expect(result.current.confidence.confidence_pct).toBe(45);
  });

  it('reports exhausted when the pool returns 204', async () => {
    wireNext(['204']);
    const { result } = renderHook(() => useRanking('9:16'));
    await waitFor(() => expect(result.current.status).toBe('exhausted'));
    expect(result.current.pair).toBeNull();
  });

  it('the only mutation is the pick (no reactive writes)', async () => {
    wireNext([pair(1, 2), pair(3, 4)]);
    const { result } = renderHook(() => useRanking('9:16'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    // Before any pick, no POST/PUT has been issued — pairing + confidence are read-only.
    const writes = apiFetch.mock.calls.filter(([, o]) => o && o.method && o.method !== 'GET');
    expect(writes).toHaveLength(0);
  });
});
