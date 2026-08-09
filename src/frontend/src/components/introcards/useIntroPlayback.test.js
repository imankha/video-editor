// T6710 Stage 3 — useIntroPlayback (NEW hook, does not exist yet -- RED on
// import until Stage 4 creates introcards/useIntroPlayback.js).
//
// Design doc §4(ii): the intro's own clock. rAF advances `introTimeMs` while
// playing; `seekIntro(ms)` clamps to [0, durationMs] (true arbitrary seek,
// decision 2); `onIntroEnded` fires exactly ONCE when the clock reaches
// durationMs; the clock is frozen (no rAF advance) whenever inactive.
//
// Mirrors the rAF-driving pattern already used by useStoryPlayback.test.js:
// requestAnimationFrame is mocked to capture the scheduled callback so the
// test can drive frames deterministically instead of depending on real time.

import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useIntroPlayback } from './useIntroPlayback';

let rafCb = null;
let realRaf;
let realCancel;
let realNow;
let nowMs = 0;

beforeEach(() => {
  rafCb = null;
  nowMs = 0;
  realRaf = global.requestAnimationFrame;
  realCancel = global.cancelAnimationFrame;
  realNow = global.performance.now;
  global.requestAnimationFrame = vi.fn((cb) => { rafCb = cb; return 1; });
  global.cancelAnimationFrame = vi.fn();
  global.performance.now = () => nowMs;
});

afterEach(() => {
  global.requestAnimationFrame = realRaf;
  global.cancelAnimationFrame = realCancel;
  global.performance.now = realNow;
});

// Advance the mocked clock by `ms` and run one rAF tick (which re-schedules
// itself, refreshing rafCb for the next call).
function advanceFrame(ms) {
  nowMs += ms;
  const cb = rafCb;
  rafCb = null;
  act(() => { cb && cb(nowMs); });
}

describe('useIntroPlayback (T6710 — NEW hook)', () => {
  it('rAF advances introTimeMs forward while playing', () => {
    const { result } = renderHook(() => useIntroPlayback(4.0)); // 4s -> 4000ms
    expect(result.current.introTimeMs).toBe(0);

    advanceFrame(500);
    expect(result.current.introTimeMs).toBeGreaterThan(0);
    expect(result.current.introTimeMs).toBeLessThanOrEqual(500 + 1); // tolerate rounding
  });

  it('seekIntro(ms) clamps to [0, durationMs]', () => {
    const { result } = renderHook(() => useIntroPlayback(4.0)); // durationMs = 4000

    act(() => result.current.seekIntro(2500));
    expect(result.current.introTimeMs).toBe(2500);

    act(() => result.current.seekIntro(-500));
    expect(result.current.introTimeMs).toBe(0);

    act(() => result.current.seekIntro(9999));
    expect(result.current.introTimeMs).toBe(4000);
  });

  it('onIntroEnded fires exactly ONCE when the clock reaches durationMs', () => {
    const onIntroEnded = vi.fn();
    const { result } = renderHook(() => useIntroPlayback(1.0, { onIntroEnded })); // 1000ms

    advanceFrame(600);
    expect(onIntroEnded).not.toHaveBeenCalled();

    advanceFrame(600); // crosses 1000ms boundary
    expect(onIntroEnded).toHaveBeenCalledTimes(1);
    expect(result.current.introTimeMs).toBe(1000); // clamped, not overshooting

    // Further frames after reaching the end must NOT re-fire onIntroEnded.
    advanceFrame(500);
    expect(onIntroEnded).toHaveBeenCalledTimes(1);
  });

  it('a direct seekIntro to durationMs also fires onIntroEnded exactly once', () => {
    const onIntroEnded = vi.fn();
    const { result } = renderHook(() => useIntroPlayback(2.0, { onIntroEnded })); // 2000ms

    act(() => result.current.seekIntro(2000));
    expect(onIntroEnded).toHaveBeenCalledTimes(1);

    act(() => result.current.seekIntro(2000)); // seeking to the end again must not double-fire
    expect(onIntroEnded).toHaveBeenCalledTimes(1);
  });

  it('the clock is frozen (no advance) while inactive/paused', () => {
    const { result } = renderHook(() => useIntroPlayback(4.0));

    act(() => result.current.setPlaying(false));
    // No rAF advance should move the clock while paused.
    advanceFrame(1000);
    expect(result.current.introTimeMs).toBe(0);

    act(() => result.current.setPlaying(true));
    advanceFrame(500);
    expect(result.current.introTimeMs).toBeGreaterThan(0);
  });
});
