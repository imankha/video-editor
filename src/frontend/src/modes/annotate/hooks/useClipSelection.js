import { useState, useCallback, useRef } from 'react';

/**
 * Selection state types for the clip selection state machine.
 *
 * NONE      — no clip selected
 * SELECTED  — clip highlighted in sidebar, "Edit Clip" button visible
 * EDITING   — overlay open for a clip (immune to playhead deselect). T10610:
 *             this is the ONLY editor state — a play is created at the Mark
 *             Play tap, so the editor never opens on a clip that doesn't
 *             exist yet (the old CREATING state had no other purpose).
 */
export const SELECTION_STATES = {
  NONE: 'NONE',
  SELECTED: 'SELECTED',
  EDITING: 'EDITING',
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

  const closeOverlay = useCallback(() => {
    setState(prev => {
      if (prev.type === SELECTION_STATES.EDITING) {
        return { type: SELECTION_STATES.SELECTED, clipId: prev.clipId };
      }
      return prev;
    });
  }, []);

  const deselectClip = useCallback(() => {
    setState(prev => {
      // EDITING is immune to deselect (overlay open, scrub handles live)
      if (prev.type === SELECTION_STATES.EDITING) {
        return prev;
      }
      return { type: SELECTION_STATES.NONE };
    });
  }, []);

  // Derived values
  const selectedRegionId = (state.type === SELECTION_STATES.SELECTED || state.type === SELECTION_STATES.EDITING)
    ? state.clipId
    : null;

  const isOverlayOpen = state.type === SELECTION_STATES.EDITING;

  const isEditMode = state.type === SELECTION_STATES.SELECTED;

  return {
    selectionState: state,
    selectClip,
    editClip,
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
