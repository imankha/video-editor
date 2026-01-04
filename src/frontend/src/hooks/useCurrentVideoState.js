import { useMemo } from 'react';

/**
 * useCurrentVideoState - Unified video state selector based on editor mode
 *
 * This hook provides a single interface to access video state regardless of
 * which editor mode is active. It eliminates conditional logic in components
 * that need to work with the current video.
 *
 * Phase 4 of App.jsx God Class refactoring (CODE_SMELLS.md #1)
 *
 * @param {string} editorMode - Current editor mode: 'framing' | 'overlay' | 'annotate'
 * @param {Object} framingState - State from useVideo hook
 * @param {Object} overlayState - State from useOverlayState hook
 * @param {Object} annotateState - State from useAnnotateState hook
 *
 * @returns {Object} Unified video state:
 *   - url: Current video URL (or null)
 *   - metadata: Video metadata (duration, width, height, etc.)
 *   - file: Video file object (if loaded from file)
 *   - isLoading: Whether video is currently loading
 *   - hasVideo: Boolean indicating if a video is loaded
 *   - mode: The current editor mode (for reference)
 *
 * @example
 * const { url, metadata, hasVideo } = useCurrentVideoState(
 *   editorMode,
 *   { videoUrl, metadata, isLoading },
 *   { overlayVideoUrl, overlayVideoMetadata, isLoadingWorkingVideo, overlayVideoFile },
 *   { annotateVideoUrl, annotateVideoMetadata, annotateVideoFile }
 * );
 *
 * // Use in VideoPlayer without conditionals:
 * <VideoPlayer videoUrl={url} />
 */
export function useCurrentVideoState(
  editorMode,
  framingState,
  overlayState,
  annotateState
) {
  return useMemo(() => {
    switch (editorMode) {
      case 'framing':
        return {
          url: framingState?.videoUrl || null,
          metadata: framingState?.metadata || null,
          file: framingState?.videoFile || null,
          isLoading: framingState?.isLoading || false,
          hasVideo: Boolean(framingState?.videoUrl),
          mode: 'framing',
        };

      case 'overlay':
        return {
          url: overlayState?.overlayVideoUrl || null,
          metadata: overlayState?.overlayVideoMetadata || null,
          file: overlayState?.overlayVideoFile || null,
          isLoading: overlayState?.isLoadingWorkingVideo || false,
          hasVideo: Boolean(overlayState?.overlayVideoUrl),
          mode: 'overlay',
        };

      case 'annotate':
        return {
          url: annotateState?.annotateVideoUrl || null,
          metadata: annotateState?.annotateVideoMetadata || null,
          file: annotateState?.annotateVideoFile || null,
          isLoading: annotateState?.isLoading || false,
          hasVideo: Boolean(annotateState?.annotateVideoUrl),
          mode: 'annotate',
        };

      default:
        return {
          url: null,
          metadata: null,
          file: null,
          isLoading: false,
          hasVideo: false,
          mode: editorMode,
        };
    }
  }, [
    editorMode,
    framingState?.videoUrl,
    framingState?.metadata,
    framingState?.videoFile,
    framingState?.isLoading,
    overlayState?.overlayVideoUrl,
    overlayState?.overlayVideoMetadata,
    overlayState?.overlayVideoFile,
    overlayState?.isLoadingWorkingVideo,
    annotateState?.annotateVideoUrl,
    annotateState?.annotateVideoMetadata,
    annotateState?.annotateVideoFile,
    annotateState?.isLoading,
  ]);
}

/**
 * Helper to check if any mode has a video loaded
 */
export function useHasAnyVideo(editorMode, framingState, overlayState, annotateState) {
  return useMemo(() => {
    return Boolean(
      framingState?.videoUrl ||
      overlayState?.overlayVideoUrl ||
      annotateState?.annotateVideoUrl
    );
  }, [
    framingState?.videoUrl,
    overlayState?.overlayVideoUrl,
    annotateState?.annotateVideoUrl,
  ]);
}

export default useCurrentVideoState;
