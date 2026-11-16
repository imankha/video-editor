import { useEffect } from 'react';

// Shift+arrow seek amount (seconds)
export const ARROW_SEEK_SECONDS = 4;

/**
 * useKeyboardShortcuts - the one keyboard handler for Frame and Spotlight
 *
 * Handles:
 * - Space bar: Toggle play/pause
 * - Arrow keys: step one frame; Shift+arrow seeks ARROW_SEEK_SECONDS (T4570).
 *   On Frame's crop layer a plain arrow jumps between crop keyframes instead.
 * - Ctrl/Cmd+C / Ctrl/Cmd+V: copy/paste the crop keyframe (Frame only: active
 *   when onCopyCrop is passed)
 *
 * Spotlight passes only the video controls; Frame also passes its crop props.
 */
export function useKeyboardShortcuts({
  // Video state
  hasVideo,
  togglePlay,
  stepForward,
  stepBackward,
  seekForward,
  seekBackward,
  seek,

  // Frame crop layer (Spotlight omits these)
  selectedLayer,
  copiedCrop,
  onCopyCrop,
  onPasteCrop,
  keyframes = [],
  framerate,
  selectedCropKeyframeIndex = null,

  // T6980: true while the user is typing in an inline text editor (canvas
  // transparent <input> or the Text-tab panel input). Suppresses Space, copy/
  // paste, and arrow navigation so keystrokes stay in the field.
  isTextEditing = false,
}) {
  // Space bar: Toggle play/pause
  useEffect(() => {
    const handleKeyDown = (event) => {
      // T6980: never toggle play while inline text-editing.
      if (isTextEditing) return;

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
  }, [hasVideo, togglePlay, isTextEditing]);

  // Ctrl+C/V: Copy/paste crop keyframe (Frame only)
  useEffect(() => {
    if (!onCopyCrop) return undefined;

    const handleKeyDown = (event) => {
      // T6980: never copy/paste crop while inline text-editing.
      if (isTextEditing) return;
      if (!hasVideo) return;

      // Ctrl+C or Cmd+C (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyC') {
        // Only prevent default if no text is selected
        if (window.getSelection().toString().length === 0) {
          event.preventDefault();
          onCopyCrop();
        }
      }

      // Ctrl+V or Cmd+V (Mac)
      if ((event.ctrlKey || event.metaKey) && event.code === 'KeyV') {
        if (copiedCrop) {
          event.preventDefault();
          onPasteCrop();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasVideo, copiedCrop, onCopyCrop, onPasteCrop, isTextEditing]);

  // Arrow keys: step a frame, Shift seeks, crop layer jumps keyframes
  useEffect(() => {
    const handleArrowKeys = (event) => {
      // T6980: never seek/navigate while inline text-editing.
      if (isTextEditing) return;
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;

      // Don't handle if modifier keys are pressed
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // Don't handle if typing in an input or textarea
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') return;

      if (!hasVideo) return;
      event.preventDefault();

      const isLeft = event.code === 'ArrowLeft';

      if (event.shiftKey) {
        if (isLeft) {
          seekBackward(ARROW_SEEK_SECONDS);
        } else {
          seekForward(ARROW_SEEK_SECONDS);
        }
        return;
      }

      if (selectedLayer === 'crop') {
        if (keyframes.length === 0) return;

        let targetIndex;
        if (selectedCropKeyframeIndex === null) {
          targetIndex = isLeft ? keyframes.length - 1 : 0;
        } else {
          targetIndex = selectedCropKeyframeIndex + (isLeft ? -1 : 1);
          targetIndex = Math.max(0, Math.min(targetIndex, keyframes.length - 1));
        }

        if (targetIndex !== selectedCropKeyframeIndex) {
          seek(keyframes[targetIndex].frame / framerate);
        }
        return;
      }

      if (isLeft) {
        stepBackward();
      } else {
        stepForward();
      }
    };

    document.addEventListener('keydown', handleArrowKeys);
    return () => document.removeEventListener('keydown', handleArrowKeys);
  }, [
    hasVideo,
    selectedLayer,
    selectedCropKeyframeIndex,
    keyframes,
    framerate,
    stepForward,
    stepBackward,
    seekForward,
    seekBackward,
    seek,
    isTextEditing,
  ]);
}

export default useKeyboardShortcuts;
