import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSkipTap, SKIP_TAP_SECONDS, DOUBLE_TAP_MS, BURST_MS } from './useSkipTap';

// T14350: double-tap / double-click on the video skips 5 s (left half back,
// right half forward); further taps in the burst window accumulate. The single
// tap keeps its own meaning (play/pause) and is never delayed: the second tap
// re-toggles so the playing state is unchanged after a skip, and taps 3+ are
// swallowed (stopPropagation) so they don't toggle again.

const WIDTH = 400;
function click(side, { button = false } = {}) {
  return {
    clientX: side === 'left' ? 50 : 350,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, width: WIDTH }) },
    target: { closest: (sel) => (button && sel.includes('button') ? {} : null) },
    stopPropagation: vi.fn(),
  };
}

function setup(enabled = true) {
  const onSeekForward = vi.fn();
  const onSeekBackward = vi.fn();
  const hook = renderHook((p) => useSkipTap(p), {
    initialProps: { enabled, onSeekForward, onSeekBackward },
  });
  const tap = (side, opts) => {
    const e = click(side, opts);
    act(() => hook.result.current.onClickCapture(e));
    return e;
  };
  return { hook, tap, onSeekForward, onSeekBackward };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useSkipTap (T14350)', () => {
  it('uses YouTube timings: 5 s skip, ~300 ms double tap, ~700 ms burst', () => {
    expect(SKIP_TAP_SECONDS).toBe(5);
    expect(DOUBLE_TAP_MS).toBe(300);
    expect(BURST_MS).toBe(700);
  });

  it('a single tap does not skip and is not swallowed', () => {
    const { hook, tap, onSeekForward, onSeekBackward } = setup();
    const e = tap('right');
    expect(onSeekForward).not.toHaveBeenCalled();
    expect(onSeekBackward).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
    expect(hook.result.current.feedback).toBeNull();
  });

  it('double tap on the right half skips forward 5 s and shows "5 seconds" on the right', () => {
    const { hook, tap, onSeekForward } = setup();
    tap('right');
    vi.advanceTimersByTime(150);
    const second = tap('right');
    expect(onSeekForward).toHaveBeenCalledWith(5);
    // The second tap re-toggles play (undoing the first), so it propagates.
    expect(second.stopPropagation).not.toHaveBeenCalled();
    expect(hook.result.current.feedback).toMatchObject({ side: 'right', seconds: 5 });
  });

  it('double tap on the left half skips back 5 s', () => {
    const { hook, tap, onSeekBackward, onSeekForward } = setup();
    tap('left');
    vi.advanceTimersByTime(150);
    tap('left');
    expect(onSeekBackward).toHaveBeenCalledWith(5);
    expect(onSeekForward).not.toHaveBeenCalled();
    expect(hook.result.current.feedback).toMatchObject({ side: 'left', seconds: 5 });
  });

  it('three quick taps accumulate to 10 s and the third tap is swallowed', () => {
    const { hook, tap, onSeekForward } = setup();
    tap('right');
    vi.advanceTimersByTime(150);
    tap('right');
    vi.advanceTimersByTime(400);
    const third = tap('right');
    expect(onSeekForward).toHaveBeenCalledTimes(2);
    expect(third.stopPropagation).toHaveBeenCalled();
    expect(hook.result.current.feedback).toMatchObject({ side: 'right', seconds: 10 });
  });

  it('feedback clears after the burst window', () => {
    const { hook, tap } = setup();
    tap('right');
    tap('right');
    act(() => { vi.advanceTimersByTime(BURST_MS + 50); });
    expect(hook.result.current.feedback).toBeNull();
  });

  it('two taps further apart than the double-tap window do not skip', () => {
    const { tap, onSeekForward } = setup();
    tap('right');
    vi.advanceTimersByTime(DOUBLE_TAP_MS + 50);
    tap('right');
    expect(onSeekForward).not.toHaveBeenCalled();
  });

  it('taps on different halves do not skip', () => {
    const { tap, onSeekForward, onSeekBackward } = setup();
    tap('left');
    tap('right');
    expect(onSeekForward).not.toHaveBeenCalled();
    expect(onSeekBackward).not.toHaveBeenCalled();
  });

  it('taps on a button inside the video (e.g. Retry) are ignored', () => {
    const { tap, onSeekForward } = setup();
    tap('right', { button: true });
    tap('right', { button: true });
    expect(onSeekForward).not.toHaveBeenCalled();
  });

  it('does nothing while disabled (play editor open)', () => {
    const { hook, tap, onSeekForward } = setup(false);
    tap('right');
    tap('right');
    expect(onSeekForward).not.toHaveBeenCalled();
    expect(hook.result.current.feedback).toBeNull();
  });
});
