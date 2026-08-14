import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useRawClipSave } from '../useRawClipSave';

// T7010: the clip-save hook stamps the frontend's ACTIVE game onto every clip
// request as `X-Client-Game-Id`, so the backend can log "clip saved under game X
// while the UI showed game Y" in one line. Diagnostic only — attribution still
// rides the `game_id` in the save body. The header is omitted when no active game
// ref is supplied (e.g. a non-annotate caller).

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../components/shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));

import apiFetch from '../../utils/apiFetch';

const ok200 = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  apiFetch.mockReset();
});

function headersOf(callIndex = 0) {
  return apiFetch.mock.calls[callIndex][1].headers;
}

describe('useRawClipSave — X-Client-Game-Id diagnostic header (T7010)', () => {
  it('stamps the active game on save/update/delete when a ref is supplied', async () => {
    apiFetch.mockResolvedValue(ok200({ raw_clip_id: 1 }));
    const ref = { current: 42 };
    const { result } = renderHook(() => useRawClipSave(ref));

    await act(async () => { await result.current.saveClip(42, { start_time: 1, end_time: 2 }); });
    await act(async () => { await result.current.updateClip(1, { rating: 5 }); });
    await act(async () => { await result.current.deleteClip(1); });

    expect(headersOf(0)['X-Client-Game-Id']).toBe('42');
    expect(headersOf(1)['X-Client-Game-Id']).toBe('42');
    expect(headersOf(2)['X-Client-Game-Id']).toBe('42');
  });

  it('reads the ref at call time, so a game switch is reflected on the next request', async () => {
    apiFetch.mockResolvedValue(ok200({ raw_clip_id: 1 }));
    const ref = { current: 42 };
    const { result } = renderHook(() => useRawClipSave(ref));

    await act(async () => { await result.current.saveClip(42, { start_time: 1, end_time: 2 }); });
    ref.current = 99; // user navigated to another game
    await act(async () => { await result.current.updateClip(1, { rating: 4 }); });

    expect(headersOf(0)['X-Client-Game-Id']).toBe('42');
    expect(headersOf(1)['X-Client-Game-Id']).toBe('99');
  });

  it('omits the header entirely when no ref is supplied or the active game is null', async () => {
    apiFetch.mockResolvedValue(ok200({ raw_clip_id: 1 }));
    const { result } = renderHook(() => useRawClipSave()); // no ref

    await act(async () => { await result.current.saveClip(7, { start_time: 1, end_time: 2 }); });
    expect(headersOf(0)).not.toHaveProperty('X-Client-Game-Id');

    apiFetch.mockClear();
    const nullRef = { current: null };
    const { result: r2 } = renderHook(() => useRawClipSave(nullRef));
    await act(async () => { await r2.current.saveClip(7, { start_time: 3, end_time: 4 }); });
    expect(headersOf(0)).not.toHaveProperty('X-Client-Game-Id');
  });
});
