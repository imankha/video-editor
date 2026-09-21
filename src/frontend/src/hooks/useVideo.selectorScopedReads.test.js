import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo';
import { useVideoStore } from '../stores';

/**
 * T10760: `useVideo` used to subscribe to the WHOLE videoStore
 *   `const { currentTime, ... } = useVideoStore();`
 * and returned plain (unmemoized) action functions.
 *
 * Every zustand `set()` allocates a fresh state object, so a selector-less
 * subscription's snapshot ALWAYS differs — even for a value-identical write like
 * `setCurrentTime(12.5)` when it already is 12.5 — and scheduled a SyncLane
 * re-render of the hook and all its consumers. The RAF playback loop writes
 * `currentTime` ~60x/sec, so whole editor screens re-rendered at that rate. This
 * was the AMPLIFIER behind T10750's lane-starvation bug.
 *
 * The fix: one scalar selector per slice actually read, and `useCallback`-wrapped
 * actions so consumer dependency arrays stop churning every render.
 *
 * These tests are RED against the pre-fix code:
 *  - the value-identical-write test re-renders (selector-less snapshot differs);
 *  - the stability tests fail (each render allocated new action functions).
 */

const ALL_ACTIONS = [
  'loadVideo',
  'loadVideoFromUrl',
  'loadVideoFromStreamingUrl',
  'play',
  'pause',
  'togglePlay',
  'seek',
  'stepForward',
  'stepBackward',
  'seekForward',
  'seekBackward',
  'restart',
  'clearError',
  'isUrlExpiredError',
];

describe('useVideo — T10760 selector-scoped reads', () => {
  beforeEach(() => {
    useVideoStore.getState().reset();
  });

  it('a value-identical setCurrentTime does NOT re-render a useVideo consumer', () => {
    // Park currentTime at a known non-zero value first, so writing the SAME value
    // below is a genuine no-op write rather than a transition from the 0 default.
    act(() => { useVideoStore.getState().setCurrentTime(12.5); });

    let renders = 0;
    renderHook(() => { renders += 1; return useVideo(); });
    const before = renders;

    // Same value the store already holds. Pre-fix this still re-rendered because
    // the selector-less snapshot (whole state object) is freshly allocated.
    act(() => { useVideoStore.getState().setCurrentTime(12.5); });

    expect(renders).toBe(before); // no re-render on a value-identical write
  });

  it('re-renders when currentTime actually changes (negative control)', () => {
    act(() => { useVideoStore.getState().setCurrentTime(12.5); });

    let renders = 0;
    renderHook(() => { renders += 1; return useVideo(); });
    const before = renders;

    act(() => { useVideoStore.getState().setCurrentTime(20); });

    expect(renders).toBeGreaterThan(before);
  });

  it('does NOT re-render when an UNREAD-value write leaves every read slice identical', () => {
    // Writing loadStartTime (a slice useVideo never reads) must not re-render.
    act(() => { useVideoStore.getState().setCurrentTime(5); });

    let renders = 0;
    renderHook(() => { renders += 1; return useVideo(); });
    const before = renders;

    act(() => { useVideoStore.getState().setLoadStartTime(999); });

    expect(renders).toBe(before);
  });
});

describe('useVideo — T10760 action referential stability', () => {
  beforeEach(() => {
    useVideoStore.getState().reset();
  });

  it('every returned action keeps its identity across a no-op re-render', () => {
    const { result, rerender } = renderHook(() => useVideo());
    const a = result.current;

    rerender();
    const b = result.current;

    for (const key of ALL_ACTIONS) {
      expect(typeof a[key]).toBe('function');
      expect(b[key], `action "${key}" should be referentially stable`).toBe(a[key]);
    }
  });

  it('actions independent of currentTime survive a currentTime write (RAF-loop churn)', () => {
    const { result } = renderHook(() => useVideo());
    const a = result.current;

    // The RAF loop fires setCurrentTime ~60x/sec during playback — the exact
    // churn this task kills. Actions that do not close over currentTime must keep
    // their identity through it, so consumer effects listing them stop re-arming.
    act(() => { useVideoStore.getState().setCurrentTime(33); });
    const b = result.current;

    expect(b.play).toBe(a.play);
    expect(b.pause).toBe(a.pause);
    expect(b.togglePlay).toBe(a.togglePlay);
    expect(b.loadVideo).toBe(a.loadVideo);

    // seek intentionally closes over currentTime (its >5s jump telemetry compares
    // against it), so its identity is CORRECTLY allowed to change on a real
    // currentTime change — assert that so the dep array can't silently go stale.
    expect(b.seek).not.toBe(a.seek);
  });
});
