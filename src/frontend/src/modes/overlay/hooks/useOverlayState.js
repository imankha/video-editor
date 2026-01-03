import { useState, useCallback, useRef } from 'react';
import { extractVideoMetadataFromUrl } from '../../../utils/videoMetadata';

/**
 * useOverlayState - Consolidates overlay mode state management
 *
 * This hook manages:
 * - Overlay video file and URL
 * - Overlay video metadata
 * - Clip metadata from framing export
 * - Drag state for highlight interactions
 * - Selected keyframe time
 * - Loading state
 * - Effect type setting
 *
 * This reduces prop drilling from App.jsx and keeps overlay-specific
 * state together in one place.
 */

const DEFAULT_EFFECT_TYPE = 'original';

export default function useOverlayState() {
  // Video state
  const [overlayVideoFile, setOverlayVideoFile] = useState(null);
  const [overlayVideoUrl, setOverlayVideoUrl] = useState(null);
  const [overlayVideoMetadata, setOverlayVideoMetadata] = useState(null);

  // Clip metadata for auto-generating highlight regions (from Framing export)
  const [overlayClipMetadata, setOverlayClipMetadata] = useState(null);

  // Temporary drag state for live preview during highlight drag/resize
  const [dragHighlight, setDragHighlight] = useState(null);

  // Selected highlight keyframe time (when playhead is near a keyframe)
  const [selectedHighlightKeyframeTime, setSelectedHighlightKeyframeTime] = useState(null);

  // Working video loading state
  const [isLoadingWorkingVideo, setIsLoadingWorkingVideo] = useState(false);

  // Highlight effect type - controls both client-side preview and export
  // 'brightness_boost' | 'original' | 'dark_overlay'
  const [highlightEffectType, setHighlightEffectType] = useState(DEFAULT_EFFECT_TYPE);

  // Overlay persistence refs
  const pendingOverlaySaveRef = useRef(null);
  const overlayDataLoadedRef = useRef(false);

  /**
   * Load overlay video from a URL (e.g., from framing export or working video)
   */
  const loadOverlayVideoFromUrl = useCallback(async (url, clipMetadata = null) => {
    setIsLoadingWorkingVideo(true);
    setOverlayVideoUrl(url);
    setOverlayClipMetadata(clipMetadata);
    setOverlayVideoFile(null); // Clear file when loading from URL

    try {
      const metadata = await extractVideoMetadataFromUrl(url);
      setOverlayVideoMetadata(metadata);
      return metadata;
    } catch (error) {
      console.error('[useOverlayState] Error extracting metadata:', error);
      throw error;
    } finally {
      setIsLoadingWorkingVideo(false);
    }
  }, []);

  /**
   * Load overlay video from a file upload
   */
  const loadOverlayVideoFromFile = useCallback(async (file) => {
    setIsLoadingWorkingVideo(true);
    setOverlayVideoFile(file);
    setOverlayClipMetadata(null); // Clear clip metadata for fresh uploads

    const url = URL.createObjectURL(file);
    setOverlayVideoUrl(url);

    try {
      const metadata = await extractVideoMetadataFromUrl(url);
      setOverlayVideoMetadata(metadata);
      return metadata;
    } catch (error) {
      console.error('[useOverlayState] Error extracting metadata:', error);
      // Clean up URL on error
      URL.revokeObjectURL(url);
      setOverlayVideoUrl(null);
      throw error;
    } finally {
      setIsLoadingWorkingVideo(false);
    }
  }, []);

  /**
   * Clear all overlay state
   */
  const resetOverlayState = useCallback(() => {
    // Revoke object URL if it was created from a file
    if (overlayVideoUrl && overlayVideoFile) {
      URL.revokeObjectURL(overlayVideoUrl);
    }

    setOverlayVideoFile(null);
    setOverlayVideoUrl(null);
    setOverlayVideoMetadata(null);
    setOverlayClipMetadata(null);
    setDragHighlight(null);
    setSelectedHighlightKeyframeTime(null);
    setIsLoadingWorkingVideo(false);
    setHighlightEffectType(DEFAULT_EFFECT_TYPE);

    // Reset refs
    pendingOverlaySaveRef.current = null;
    overlayDataLoadedRef.current = false;
  }, [overlayVideoUrl, overlayVideoFile]);

  /**
   * Check if overlay has a video loaded (either from file or URL)
   */
  const hasOverlayVideo = Boolean(overlayVideoUrl);

  /**
   * Check if overlay video is from framing export (has clip metadata)
   */
  const isFromFramingExport = Boolean(overlayClipMetadata);

  return {
    // Video state
    overlayVideoFile,
    overlayVideoUrl,
    overlayVideoMetadata,
    overlayClipMetadata,
    isLoadingWorkingVideo,
    hasOverlayVideo,
    isFromFramingExport,

    // Video state setters (for external use like project loading)
    setOverlayVideoUrl,
    setOverlayVideoMetadata,
    setOverlayClipMetadata,
    setIsLoadingWorkingVideo,

    // Highlight interaction state
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,

    // Effect type
    highlightEffectType,
    setHighlightEffectType,

    // Persistence refs
    pendingOverlaySaveRef,
    overlayDataLoadedRef,

    // Actions
    loadOverlayVideoFromUrl,
    loadOverlayVideoFromFile,
    resetOverlayState,
  };
}
