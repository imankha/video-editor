import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useRawClipSave } from '../useRawClipSave';

// T13510: a clip write that never reached the server (offline: fetch rejects with a
// TypeError) must surface a not-saved toast with Retry, never fail silently.

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../components/shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));

import apiFetch from '../../utils/apiFetch';
import { toast } from '../../components/shared/Toast';

beforeEach(() => {
  apiFetch.mockReset();
  toast.error.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('useRawClipSave - network failure (T13510)', () => {
  it('updateClip offline -> null + persistent not-saved toast whose Retry re-sends the PUT', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useRawClipSave());

    let res;
    await act(async () => { res = await result.current.updateClip(10, { rating: 2 }); });

    expect(res).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [, opts] = toast.error.mock.calls[0];
    expect(opts.duration).toBe(0);
    expect(opts.action.label).toBe('Retry');
    expect(opts.message).not.toMatch(/saved locally/i);

    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
    await act(async () => { await opts.action.onClick(); });
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch.mock.calls[1][1].body).toBe(JSON.stringify({ rating: 2 }));
  });

  it('updateClip Retry override (play editor queue) is used when supplied', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useRawClipSave());
    const queued = vi.fn();
    await act(async () => { await result.current.updateClip(10, { rating: 2 }, queued); });
    toast.error.mock.calls[0][1].action.onClick();
    expect(queued).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('saveClip and deleteClip offline also offer Retry', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useRawClipSave());
    await act(async () => { await result.current.saveClip(7, { start_time: 1, end_time: 2 }); });
    await act(async () => { await result.current.deleteClip(3); });
    expect(toast.error).toHaveBeenCalledTimes(2);
    expect(toast.error.mock.calls[0][1].action.label).toBe('Retry');
    expect(toast.error.mock.calls[1][1].action.label).toBe('Retry');
  });

  it('a non-network thrown error (500) still shows no toast', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) });
    const { result } = renderHook(() => useRawClipSave());
    await act(async () => { await result.current.updateClip(10, { rating: 2 }); });
    expect(toast.error).not.toHaveBeenCalled();
  });
});
