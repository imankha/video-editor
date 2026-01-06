import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAnnotateState from './useAnnotateState';

// Mock the videoMetadata utility
vi.mock('../../../utils/videoMetadata', () => ({
  extractVideoMetadataFromUrl: vi.fn().mockResolvedValue({
    width: 1920,
    height: 1080,
    duration: 5400, // 90 minutes for a full game
    framerate: 30
  })
}));

// Mock URL.createObjectURL and URL.revokeObjectURL
const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
const mockRevokeObjectURL = vi.fn();
global.URL.createObjectURL = mockCreateObjectURL;
global.URL.revokeObjectURL = mockRevokeObjectURL;

describe('useAnnotateState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // INITIAL STATE
  // ============================================================================

  describe('initial state', () => {
    it('starts with null video state', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.annotateVideoFile).toBeNull();
      expect(result.current.annotateVideoUrl).toBeNull();
      expect(result.current.annotateVideoMetadata).toBeNull();
      expect(result.current.annotateGameId).toBeNull();
    });

    it('starts with loading states false', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.isCreatingAnnotatedVideo).toBe(false);
      expect(result.current.isImportingToProjects).toBe(false);
      expect(result.current.isUploadingGameVideo).toBe(false);
      expect(result.current.isExportingOrImporting).toBe(false);
    });

    it('starts with default playback settings', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.annotatePlaybackSpeed).toBe(1);
      expect(result.current.annotateFullscreen).toBe(false);
    });

    it('starts with default UI state', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.showAnnotateOverlay).toBe(false);
      expect(result.current.annotateSelectedLayer).toBe('clips');
    });

    it('hasAnnotateVideo is false initially', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.hasAnnotateVideo).toBe(false);
    });

    it('isAssociatedWithGame is false initially', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.isAssociatedWithGame).toBe(false);
    });
  });

  // ============================================================================
  // LOAD VIDEO FROM URL
  // ============================================================================

  describe('loadAnnotateVideoFromUrl', () => {
    it('sets video URL and extracts metadata', async () => {
      const { result } = renderHook(() => useAnnotateState());

      await act(async () => {
        await result.current.loadAnnotateVideoFromUrl('http://example.com/game.mp4');
      });

      expect(result.current.annotateVideoUrl).toBe('http://example.com/game.mp4');
      expect(result.current.annotateVideoMetadata).toBeDefined();
      expect(result.current.annotateVideoMetadata.duration).toBe(5400);
      expect(result.current.hasAnnotateVideo).toBe(true);
    });

    it('sets game ID when provided', async () => {
      const { result } = renderHook(() => useAnnotateState());

      await act(async () => {
        await result.current.loadAnnotateVideoFromUrl('http://example.com/game.mp4', 'game-123');
      });

      expect(result.current.annotateGameId).toBe('game-123');
      expect(result.current.isAssociatedWithGame).toBe(true);
    });

    it('clears video file when loading from URL', async () => {
      const { result } = renderHook(() => useAnnotateState());

      await act(async () => {
        await result.current.loadAnnotateVideoFromUrl('http://example.com/game.mp4');
      });

      expect(result.current.annotateVideoFile).toBeNull();
    });
  });

  // ============================================================================
  // LOAD VIDEO FROM FILE
  // ============================================================================

  describe('loadAnnotateVideoFromFile', () => {
    it('creates object URL and extracts metadata', async () => {
      const { result } = renderHook(() => useAnnotateState());

      const mockFile = new File([''], 'game.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.loadAnnotateVideoFromFile(mockFile);
      });

      expect(mockCreateObjectURL).toHaveBeenCalledWith(mockFile);
      expect(result.current.annotateVideoUrl).toBe('blob:mock-url');
      expect(result.current.annotateVideoFile).toBe(mockFile);
      expect(result.current.hasAnnotateVideo).toBe(true);
    });

    it('clears game ID for fresh uploads', async () => {
      const { result } = renderHook(() => useAnnotateState());

      // First set a game ID
      act(() => {
        result.current.setAnnotateGameId('game-123');
      });

      const mockFile = new File([''], 'game.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.loadAnnotateVideoFromFile(mockFile);
      });

      expect(result.current.annotateGameId).toBeNull();
      expect(result.current.isAssociatedWithGame).toBe(false);
    });
  });

  // ============================================================================
  // RESET STATE
  // ============================================================================

  describe('resetAnnotateState', () => {
    it('clears all state', async () => {
      const { result } = renderHook(() => useAnnotateState());

      // Set up some state
      await act(async () => {
        await result.current.loadAnnotateVideoFromUrl('http://example.com/game.mp4', 'game-123');
        result.current.setAnnotatePlaybackSpeed(2);
        result.current.setAnnotateFullscreen(true);
        result.current.setShowAnnotateOverlay(true);
        result.current.setAnnotateSelectedLayer('playhead');
      });

      expect(result.current.hasAnnotateVideo).toBe(true);

      act(() => {
        result.current.resetAnnotateState();
      });

      expect(result.current.annotateVideoFile).toBeNull();
      expect(result.current.annotateVideoUrl).toBeNull();
      expect(result.current.annotateVideoMetadata).toBeNull();
      expect(result.current.annotateGameId).toBeNull();
      expect(result.current.isCreatingAnnotatedVideo).toBe(false);
      expect(result.current.isImportingToProjects).toBe(false);
      expect(result.current.isUploadingGameVideo).toBe(false);
      expect(result.current.annotatePlaybackSpeed).toBe(1);
      expect(result.current.annotateFullscreen).toBe(false);
      expect(result.current.showAnnotateOverlay).toBe(false);
      expect(result.current.annotateSelectedLayer).toBe('clips');
      expect(result.current.hasAnnotateVideo).toBe(false);
    });

    it('revokes object URL when resetting from file upload', async () => {
      const { result } = renderHook(() => useAnnotateState());

      const mockFile = new File([''], 'game.mp4', { type: 'video/mp4' });

      await act(async () => {
        await result.current.loadAnnotateVideoFromFile(mockFile);
      });

      act(() => {
        result.current.resetAnnotateState();
      });

      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  // ============================================================================
  // PLAYBACK CONTROLS
  // ============================================================================

  describe('playback controls', () => {
    it('setAnnotatePlaybackSpeed updates speed', () => {
      const { result } = renderHook(() => useAnnotateState());

      act(() => {
        result.current.setAnnotatePlaybackSpeed(2);
      });

      expect(result.current.annotatePlaybackSpeed).toBe(2);
    });

    it('cyclePlaybackSpeed cycles through speeds', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.annotatePlaybackSpeed).toBe(1);

      act(() => {
        result.current.cyclePlaybackSpeed();
      });
      expect(result.current.annotatePlaybackSpeed).toBe(1.5);

      act(() => {
        result.current.cyclePlaybackSpeed();
      });
      expect(result.current.annotatePlaybackSpeed).toBe(2);

      act(() => {
        result.current.cyclePlaybackSpeed();
      });
      expect(result.current.annotatePlaybackSpeed).toBe(0.5);

      act(() => {
        result.current.cyclePlaybackSpeed();
      });
      expect(result.current.annotatePlaybackSpeed).toBe(1);
    });

    it('toggleFullscreen toggles fullscreen state', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.annotateFullscreen).toBe(false);

      act(() => {
        result.current.toggleFullscreen();
      });
      expect(result.current.annotateFullscreen).toBe(true);

      act(() => {
        result.current.toggleFullscreen();
      });
      expect(result.current.annotateFullscreen).toBe(false);
    });
  });

  // ============================================================================
  // LOADING STATES
  // ============================================================================

  describe('loading states', () => {
    it('setIsCreatingAnnotatedVideo updates state', () => {
      const { result } = renderHook(() => useAnnotateState());

      act(() => {
        result.current.setIsCreatingAnnotatedVideo(true);
      });

      expect(result.current.isCreatingAnnotatedVideo).toBe(true);
      expect(result.current.isExportingOrImporting).toBe(true);
    });

    it('setIsImportingToProjects updates state', () => {
      const { result } = renderHook(() => useAnnotateState());

      act(() => {
        result.current.setIsImportingToProjects(true);
      });

      expect(result.current.isImportingToProjects).toBe(true);
      expect(result.current.isExportingOrImporting).toBe(true);
    });

    it('isExportingOrImporting reflects combined state', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.isExportingOrImporting).toBe(false);

      act(() => {
        result.current.setIsCreatingAnnotatedVideo(true);
      });
      expect(result.current.isExportingOrImporting).toBe(true);

      act(() => {
        result.current.setIsCreatingAnnotatedVideo(false);
        result.current.setIsImportingToProjects(true);
      });
      expect(result.current.isExportingOrImporting).toBe(true);

      act(() => {
        result.current.setIsImportingToProjects(false);
      });
      expect(result.current.isExportingOrImporting).toBe(false);
    });
  });

  // ============================================================================
  // UI STATE
  // ============================================================================

  describe('UI state', () => {
    it('setShowAnnotateOverlay updates overlay visibility', () => {
      const { result } = renderHook(() => useAnnotateState());

      act(() => {
        result.current.setShowAnnotateOverlay(true);
      });

      expect(result.current.showAnnotateOverlay).toBe(true);
    });

    it('setAnnotateSelectedLayer updates layer selection', () => {
      const { result } = renderHook(() => useAnnotateState());

      act(() => {
        result.current.setAnnotateSelectedLayer('playhead');
      });

      expect(result.current.annotateSelectedLayer).toBe('playhead');
    });
  });

  // ============================================================================
  // REFS
  // ============================================================================

  describe('refs', () => {
    it('provides annotateContainerRef', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.annotateContainerRef).toBeDefined();
      expect(result.current.annotateContainerRef.current).toBeNull();
    });

    it('provides annotateFileInputRef', () => {
      const { result } = renderHook(() => useAnnotateState());

      expect(result.current.annotateFileInputRef).toBeDefined();
      expect(result.current.annotateFileInputRef.current).toBeNull();
    });
  });
});
