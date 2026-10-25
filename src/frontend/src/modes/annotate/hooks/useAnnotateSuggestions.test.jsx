import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAnnotateSuggestions } from './useAnnotateSuggestions';

// T13220: wiring between server suggestions and the Annotate region state.
const row = (id, start, state = 'open', raw = null, seq = 1) => ({
  id, import_id: 'imp1', source: 'veo_zip', video_sequence: seq, start_time: start, end_time: start + 12,
  labels: ['Goal'], state, raw_clip_id: raw,
});

let writes;
function mockApi(list, extra = {}) {
  writes = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const path = url.replace(/^.*?(\/api)/, '$1');
    if (method !== 'GET') writes.push({ method, path, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (method === 'GET') return { ok: true, status: 200, json: async () => ({ suggestions: list }) };
    return { ok: true, status: 200, json: async () => extra[`${method} ${path}`] ?? {} };
  });
}

function setup(over = {}) {
  const props = {
    gameId: 7,
    clipRegions: [],
    gameVideos: [{ sequence: 1, name: '' }, { sequence: 2, name: '' }],
    toVirtualTime: (seq, t) => t + (seq - 1) * 1000,
    seek: vi.fn(), togglePlay: vi.fn(), isPlaying: false,
    addKeptPlay: vi.fn(), removeKeptPlay: vi.fn(), updateClipRegion: vi.fn(), onEditPlay: vi.fn(),
    ...over,
  };
  return { props, ...renderHook((p) => useAnnotateSuggestions(p), { initialProps: props }) };
}

beforeEach(() => {
  window.matchMedia = vi.fn(() => ({ matches: false }));
});

describe('useAnnotateSuggestions', () => {
  it('is null without a game id', () => {
    mockApi([]);
    const { result } = setup({ gameId: null });
    expect(result.current).toBeNull();
  });

  it('ticks are the OPEN suggestions at timeline time', async () => {
    mockApi([row('a', 10), row('b', 20, 'dismissed'), row('c', 5, 'open', null, 2)]);
    const { result } = setup();
    await waitFor(() => expect(result.current.ticks).toHaveLength(2));
    expect(result.current.ticks.map((t) => [t.id, t.time])).toEqual([['a', 10], ['c', 1005]]);
  });

  it('tapping a tick seeks to the suggestion without playing', async () => {
    mockApi([row('a', 10)]);
    const { result, props } = setup();
    await waitFor(() => expect(result.current.ticks).toHaveLength(1));
    act(() => result.current.onTickClick('a'));
    expect(props.seek).toHaveBeenCalledWith(10);
    expect(props.togglePlay).not.toHaveBeenCalled();
  });

  it('row select seeks and autoplays, unless reduced motion', async () => {
    mockApi([row('a', 10)]);
    const { result, props } = setup();
    await waitFor(() => expect(result.current.ticks).toHaveLength(1));
    act(() => result.current.list.onSelect(result.current.list.suggestions[0], { autoplay: true }));
    expect(props.togglePlay).toHaveBeenCalledTimes(1);
    window.matchMedia = vi.fn(() => ({ matches: true }));
    props.togglePlay.mockClear();
    act(() => result.current.list.onSelect(result.current.list.suggestions[0], { autoplay: true }));
    expect(props.seek).toHaveBeenLastCalledWith(10);
    expect(props.togglePlay).not.toHaveBeenCalled();
  });

  it('keep creates the play once and mirrors it into region state', async () => {
    const kept = row('a', 10, 'accepted', 55);
    mockApi([row('a', 10)], { 'POST /api/suggestions/a/accept': { raw_clip_id: 55, suggestion: kept } });
    const { result, props } = setup();
    await waitFor(() => expect(result.current.ticks).toHaveLength(1));
    const draft = { rating: 5, name: 'Goal 0:10', tags: ['Goal'], notes: 'Veo: Goal' };
    await act(() => result.current.list.onKeep(result.current.list.suggestions[0], draft));
    expect(writes).toHaveLength(1);
    expect(props.addKeptPlay).toHaveBeenCalledWith(kept, 55, draft);
    expect(props.updateClipRegion).not.toHaveBeenCalled();
  });

  it('post-keep edits go through the synced region update, one field each', async () => {
    mockApi([row('a', 10, 'accepted', 55)]);
    const region = { id: 'r1', rawClipId: 55, rating: 5, name: 'Goal 0:10', tags: ['Goal'], notes: '' };
    const { result, props } = setup({ clipRegions: [region] });
    await waitFor(() => expect(result.current.list.suggestions).toHaveLength(1));
    act(() => result.current.list.onEditKept(result.current.list.suggestions[0], { tags: ['Goal', 'Dribble'] }));
    expect(props.updateClipRegion).toHaveBeenCalledWith('r1', { tags: ['Goal', 'Dribble'] });
    expect(writes).toHaveLength(0); // the list itself never writes
    expect(result.current.list.keptDetails.a).toMatchObject({ rating: 5, tags: ['Goal'] });
    act(() => result.current.list.onEditPlay(result.current.list.suggestions[0]));
    expect(props.onEditPlay).toHaveBeenCalledWith('r1');
  });
});
