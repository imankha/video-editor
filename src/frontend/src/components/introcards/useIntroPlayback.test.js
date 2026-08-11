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

// T6730 audit finding A: a single tick's gap above FRAME_GAP_BUDGET_MS (250ms)
// is now treated as a dropped-frames resume, not an advance (see the hook's
// own comment) — so simulating "N ms of real playback" must drive several
// budget-sized ticks, not one big jump, or the guard added for that fix would
// (correctly) swallow the whole thing.
function advanceFrames(totalMs, stepMs = 16) {
  let remaining = totalMs;
  while (remaining > 0) {
    const step = Math.min(stepMs, remaining);
    advanceFrame(step);
    remaining -= step;
  }
}

describe('useIntroPlayback (T6710 — NEW hook)', () => {
  it('rAF advances introTimeMs forward while playing', () => {
    const { result } = renderHook(() => useIntroPlayback(4.0)); // 4s -> 4000ms
    expect(result.current.introTimeMs).toBe(0);

    advanceFrames(500);
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

    advanceFrames(600);
    expect(onIntroEnded).not.toHaveBeenCalled();

    advanceFrames(600); // crosses 1000ms boundary
    expect(onIntroEnded).toHaveBeenCalledTimes(1);
    expect(result.current.introTimeMs).toBe(1000); // clamped, not overshooting

    // Further frames after reaching the end must NOT re-fire onIntroEnded.
    advanceFrames(500);
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
    advanceFrames(1000);
    expect(result.current.introTimeMs).toBe(0);

    act(() => result.current.setPlaying(true));
    advanceFrames(500);
    expect(result.current.introTimeMs).toBeGreaterThan(0);
  });

  // T6730 audit finding A.
  it('an oversized frame gap (backgrounded tab / stall) does not fast-forward the clock', () => {
    const { result } = renderHook(() => useIntroPlayback(4.0)); // durationMs = 4000
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    advanceFrame(700); // single tick, one big gap -- e.g. tab was hidden
    expect(result.current.introTimeMs).toBe(0); // NOT advanced by the gap
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('frame gap'));

    // The very next (normal-sized) tick resumes from where it left off.
    advanceFrame(16);
    expect(result.current.introTimeMs).toBeGreaterThan(0);
    expect(result.current.introTimeMs).toBeLessThanOrEqual(16 + 1);

    warnSpy.mockRestore();
  });

  // T6740 decision B (option 1): replaces the old "dead band" diagnostic —
  // a seek landing near durationMs now gets a guaranteed minimum dwell
  // instead of just a warning.
  it('holds the seeked-to pose for the minimum dwell before allowing auto-continue again', () => {
    const onIntroEnded = vi.fn();
    const { result } = renderHook(() => useIntroPlayback(4.0, { onIntroEnded })); // durationMs = 4000
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => result.current.seekIntro(3990)); // 10ms shy of the end -- the old "dead band"
    expect(result.current.introTimeMs).toBe(3990);

    // Many frames pass, well under the 1000ms dwell floor -- the clock must
    // NOT advance past the seeked pose, and onIntroEnded must not fire.
    advanceFrames(900);
    expect(result.current.introTimeMs).toBe(3990);
    expect(onIntroEnded).not.toHaveBeenCalled();

    // Once the dwell elapses, the clock resumes advancing from where it was
    // held and reaches the end shortly after.
    advanceFrames(200);
    expect(onIntroEnded).toHaveBeenCalledTimes(1);
    expect(result.current.introTimeMs).toBe(4000);
    expect(warnSpy).not.toHaveBeenCalled(); // no frame-gap false positive from the hold

    warnSpy.mockRestore();
  });

  it('the dwell floor applies to any manual seek into the intro, not just ones near the end', () => {
    const { result } = renderHook(() => useIntroPlayback(4.0)); // durationMs = 4000

    act(() => result.current.seekIntro(1000)); // nowhere near the end
    advanceFrames(900);
    // Still held at the seeked pose -- the floor is unconditional (option 1
    // over option 2), not scaled to distance from durationMs.
    expect(result.current.introTimeMs).toBe(1000);

    advanceFrames(200);
    expect(result.current.introTimeMs).toBeGreaterThan(1000); // resumed advancing
  });

  it('seeking directly to durationMs (not a landing short of it) fires onIntroEnded immediately, no dwell', () => {
    const onIntroEnded = vi.fn();
    const { result } = renderHook(() => useIntroPlayback(2.0, { onIntroEnded })); // durationMs = 2000

    act(() => result.current.seekIntro(2000));
    expect(onIntroEnded).toHaveBeenCalledTimes(1); // no 1000ms wait before this fires
  });
});
