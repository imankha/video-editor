import { renderHook, act, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { useMoveReels } from '../useMoveReels';

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../utils/analytics', () => ({ track: vi.fn() }));
vi.mock('../../components/shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import apiFetch from '../../utils/apiFetch';
import { toast } from '../../components/shared/Toast';

beforeEach(() => {
  apiFetch.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('useMoveReels', () => {
  it('POSTs the selected ids + target and fires onMoved on success', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, moved_ids: [1, 2], target_profile_id: 'pB' }),
    });
    const onMoved = vi.fn();
    const { result } = renderHook(() => useMoveReels(onMoved));

    let ok;
    await act(async () => { ok = await result.current.moveReels([1, 2], 'pB'); });

    expect(ok).toBe(true);
    const [url, opts] = apiFetch.mock.calls[0];
    expect(url).toContain('/api/downloads/move-to-profile');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ video_ids: [1, 2], target_profile_id: 'pB' });
    expect(onMoved).toHaveBeenCalledWith([1, 2], 'pB');
    expect(toast.success).toHaveBeenCalled();
  });

  it('treats a 503 sync_failed as retryable and does NOT fire onMoved', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ detail: { code: 'sync_failed', retryable: true } }),
    });
    const onMoved = vi.fn();
    const { result } = renderHook(() => useMoveReels(onMoved));

    let ok;
    await act(async () => { ok = await result.current.moveReels([5], 'pB'); });

    expect(ok).toBe(false);
    expect(onMoved).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it('surfaces the backend detail message on a 400 rejection', async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: { message: 'Some reels cannot be moved.', not_published: [9] } }),
    });
    const onMoved = vi.fn();
    const { result } = renderHook(() => useMoveReels(onMoved));

    await act(async () => { await result.current.moveReels([9], 'pB'); });

    expect(onMoved).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('Some reels cannot be moved.');
  });

  it('is a no-op when no ids or no target are provided', async () => {
    const { result } = renderHook(() => useMoveReels(vi.fn()));
    await act(async () => {
      expect(await result.current.moveReels([], 'pB')).toBe(false);
      expect(await result.current.moveReels([1], '')).toBe(false);
    });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
