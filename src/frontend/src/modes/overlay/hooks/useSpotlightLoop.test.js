import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSpotlightLoop } from './useSpotlightLoop';

// LOOP_EPS in the hook is 0.03s. Span [1, 5] wraps once currentTime >= 4.97.
const SPAN = { start: 1, end: 5 };

function drive(props) {
  const seek = vi.fn();
  const { rerender } = renderHook(
    (p) => useSpotlightLoop({ seek, ...p }),
    { initialProps: props }
  );
  return { seek, rerender };
}

describe('useSpotlightLoop', () => {
  it('wraps to span.start when playhead reaches span.end in loop mode', () => {
    const { seek } = drive({
      playMode: 'loop', span: SPAN, currentTime: 4.99, isPlaying: true, isSeeking: false,
    });
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(SPAN.start);
  });

  it('wraps at exactly span.end - LOOP_EPS boundary', () => {
    const { seek } = drive({
      playMode: 'loop', span: SPAN, currentTime: 4.97, isPlaying: true, isSeeking: false,
    });
    expect(seek).toHaveBeenCalledWith(1);
  });

  it('does NOT wrap while still inside the span (before the end)', () => {
    const { seek } = drive({
      playMode: 'loop', span: SPAN, currentTime: 3.0, isPlaying: true, isSeeking: false,
    });
    expect(seek).not.toHaveBeenCalled();
  });

  it('no-op in full mode even at the span end', () => {
    const { seek } = drive({
      playMode: 'full', span: SPAN, currentTime: 5.0, isPlaying: true, isSeeking: false,
    });
    expect(seek).not.toHaveBeenCalled();
  });

  it('no-op when paused', () => {
    const { seek } = drive({
      playMode: 'loop', span: SPAN, currentTime: 5.0, isPlaying: false, isSeeking: false,
    });
    expect(seek).not.toHaveBeenCalled();
  });

  it('no-op while seeking (does not fight an in-flight seek)', () => {
    const { seek } = drive({
      playMode: 'loop', span: SPAN, currentTime: 5.0, isPlaying: true, isSeeking: true,
    });
    expect(seek).not.toHaveBeenCalled();
  });

  it('no-op when span is null (zero regions)', () => {
    const { seek } = drive({
      playMode: 'loop', span: null, currentTime: 5.0, isPlaying: true, isSeeking: false,
    });
    expect(seek).not.toHaveBeenCalled();
  });

  it('wraps on a later render once the playhead crosses the end', () => {
    const seek = vi.fn();
    const { rerender } = renderHook(
      (p) => useSpotlightLoop({ seek, ...p }),
      { initialProps: { playMode: 'loop', span: SPAN, currentTime: 2.0, isPlaying: true, isSeeking: false } }
    );
    expect(seek).not.toHaveBeenCalled();
    rerender({ playMode: 'loop', span: SPAN, currentTime: 4.98, isPlaying: true, isSeeking: false });
    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(1);
  });
});
