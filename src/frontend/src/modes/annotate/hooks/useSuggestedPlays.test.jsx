import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSuggestedPlays } from './useSuggestedPlays';

// T13220: the hook's only effect is the read; every write is a gesture handler, one request each.
const row = (id, start, state = 'open', raw = null) => ({
  id, import_id: 'imp1', source: 'veo_zip', video_sequence: 1, start_time: start, end_time: start + 12,
  labels: ['Goal'], state, raw_clip_id: raw,
});

let calls;
function mockFetch(handlers) {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push({ url, method, body: opts.body ? JSON.parse(opts.body) : undefined });
    const key = `${method} ${url.replace(/^.*?(\/api)/, '$1')}`;
    const h = handlers[key];
    if (!h) throw new Error(`unmocked ${key}`);
    return { ok: true, status: 200, json: async () => (typeof h === 'function' ? h(calls.at(-1)) : h) };
  });
}

beforeEach(() => vi.restoreAllMocks());

describe('useSuggestedPlays', () => {
  it('loads on game open (one GET) and never writes reactively', async () => {
    mockFetch({ 'GET /api/games/7/suggestions': { suggestions: [row('b', 20), row('a', 10)] } });
    const { result } = renderHook(() => useSuggestedPlays({ gameId: 7 }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.suggestions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('keep = ONE accept request with the draft, then onKept(suggestion, rawId, draft)', async () => {
    const kept = row('a', 10, 'accepted', 55);
    mockFetch({
      'GET /api/games/7/suggestions': { suggestions: [row('a', 10)] },
      'POST /api/suggestions/a/accept': { raw_clip_id: 55, suggestion: kept },
    });
    const onKept = vi.fn();
    const { result } = renderHook(() => useSuggestedPlays({ gameId: 7, onKept }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    const draft = { rating: 5, name: 'Goal 0:10', tags: ['Goal'], notes: 'Veo: Goal' };
    await act(() => result.current.keep(result.current.suggestions[0], draft));
    const writes = calls.filter((c) => c.method !== 'GET');
    expect(writes).toHaveLength(1);
    expect(writes[0].body).toEqual(draft);
    expect(onKept).toHaveBeenCalledWith(kept, 55, draft);
    expect(result.current.suggestions[0].state).toBe('accepted');
  });

  it('import = one POST then a refresh; exposes the first suggestion for the alignment card', async () => {
    mockFetch({
      'GET /api/games/7/suggestions': { suggestions: [] },
      'POST /api/games/7/suggestions': { import_id: 'imp1', inserted: 2 },
    });
    const { result } = renderHook(() => useSuggestedPlays({ gameId: 7 }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    global.fetch.mockClear(); calls.length = 0;
    mockFetch({
      'POST /api/games/7/suggestions': { import_id: 'imp1', inserted: 2 },
      'GET /api/games/7/suggestions': { suggestions: [row('b', 20), row('a', 10)] },
    });
    let out;
    await act(async () => { out = await result.current.importMoments(1, [{ start: 10, end: 22, labels: ['Goal'] }]); });
    expect(calls.map((c) => c.method)).toEqual(['POST', 'GET']);
    expect(calls[0].body).toEqual({ source: 'veo_zip', video_sequence: 1, moments: [{ start: 10, end: 22, labels: ['Goal'] }] });
    expect(out.first.id).toBe('a');
    expect(result.current.lastImport).toEqual({ importId: 'imp1', firstId: 'a' });
  });

  it('undoKeep deletes the play (one DELETE), reopens the row and tells the parent', async () => {
    mockFetch({
      'GET /api/games/7/suggestions': { suggestions: [row('a', 10, 'accepted', 55)] },
      'DELETE /api/clips/raw/55': { success: true },
    });
    const onUnkept = vi.fn();
    const { result } = renderHook(() => useSuggestedPlays({ gameId: 7, onUnkept }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => result.current.undoKeep(result.current.suggestions[0]));
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(onUnkept).toHaveBeenCalledWith(55);
    expect(result.current.suggestions[0]).toMatchObject({ state: 'open', raw_clip_id: null });
  });

  it('dismiss is one PATCH', async () => {
    mockFetch({
      'GET /api/games/7/suggestions': { suggestions: [row('a', 10)] },
      'PATCH /api/suggestions/a': { id: 'a', state: 'dismissed' },
    });
    const { result } = renderHook(() => useSuggestedPlays({ gameId: 7 }));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => result.current.dismiss(result.current.suggestions[0]));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(calls.at(-1).body).toEqual({ state: 'dismissed' });
    expect(result.current.suggestions[0].state).toBe('dismissed');
  });
});
