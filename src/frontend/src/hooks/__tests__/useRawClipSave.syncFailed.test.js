import { renderHook, act } from '@testing-library/react';
import { vi } from 'vitest';
import { useRawClipSave } from '../useRawClipSave';

// T5350: clip-gesture 503 {code:'sync_failed'} (from T4320's durable_sync on the clip
// routes) must surface a clip-appropriate not-saved state + a working Retry — never a
// silent success, and never the reel/move copy ("your reel was not moved").

vi.mock('../../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../../components/shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../../stores/questStore', () => ({
  useQuestStore: { getState: () => ({ fetchProgress: vi.fn() }) },
}));

import apiFetch from '../../utils/apiFetch';
import { toast } from '../../components/shared/Toast';

const syncFailed503 = () => ({
  ok: false,
  status: 503,
  // Middleware returns the durable-fail payload at the TOP level.
  json: async () => ({
    detail: 'Could not save to the cloud. Your reel was not moved. Please try again.',
    code: 'sync_failed',
    retryable: true,
  }),
});

const ok200 = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  apiFetch.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe('useRawClipSave — sync_failed durable-fail UX (T5350)', () => {
  describe('saveClip', () => {
    it('happy path (200) returns the result, sets no error, shows no failure toast', async () => {
      apiFetch.mockResolvedValue(ok200({ raw_clip_id: 42 }));
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.saveClip(7, { start_time: 1, end_time: 2 }); });

      expect(res).toEqual({ raw_clip_id: 42 });
      expect(result.current.error).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('503 sync_failed → returns null, marks not-saved with clip copy, offers Retry', async () => {
      apiFetch.mockResolvedValue(syncFailed503());
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.saveClip(7, { start_time: 1, end_time: 2 }); });

      // Never a silent success.
      expect(res).toBeNull();
      // Clip-appropriate copy, NOT the reel/move message.
      expect(result.current.error).toBe("Your clip wasn't saved. Please try again.");
      expect(result.current.error).not.toMatch(/reel was not moved/i);

      expect(toast.error).toHaveBeenCalledTimes(1);
      const [title, opts] = toast.error.mock.calls[0];
      expect(title).toBe('Could not save to the cloud');
      expect(opts.message).toBe("Your clip wasn't saved. Please try again.");
      expect(opts.message).not.toMatch(/reel was not moved/i);
      expect(opts.duration).toBe(0); // persistent
      expect(opts.action.label).toBe('Retry');
      expect(typeof opts.action.onClick).toBe('function');
    });

    it('the Retry action re-fires the SAME save gesture (a user click, not a re-send loop)', async () => {
      apiFetch.mockResolvedValue(syncFailed503());
      const { result } = renderHook(() => useRawClipSave());

      await act(async () => { await result.current.saveClip(7, { start_time: 1, end_time: 2 }); });
      expect(apiFetch).toHaveBeenCalledTimes(1);

      const retry = toast.error.mock.calls[0][1].action.onClick;
      // Second attempt succeeds.
      apiFetch.mockResolvedValue(ok200({ raw_clip_id: 99 }));
      let res;
      await act(async () => { res = await retry(); });

      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(res).toEqual({ raw_clip_id: 99 });
      // Same endpoint + payload as the original gesture.
      expect(apiFetch.mock.calls[1][0]).toContain('/clips/raw/save');
    });

    it('a non-sync error (500) is NOT treated as sync_failed and shows no failure toast', async () => {
      apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ detail: 'boom' }) });
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.saveClip(7, { start_time: 1, end_time: 2 }); });

      expect(res).toBeNull();
      expect(result.current.error).toBe('boom');
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe('updateClip', () => {
    it('happy path (200) returns the result, no error, no failure toast', async () => {
      apiFetch.mockResolvedValue(ok200({ success: true }));
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.updateClip(3, { rating: 5 }); });

      expect(res).toEqual({ success: true });
      expect(result.current.error).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('503 sync_failed → null + clip-appropriate not-saved state + Retry re-fires PUT', async () => {
      apiFetch.mockResolvedValue(syncFailed503());
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.updateClip(3, { rating: 5 }); });

      expect(res).toBeNull();
      expect(result.current.error).toBe("Your clip changes weren't saved. Please try again.");
      expect(result.current.error).not.toMatch(/reel was not moved/i);
      const [title, opts] = toast.error.mock.calls[0];
      expect(title).toBe('Could not save to the cloud');
      expect(opts.action.label).toBe('Retry');

      apiFetch.mockResolvedValue(ok200({ success: true }));
      await act(async () => { await opts.action.onClick(); });
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(apiFetch.mock.calls[1][0]).toContain('/clips/raw/3');
      expect(apiFetch.mock.calls[1][1].method).toBe('PUT');
    });
  });

  describe('deleteClip', () => {
    it('happy path (200) returns true, no error, no failure toast', async () => {
      apiFetch.mockResolvedValue(ok200({}));
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.deleteClip(8); });

      expect(res).toBe(true);
      expect(result.current.error).toBeNull();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it('503 sync_failed → false + clip-appropriate not-deleted state + Retry re-fires DELETE', async () => {
      apiFetch.mockResolvedValue(syncFailed503());
      const { result } = renderHook(() => useRawClipSave());

      let res;
      await act(async () => { res = await result.current.deleteClip(8); });

      expect(res).toBe(false);
      expect(result.current.error).toBe("Your clip wasn't deleted. Please try again.");
      expect(result.current.error).not.toMatch(/reel was not moved/i);
      const [title, opts] = toast.error.mock.calls[0];
      expect(title).toBe('Could not save to the cloud');
      expect(opts.action.label).toBe('Retry');

      apiFetch.mockResolvedValue(ok200({}));
      await act(async () => { await opts.action.onClick(); });
      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(apiFetch.mock.calls[1][0]).toContain('/clips/raw/8');
      expect(apiFetch.mock.calls[1][1].method).toBe('DELETE');
    });
  });
});
