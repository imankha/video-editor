import { useState } from 'react';

/**
 * useOverlayState - Spotlight screen interaction and sync state
 *
 * This hook manages:
 * - Drag state for highlight interactions
 * - Selected keyframe time
 * - The overlay data sync state machine
 */

export default function useOverlayState() {
  // Temporary drag state for live preview during highlight drag/resize
  const [dragHighlight, setDragHighlight] = useState(null);

  // Selected highlight keyframe time (when playhead is near a keyframe)
  const [selectedHighlightKeyframeTime, setSelectedHighlightKeyframeTime] = useState(null);

  // ===========================================
  // OVERLAY DATA SYNC STATE MACHINE
  // ===========================================
  // States: 'idle' | 'loading' | 'ready' | 'error'
  // - idle: No data loaded, waiting for projectId
  // - loading: Fetching overlay data from backend
  // - ready: Data loaded, actions will sync to backend
  // - error: Load failed
  const [overlaySyncState, setOverlaySyncState] = useState('idle');

  // Track which projectId we've loaded data for (null = not loaded)
  const [overlayLoadedProjectId, setOverlayLoadedProjectId] = useState(null);

  return {
    // Highlight interaction state
    dragHighlight,
    setDragHighlight,
    selectedHighlightKeyframeTime,
    setSelectedHighlightKeyframeTime,

    // Sync state machine (replaces refs for reactive behavior)
    overlaySyncState,
    setOverlaySyncState,
    overlayLoadedProjectId,
    setOverlayLoadedProjectId,
  };
}
