import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T14370: a non-OK create response (anything but the 503 sync_failed and 404
// ghost cases, which have their own UX) used to be console.error + return null,
// with nothing on screen. A 422 here means the client sent something the server
// refuses: a bug to surface, not to swallow.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { useRawClipSave } from './useRawClipSave';
import { useToastStore } from '../components/shared/Toast';
import { useQuestStore } from '../stores/questStore';
import { ANNOTATE } from '../config/displayNames';

const questOriginal = useQuestStore.getState();

describe('useRawClipSave.saveClip non-OK create (T14370)', () => {
  let errSpy;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    useQuestStore.setState({ fetchProgress: vi.fn().mockResolvedValue(undefined) });
    useToastStore.setState({ toasts: [] });
    apiFetch.mockReset();
  });
  afterEach(() => {
    errSpy.mockRestore();
    useQuestStore.setState(questOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  it('a 422 logs [MarkPlay] with the response and shows the not-saved toast', async () => {
    const detail = [{ loc: ['body', 'start_time'], msg: 'Input should be a valid number', type: 'float_type' }];
    apiFetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail }) });
    const { result } = renderHook(() => useRawClipSave());

    let out;
    await act(async () => {
      out = await result.current.saveClip(6, { start_time: null, end_time: 10, tags: [] });
    });

    expect(out).toBe(null);
    const markPlay = errSpy.mock.calls.filter(([m]) => String(m).startsWith('[MarkPlay]'));
    expect(markPlay.length).toBe(1);
    expect(markPlay[0][1]).toMatchObject({ step: 'saveClip', status: 422, gameId: 6 });
    expect(JSON.stringify(markPlay[0][1].body)).toContain('start_time');
    expect(useToastStore.getState().toasts.some((t) => t.title === ANNOTATE.MARK_PLAY_FAILED_TITLE)).toBe(true);
  });

  it('a caller that is not a Mark play gesture (import, backfill) gets the log but no toast', async () => {
    apiFetch.mockResolvedValue({ ok: false, status: 422, json: async () => ({ detail: 'nope' }) });
    const { result } = renderHook(() => useRawClipSave());

    let out;
    await act(async () => {
      out = await result.current.saveClip(6, { start_time: 1, end_time: 2 }, undefined, { step: 'saveClip (import)', toast: false });
    });

    expect(out).toBe(null);
    const markPlay = errSpy.mock.calls.filter(([m]) => String(m).startsWith('[MarkPlay]'));
    expect(markPlay.length).toBe(1);
    expect(markPlay[0][0]).toBe('[MarkPlay] saveClip (import)');
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
