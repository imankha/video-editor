import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import useZoom from '../useZoom';

describe('useZoom', () => {
  it('centers pan when button zoom-out reaches 100%', () => {
    const { result } = renderHook(() => useZoom());

    act(() => {
      result.current.setZoomLevel(2);
      result.current.setPan(80, -40);
    });
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());
    act(() => result.current.zoomOut());

    expect(result.current.zoom).toBe(1);
    expect(result.current.panOffset).toEqual({ x: 0, y: 0 });
    expect(result.current.isZoomed).toBe(false);
  });

  it('centers pan when wheel zoom-out reaches 100%', () => {
    const { result } = renderHook(() => useZoom());

    act(() => {
      result.current.setZoomLevel(1.1);
      result.current.setPan(60, 20);
    });
    act(() => result.current.zoomByWheel(-1));

    expect(result.current.zoom).toBe(1);
    expect(result.current.panOffset).toEqual({ x: 0, y: 0 });
  });

  it('centers pan when directly set to 100%', () => {
    const { result } = renderHook(() => useZoom());

    act(() => {
      result.current.setZoomLevel(2);
      result.current.setPan(-30, 45);
    });
    act(() => result.current.setZoomLevel(1));

    expect(result.current.panOffset).toEqual({ x: 0, y: 0 });
    expect(result.current.isZoomed).toBe(false);
  });

  it('preserves pan while zooming down above 100%', () => {
    const { result } = renderHook(() => useZoom());

    act(() => {
      result.current.setZoomLevel(2);
      result.current.setPan(25, -15);
    });
    act(() => result.current.zoomOut());

    expect(result.current.zoom).toBe(1.75);
    expect(result.current.panOffset).toEqual({ x: 25, y: -15 });
  });
});
