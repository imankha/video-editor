import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTimelineZoom from './useTimelineZoom';

// T11860: the default zoom is a function of the screen (phone: 100% while the
// game has 0 plays, 300% from the first play), so the hook accepts a CHANGING
// default instead of reading it once at mount, and resetZoom returns to the
// CURRENT default (not always 100).
describe('useTimelineZoom default (T11860)', () => {
  it('starts at the given default, clamped to 100-500', () => {
    expect(renderHook(() => useTimelineZoom(300)).result.current.timelineZoom).toBe(300);
    expect(renderHook(() => useTimelineZoom(900)).result.current.timelineZoom).toBe(500);
    expect(renderHook(() => useTimelineZoom()).result.current.timelineZoom).toBe(100);
  });

  it('follows a changed default while the user has not touched the zoom', () => {
    const { result, rerender } = renderHook(({ d }) => useTimelineZoom(d), { initialProps: { d: 100 } });
    expect(result.current.timelineZoom).toBe(100);
    rerender({ d: 300 });
    expect(result.current.timelineZoom).toBe(300);
    rerender({ d: 100 });
    expect(result.current.timelineZoom).toBe(100);
  });

  it('keeps a zoom the user set when the default changes', () => {
    const { result, rerender } = renderHook(({ d }) => useTimelineZoom(d), { initialProps: { d: 100 } });
    act(() => { result.current.zoomIn(); });
    expect(result.current.timelineZoom).toBe(125);
    rerender({ d: 300 });
    expect(result.current.timelineZoom).toBe(125);
  });

  it('resetZoom returns to the CURRENT default, not always 100', () => {
    const { result, rerender } = renderHook(({ d }) => useTimelineZoom(d), { initialProps: { d: 100 } });
    rerender({ d: 300 });
    act(() => { result.current.zoomIn(); });
    expect(result.current.timelineZoom).toBe(325);
    act(() => { result.current.resetZoom(); });
    expect(result.current.timelineZoom).toBe(300);
    expect(result.current.scrollPosition).toBe(0);
  });
});
