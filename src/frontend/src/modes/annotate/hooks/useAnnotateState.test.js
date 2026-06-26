import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAnnotateState from './useAnnotateState';
import { setPendingGame } from '../../../utils/pendingNavigation';
import { API_BASE } from '../../../config';

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
globalThis.URL.createObjectURL = mockCreateObjectURL;
globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

describe('useAnnotateState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear(); // T4000: annotateVideoUrl now seeds from the pending-game breadcrumb
  });

  afterEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
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

      // showAnnotateOverlay removed — now derived from useClipSelection state machine
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
  // T4000: EARLY /video SRC SEED (no-render-tick start)
  // ============================================================================

  describe('early /video src seed (T4000)', () => {
    it('seeds annotateVideoUrl from a pending game on first render (mounts <video> immediately)', () => {
      setPendingGame(42);
      const { result } = renderHook(() => useAnnotateState());
      // Seeded synchronously on the first render — the controlled <video> can mount
      // with a src on the first commit instead of waiting for a post-commit setState.
      expect(result.current.annotateVideoUrl).toBe(`${API_BASE}/api/games/42/video`);
    });

    it('carries a click-time clip seek into the seeded src', () => {
      setPendingGame(42, 12.5);
      const { result } = renderHook(() => useAnnotateState());
      expect(result.current.annotateVideoUrl).toBe(`${API_BASE}/api/games/42/video#t=12.5`);
    });

    it('does not seed (stays null) when there is no pending game', () => {
      const { result } = renderHook(() => useAnnotateState());
      expect(result.current.annotateVideoUrl).toBeNull();
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
    // showAnnotateOverlay test removed — now managed by useClipSelection state machine

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
