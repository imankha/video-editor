import { useEffect } from 'react';

/**
 * useKeyboardShortcuts - Consolidated keyboard handler for video editor
 *
 * Handles:
 * - Space bar: Toggle play/pause
 * - Ctrl/Cmd+C: Copy crop keyframe at current time
 * - Ctrl/Cmd+V: Paste crop keyframe at current time
 * - Arrow keys: Layer-specific navigation (playhead, crop, highlight, clips)
 *
 * @param {Object} params - All required dependencies
 * @see APP_REFACTOR_PLAN.md Task 2.1 for refactoring context
 */
export function useKeyboardShortcuts({
  // Video state
  hasVideo,
  togglePlay,
  stepForward,
  stepBackward,
  seek,

  // Mode state
  editorMode,
  selectedLayer,

  // Copy/paste crop
  copiedCrop,
  onCopyCrop,
  onPasteCrop,

  // Keyframe navigation
  keyframes = [],
  framerate = 30,
  selectedCropKeyframeIndex,

  // Highlight navigation
  highlightKeyframes = [],
  highlightFramerate = 30,
  selectedHighlightKeyframeIndex,
  isHighlightEnabled = false,

  // Annotate mode
  annotateVideoUrl,
  annotateSelectedLayer,
  clipRegions = [],
  annotateSelectedRegionId,
  selectAnnotateRegion,
}) {
  // Space bar: Toggle play/pause
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle if typing in an input or textarea
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      if (event.code === 'Space' && hasVideo) {
        event.preventDefault();
        togglePlay();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasVideo, togglePlay]);

  // Ctrl+C/V: Copy/paste crop keyframe
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!hasVideo) return;

      // Ctrl+C or Cmd+C (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
        // Only prevent default if no text is selected
        if (window.getSelection().toString().length === 0) {
          event.preventDefault();
          onCopyCrop?.();
        }
      }

      // Ctrl+V or Cmd+V (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
        if (copiedCrop) {
          event.preventDefault();
          onPasteCrop?.();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasVideo, copiedCrop, onCopyCrop, onPasteCrop]);

  // Arrow keys: Layer-specific navigation
  useEffect(() => {
    const handleArrowKeys = (event) => {
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;

      // Don't handle if modifier keys are pressed
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Handle annotate mode
      if (editorMode === 'annotate' && annotateVideoUrl) {
        event.preventDefault();
        const isLeft = event.code === 'ArrowLeft';

        // Playhead layer: step frames
        if (annotateSelectedLayer === 'playhead') {
          if (isLeft) {
            stepBackward();
          } else {
            stepForward();
          }
          return;
        }

        // Clips layer: navigate between annotated clips
        if (clipRegions.length > 0) {
          const sortedRegions = [...clipRegions].sort((a, b) => a.startTime - b.startTime);

          let currentIndex = sortedRegions.findIndex(r => r.id === annotateSelectedRegionId);
          if (currentIndex === -1) {
            currentIndex = isLeft ? sortedRegions.length : -1;
          }

          const targetIndex = isLeft
            ? Math.max(0, currentIndex - 1)
            : Math.min(sortedRegions.length - 1, currentIndex + 1);

          if (targetIndex !== currentIndex || currentIndex === -1) {
            const targetRegion = sortedRegions[targetIndex];
            selectAnnotateRegion?.(targetRegion.id);
            seek(targetRegion.startTime);
          }
        }
        return;
      }

      // Framing/overlay mode
      if (!hasVideo) return;
      event.preventDefault();

      const isLeft = event.code === 'ArrowLeft';
      const direction = isLeft ? -1 : 1;

      switch (selectedLayer) {
        case 'playhead': {
          if (isLeft) {
            stepBackward();
          } else {
            stepForward();
          }
          break;
        }

        case 'crop': {
          if (keyframes.length === 0) break;

          let targetIndex;
          if (selectedCropKeyframeIndex === null) {
            targetIndex = isLeft ? keyframes.length - 1 : 0;
          } else {
            targetIndex = selectedCropKeyframeIndex + direction;
            targetIndex = Math.max(0, Math.min(targetIndex, keyframes.length - 1));
          }

          if (targetIndex !== selectedCropKeyframeIndex) {
            const keyframe = keyframes[targetIndex];
            const keyframeTime = keyframe.frame / framerate;
            seek(keyframeTime);
          }
          break;
        }

        case 'highlight': {
          if (highlightKeyframes.length === 0 || !isHighlightEnabled) break;

          let targetIndex;
          if (selectedHighlightKeyframeIndex === null) {
            targetIndex = isLeft ? highlightKeyframes.length - 1 : 0;
          } else {
            targetIndex = selectedHighlightKeyframeIndex + direction;
            targetIndex = Math.max(0, Math.min(targetIndex, highlightKeyframes.length - 1));
          }

          if (targetIndex !== selectedHighlightKeyframeIndex) {
            const keyframe = highlightKeyframes[targetIndex];
            const keyframeTime = keyframe.frame / highlightFramerate;
            seek(keyframeTime);
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleArrowKeys);
    return () => document.removeEventListener('keydown', handleArrowKeys);
  }, [
    hasVideo,
    selectedLayer,
    selectedCropKeyframeIndex,
    selectedHighlightKeyframeIndex,
    keyframes,
    highlightKeyframes,
    framerate,
    highlightFramerate,
    isHighlightEnabled,
    stepForward,
    stepBackward,
    seek,
    editorMode,
    annotateVideoUrl,
    clipRegions,
    annotateSelectedRegionId,
    selectAnnotateRegion,
    annotateSelectedLayer,
  ]);
}

export default useKeyboardShortcuts;
