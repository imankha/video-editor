import { useState, useCallback, useRef } from 'react';

/**
 * Selection state types for the clip selection state machine.
 *
 * NONE      — no clip selected
 * SELECTED  — clip highlighted in sidebar, "Edit Clip" button visible
 * EDITING   — overlay open for existing clip (immune to playhead deselect)
 * CREATING  — overlay open for new clip, no clipId (immune to playhead deselect)
 */
export const SELECTION_STATES = {
  NONE: 'NONE',
  SELECTED: 'SELECTED',
  EDITING: 'EDITING',
  CREATING: 'CREATING',
};

/**
 * useClipSelection — Single source of truth for clip selection and overlay state.
 *
 * Replaces the scattered state that was previously split across:
 * - selectedRegionId (useAnnotate)
 * - showAnnotateOverlay (useAnnotateState)
 * - isEditMode (computed in AnnotateModeView)
 *
 * State shape:
 *   { type: 'NONE' }
 *   { type: 'SELECTED', clipId: string }
 *   { type: 'EDITING', clipId: string }
 *   { type: 'CREATING' }
 */
export function useClipSelection() {
  const [state, setState] = useState({ type: SELECTION_STATES.NONE });

  // Scrub lock: when true, auto-deselect is suppressed (sidebar scrub in progress)
  const scrubLockedRef = useRef(false);
  const lockScrub = useCallback(() => { scrubLockedRef.current = true; }, []);
  const unlockScrub = useCallback(() => { scrubLockedRef.current = false; }, []);

  const selectClip = useCallback((clipId) => {
    setState({ type: SELECTION_STATES.SELECTED, clipId });
  }, []);

  const editClip = useCallback((clipId) => {
    setState({ type: SELECTION_STATES.EDITING, clipId });
  }, []);

  const startCreating = useCallback(() => {
    setState({ type: SELECTION_STATES.CREATING });
  }, []);

  const closeOverlay = useCallback(() => {
    setState(prev => {
      if (prev.type === SELECTION_STATES.EDITING) {
        return { type: SELECTION_STATES.SELECTED, clipId: prev.clipId };
      }
      if (prev.type === SELECTION_STATES.CREATING) {
        return { type: SELECTION_STATES.NONE };
      }
      return prev;
    });
  }, []);

  const deselectClip = useCallback(() => {
    setState(prev => {
      // EDITING and CREATING are immune to deselect (scrub handles, overlay open)
      if (prev.type === SELECTION_STATES.EDITING || prev.type === SELECTION_STATES.CREATING) {
        return prev;
      }
      return { type: SELECTION_STATES.NONE };
    });
  }, []);

  // Derived values
  const selectedRegionId = (state.type === SELECTION_STATES.SELECTED || state.type === SELECTION_STATES.EDITING)
    ? state.clipId
    : null;

  const isOverlayOpen = state.type === SELECTION_STATES.EDITING || state.type === SELECTION_STATES.CREATING;

  const isEditMode = state.type === SELECTION_STATES.SELECTED;

  return {
    selectionState: state,
    selectClip,
    editClip,
    startCreating,
    closeOverlay,
    deselectClip,
    selectedRegionId,
    isOverlayOpen,
    isEditMode,
    scrubLockedRef,
    lockScrub,
    unlockScrub,
  };
}
