import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  // Mock functions
  const mockTogglePlay = vi.fn();
  const mockStepForward = vi.fn();
  const mockStepBackward = vi.fn();
  const mockSeekForward = vi.fn();
  const mockSeekBackward = vi.fn();
  const mockSeek = vi.fn();
  const mockOnCopyCrop = vi.fn();
  const mockOnPasteCrop = vi.fn();
  const mockSelectAnnotateRegion = vi.fn();

  // Default props
  const defaultProps = {
    hasVideo: true,
    togglePlay: mockTogglePlay,
    stepForward: mockStepForward,
    stepBackward: mockStepBackward,
    seekForward: mockSeekForward,
    seekBackward: mockSeekBackward,
    seek: mockSeek,
    editorMode: 'framing',
    selectedLayer: 'playhead',
    copiedCrop: null,
    onCopyCrop: mockOnCopyCrop,
    onPasteCrop: mockOnPasteCrop,
    keyframes: [],
    framerate: 30,
    selectedCropKeyframeIndex: null,
    highlightKeyframes: [],
    highlightFramerate: 30,
    selectedHighlightKeyframeIndex: null,
    isHighlightEnabled: false,
    annotateVideoUrl: null,
    annotateSelectedLayer: 'playhead',
    clipRegions: [],
    annotateSelectedRegionId: null,
    selectAnnotateRegion: mockSelectAnnotateRegion,
  };

  const simulateKeyDown = (code, options = {}) => {
    const event = new KeyboardEvent('keydown', {
      code,
      bubbles: true,
      ...options,
    });
    document.dispatchEvent(event);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('space bar (play/pause)', () => {
    it('toggles play on space bar when video is loaded', () => {
      renderHook(() => useKeyboardShortcuts(defaultProps));

      simulateKeyDown('Space');

      expect(mockTogglePlay).toHaveBeenCalledTimes(1);
    });

    it('does not toggle play when no video is loaded', () => {
      renderHook(() => useKeyboardShortcuts({ ...defaultProps, hasVideo: false }));

      simulateKeyDown('Space');

      expect(mockTogglePlay).not.toHaveBeenCalled();
    });

    it('does not toggle play when typing in input', () => {
      renderHook(() => useKeyboardShortcuts(defaultProps));

      // Create an input element and focus it
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', {
        code: 'Space',
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: input, writable: false });
      input.dispatchEvent(event);

      expect(mockTogglePlay).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });

  describe('copy/paste crop (Ctrl+C/V)', () => {
    it('calls onCopyCrop on Ctrl+C when video is loaded', () => {
      renderHook(() => useKeyboardShortcuts(defaultProps));

      simulateKeyDown('KeyC', { ctrlKey: true });

      expect(mockOnCopyCrop).toHaveBeenCalledTimes(1);
    });

    it('does not copy when no video is loaded', () => {
      renderHook(() => useKeyboardShortcuts({ ...defaultProps, hasVideo: false }));

      simulateKeyDown('KeyC', { ctrlKey: true });

      expect(mockOnCopyCrop).not.toHaveBeenCalled();
    });

    it('calls onPasteCrop on Ctrl+V when copiedCrop exists', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        copiedCrop: { x: 0, y: 0, width: 100, height: 100 },
      }));

      simulateKeyDown('KeyV', { ctrlKey: true });

      expect(mockOnPasteCrop).toHaveBeenCalledTimes(1);
    });

    it('does not paste when no copiedCrop exists', () => {
      renderHook(() => useKeyboardShortcuts(defaultProps));

      simulateKeyDown('KeyV', { ctrlKey: true });

      expect(mockOnPasteCrop).not.toHaveBeenCalled();
    });

    it('supports Cmd key on Mac', () => {
      renderHook(() => useKeyboardShortcuts(defaultProps));

      simulateKeyDown('KeyC', { metaKey: true });

      expect(mockOnCopyCrop).toHaveBeenCalledTimes(1);
    });
  });

  describe('arrow keys (playhead layer)', () => {
    it('seeks backward 5s on ArrowLeft in playhead layer', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'playhead',
      }));

      simulateKeyDown('ArrowLeft');

      expect(mockSeekBackward).toHaveBeenCalledWith(5);
      expect(mockSeekForward).not.toHaveBeenCalled();
    });

    it('seeks forward 5s on ArrowRight in playhead layer', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'playhead',
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeekForward).toHaveBeenCalledWith(5);
      expect(mockSeekBackward).not.toHaveBeenCalled();
    });

    it('does not seek when no video is loaded', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        hasVideo: false,
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeekForward).not.toHaveBeenCalled();
    });

    it('ignores arrow keys when Ctrl is pressed', () => {
      renderHook(() => useKeyboardShortcuts(defaultProps));

      simulateKeyDown('ArrowRight', { ctrlKey: true });

      expect(mockSeekForward).not.toHaveBeenCalled();
    });

    it('falls back to stepForward when seekForward not provided', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'playhead',
        seekForward: undefined,
        seekBackward: undefined,
      }));

      simulateKeyDown('ArrowRight');

      expect(mockStepForward).toHaveBeenCalledTimes(1);
    });
  });

  describe('arrow keys (crop layer)', () => {
    const keyframes = [
      { frame: 0, x: 0, y: 0, width: 100, height: 100 },
      { frame: 30, x: 10, y: 10, width: 100, height: 100 },
      { frame: 60, x: 20, y: 20, width: 100, height: 100 },
    ];

    it('navigates to next crop keyframe on ArrowRight', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'crop',
        keyframes,
        selectedCropKeyframeIndex: 0,
        framerate: 30,
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeek).toHaveBeenCalledWith(1); // frame 30 / 30fps = 1s
    });

    it('navigates to previous crop keyframe on ArrowLeft', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'crop',
        keyframes,
        selectedCropKeyframeIndex: 2,
        framerate: 30,
      }));

      simulateKeyDown('ArrowLeft');

      expect(mockSeek).toHaveBeenCalledWith(1); // frame 30 / 30fps = 1s
    });

    it('selects first keyframe when none selected and ArrowRight pressed', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'crop',
        keyframes,
        selectedCropKeyframeIndex: null,
        framerate: 30,
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeek).toHaveBeenCalledWith(0); // frame 0 / 30fps = 0s
    });

    it('does nothing when no keyframes exist', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'crop',
        keyframes: [],
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeek).not.toHaveBeenCalled();
    });
  });

  describe('arrow keys (highlight layer)', () => {
    const highlightKeyframes = [
      { frame: 0 },
      { frame: 60 },
      { frame: 120 },
    ];

    it('navigates to next highlight keyframe when enabled', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'highlight',
        highlightKeyframes,
        selectedHighlightKeyframeIndex: 0,
        highlightFramerate: 60,
        isHighlightEnabled: true,
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeek).toHaveBeenCalledWith(1); // frame 60 / 60fps = 1s
    });

    it('does not navigate when highlight is disabled', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        selectedLayer: 'highlight',
        highlightKeyframes,
        isHighlightEnabled: false,
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeek).not.toHaveBeenCalled();
    });
  });

  describe('annotate mode navigation', () => {
    const clipRegions = [
      { id: 'region1', startTime: 0 },
      { id: 'region2', startTime: 5 },
      { id: 'region3', startTime: 10 },
    ];

    it('seeks 5s in playhead layer', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        editorMode: 'annotate',
        annotateVideoUrl: 'http://test.mp4',
        annotateSelectedLayer: 'playhead',
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSeekForward).toHaveBeenCalledWith(5);
    });

    it('navigates to next clip region on ArrowRight', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        editorMode: 'annotate',
        annotateVideoUrl: 'http://test.mp4',
        annotateSelectedLayer: 'clips',
        clipRegions,
        annotateSelectedRegionId: 'region1',
      }));

      simulateKeyDown('ArrowRight');

      expect(mockSelectAnnotateRegion).toHaveBeenCalledWith('region2');
      expect(mockSeek).toHaveBeenCalledWith(5);
    });

    it('navigates to previous clip region on ArrowLeft', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        editorMode: 'annotate',
        annotateVideoUrl: 'http://test.mp4',
        annotateSelectedLayer: 'clips',
        clipRegions,
        annotateSelectedRegionId: 'region3',
      }));

      simulateKeyDown('ArrowLeft');

      expect(mockSelectAnnotateRegion).toHaveBeenCalledWith('region2');
      expect(mockSeek).toHaveBeenCalledWith(5);
    });

    it('clamps to first region when at beginning', () => {
      renderHook(() => useKeyboardShortcuts({
        ...defaultProps,
        editorMode: 'annotate',
        annotateVideoUrl: 'http://test.mp4',
        annotateSelectedLayer: 'clips',
        clipRegions,
        annotateSelectedRegionId: 'region1',
      }));

      simulateKeyDown('ArrowLeft');

      // Should stay at first region
      expect(mockSelectAnnotateRegion).not.toHaveBeenCalled();
    });
  });
});
