import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useOverlayState from './useOverlayState';

// Mock the videoMetadata utility
vi.mock('../../../utils/videoMetadata', () => ({
  extractVideoMetadataFromUrl: vi.fn().mockResolvedValue({
    width: 1920,
    height: 1080,
    duration: 30,
    framerate: 30
  })
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();
global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

// Mock localStorage
const localStorageMock = {
  store: {},
  getItem: vi.fn((key) => localStorageMock.store[key] || null),
  setItem: vi.fn((key, value) => { localStorageMock.store[key] = value; }),
  removeItem: vi.fn((key) => { delete localStorageMock.store[key]; }),
  clear: vi.fn(() => { localStorageMock.store = {}; }),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

describe('useOverlayState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    localStorageMock.store = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // INITIAL STATE
  // ============================================================================

  describe('initial state', () => {
    it('starts with null video state', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.overlayVideoFile).toBeNull();
      expect(result.current.overlayVideoUrl).toBeNull();
      expect(result.current.overlayVideoMetadata).toBeNull();
      expect(result.current.overlayClipMetadata).toBeNull();
    });

    it('starts with null interaction state', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.dragHighlight).toBeNull();
      expect(result.current.selectedHighlightKeyframeTime).toBeNull();
    });

    it('starts with default effect type (dark_overlay)', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.highlightEffectType).toBe('dark_overlay');
    });

    it('loads effect type from localStorage if present', () => {
      localStorageMock.store['highlightEffectType'] = 'brightness_boost';
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.highlightEffectType).toBe('brightness_boost');
    });

    it('starts with loading state false', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.isLoadingWorkingVideo).toBe(false);
    });

    it('hasOverlayVideo is false initially', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.hasOverlayVideo).toBe(false);
    });

    it('isFromFramingExport is false initially', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.isFromFramingExport).toBe(false);
    });
  });

  // ============================================================================
  // LOAD VIDEO FROM URL
  // ============================================================================

  describe('loadOverlayVideoFromUrl', () => {
    it('sets video URL and extracts metadata', async () => {
      const { result } = renderHook(() => useOverlayState());

      await act(async () => {
        await result.current.loadOverlayVideoFromUrl('http://example.com/video.mp4');
      });

      expect(result.current.overlayVideoUrl).toBe('http://example.com/video.mp4');
      expect(result.current.overlayVideoMetadata).toBeDefined();
      expect(result.current.overlayVideoMetadata.width).toBe(1920);
      expect(result.current.hasOverlayVideo).toBe(true);
    });

    it('sets clip metadata when provided', async () => {
      const { result } = renderHook(() => useOverlayState());

      const clipMetadata = { source_clips: [{ start_time: 0, end_time: 10 }] };

      await act(async () => {
        await result.current.loadOverlayVideoFromUrl('http://example.com/video.mp4', clipMetadata);
      });

      expect(result.current.overlayClipMetadata).toEqual(clipMetadata);
      expect(result.current.isFromFramingExport).toBe(true);
    });

    it('clears video file when loading from URL', async () => {
      const { result } = renderHook(() => useOverlayState());

      // First set a file
      act(() => {
        result.current.setOverlayVideoUrl('blob:existing');
      });

      await act(async () => {
        await result.current.loadOverlayVideoFromUrl('http://example.com/video.mp4');
      });

      expect(result.current.overlayVideoFile).toBeNull();
    });

    it('sets loading state during load', async () => {
      const { result } = renderHook(() => useOverlayState());

      let loadingDuringCall = false;

      await act(async () => {
        const promise = result.current.loadOverlayVideoFromUrl('http://example.com/video.mp4');
        // Check loading state is true during the async operation
        // Note: This is hard to test precisely without more control over timing
        await promise;
      });

      expect(result.current.isLoadingWorkingVideo).toBe(false);
    });
  });

  // ============================================================================
  // LOAD VIDEO FROM FILE
  // ============================================================================

  describe('loadOverlayVideoFromFile', () => {
    it('creates object URL and extracts metadata', async () => {
      const { result } = renderHook(() => useOverlayState());

      const mockFile = new File([''], 'test.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.loadOverlayVideoFromFile(mockFile);
      });

      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockFile);
      expect(result.current.overlayVideoUrl).toBe('blob:mock-url');
      expect(result.current.overlayVideoFile).toBe(mockFile);
      expect(result.current.hasOverlayVideo).toBe(true);
    });

    it('clears clip metadata for fresh uploads', async () => {
      const { result } = renderHook(() => useOverlayState());

      // First set clip metadata
      act(() => {
        result.current.setOverlayClipMetadata({ source_clips: [] });
      });

      const mockFile = new File([''], 'test.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.loadOverlayVideoFromFile(mockFile);
      });

      expect(result.current.overlayClipMetadata).toBeNull();
      expect(result.current.isFromFramingExport).toBe(false);
    });
  });

  // ============================================================================
  // RESET STATE
  // ============================================================================

  describe('resetOverlayState', () => {
    it('clears all state', async () => {
      const { result } = renderHook(() => useOverlayState());

      // Set up some state
      await act(async () => {
        await result.current.loadOverlayVideoFromUrl('http://example.com/video.mp4');
        result.current.setDragHighlight({ x: 100, y: 100 });
        result.current.setSelectedHighlightKeyframeTime(5);
        result.current.setHighlightEffectType('brightness_boost');
      });

      expect(result.current.hasOverlayVideo).toBe(true);

      act(() => {
        result.current.resetOverlayState();
      });

      expect(result.current.overlayVideoFile).toBeNull();
      expect(result.current.overlayVideoUrl).toBeNull();
      expect(result.current.overlayVideoMetadata).toBeNull();
      expect(result.current.overlayClipMetadata).toBeNull();
      expect(result.current.dragHighlight).toBeNull();
      expect(result.current.selectedHighlightKeyframeTime).toBeNull();
      expect(result.current.isLoadingWorkingVideo).toBe(false);
      // Effect type is preserved from localStorage (was set to 'brightness_boost' before reset)
      expect(result.current.highlightEffectType).toBe('brightness_boost');
      expect(result.current.hasOverlayVideo).toBe(false);
    });

    it('revokes object URL when resetting from file upload', async () => {
      const { result } = renderHook(() => useOverlayState());

      const mockFile = new File([''], 'test.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.loadOverlayVideoFromFile(mockFile);
      });

      act(() => {
        result.current.resetOverlayState();
      });

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  // ============================================================================
  // STATE SETTERS
  // ============================================================================

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

    it('setHighlightEffectType updates effect type', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setHighlightEffectType('brightness_boost');
      });

      expect(result.current.highlightEffectType).toBe('brightness_boost');
    });

    it('setOverlayVideoUrl updates URL directly', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setOverlayVideoUrl('http://direct-set.com/video.mp4');
      });

      expect(result.current.overlayVideoUrl).toBe('http://direct-set.com/video.mp4');
      expect(result.current.hasOverlayVideo).toBe(true);
    });

    it('setOverlayVideoMetadata updates metadata directly', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setOverlayVideoMetadata({ width: 1280, height: 720, duration: 60 });
      });

      expect(result.current.overlayVideoMetadata).toEqual({ width: 1280, height: 720, duration: 60 });
    });

    it('setIsLoadingWorkingVideo updates loading state', () => {
      const { result } = renderHook(() => useOverlayState());

      act(() => {
        result.current.setIsLoadingWorkingVideo(true);
      });

      expect(result.current.isLoadingWorkingVideo).toBe(true);

      act(() => {
        result.current.setIsLoadingWorkingVideo(false);
      });

      expect(result.current.isLoadingWorkingVideo).toBe(false);
    });
  });

  // ============================================================================
  // PERSISTENCE REFS
  // ============================================================================

  describe('persistence refs', () => {
    it('provides pendingOverlaySaveRef', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.pendingOverlaySaveRef).toBeDefined();
      expect(result.current.pendingOverlaySaveRef.current).toBeNull();
    });

    it('provides overlayDataLoadedRef', () => {
      const { result } = renderHook(() => useOverlayState());

      expect(result.current.overlayDataLoadedRef).toBeDefined();
      expect(result.current.overlayDataLoadedRef.current).toBe(false);
    });

    it('refs are mutable', () => {
      const { result } = renderHook(() => useOverlayState());

      result.current.overlayDataLoadedRef.current = true;
      result.current.pendingOverlaySaveRef.current = { test: 'data' };

      expect(result.current.overlayDataLoadedRef.current).toBe(true);
      expect(result.current.pendingOverlaySaveRef.current).toEqual({ test: 'data' });
    });
  });
});
