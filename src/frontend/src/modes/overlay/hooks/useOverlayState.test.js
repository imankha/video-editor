import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useOverlayState from './useOverlayState';

describe('useOverlayState', () => {
  describe('initial state', () => {
    it('starts with null interaction state', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.dragHighlight).toBeNull();
      expect(result.current.selectedHighlightKeyframeTime).toBeNull();
    });
  });

  describe('state setters', () => {
    it('setDragHighlight updates drag state', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setDragHighlight({ x: 100, y: 200, radiusX: 50, radiusY: 80 });
      });

      expect(result.current.dragHighlight).toEqual({ x: 100, y: 200, radiusX: 50, radiusY: 80 });
    });

    it('setSelectedHighlightKeyframeTime updates selection', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setSelectedHighlightKeyframeTime(7.5);
      });

      expect(result.current.selectedHighlightKeyframeTime).toBe(7.5);
    });
  });

  describe('sync state machine', () => {
    it('provides sync state machine', () => {
      const { result } = renderHook(() => useOverlayState());

      // Initial state
      expect(result.current.overlaySyncState).toBe('idle');
      expect(result.current.overlayLoadedProjectId).toBeNull();

      // State setters are functions
      expect(typeof result.current.setOverlaySyncState).toBe('function');
      expect(typeof result.current.setOverlayLoadedProjectId).toBe('function');
    });

    it('sync state can be updated', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setOverlaySyncState('loading');
      });
      expect(result.current.overlaySyncState).toBe('loading');

      act(() => {
        result.current.setOverlayLoadedProjectId(123);
        result.current.setOverlaySyncState('ready');
      });
      expect(result.current.overlaySyncState).toBe('ready');
      expect(result.current.overlayLoadedProjectId).toBe(123);
    });
  });
});
