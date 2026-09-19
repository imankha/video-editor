import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useClipSelection, SELECTION_STATES } from './useClipSelection';

describe('useClipSelection', () => {
  // ============================================================================
  // INITIAL STATE
  // ============================================================================

  describe('initial state', () => {
    it('starts in NONE state', () => {
      const { result } = renderHook(() => useClipSelection());
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.NONE);
    });

    it('derives null selectedRegionId from NONE', () => {
      const { result } = renderHook(() => useClipSelection());
      expect(result.current.selectedRegionId).toBeNull();
    });

    it('derives isOverlayOpen=false from NONE', () => {
      const { result } = renderHook(() => useClipSelection());
      expect(result.current.isOverlayOpen).toBe(false);
    });

    it('derives isEditMode=false from NONE', () => {
      const { result } = renderHook(() => useClipSelection());
      expect(result.current.isEditMode).toBe(false);
    });
  });

  // ============================================================================
  // T10610: only 3 states exist now — CREATING/startCreating are gone
  // ============================================================================

  describe('T10610: CREATING is retired', () => {
    it('SELECTION_STATES has exactly NONE/SELECTED/EDITING', () => {
      expect(Object.keys(SELECTION_STATES).sort()).toEqual(['EDITING', 'NONE', 'SELECTED']);
    });

    it('startCreating is not exposed on the hook', () => {
      const { result } = renderHook(() => useClipSelection());
      expect(result.current.startCreating).toBeUndefined();
    });
  });

  // ============================================================================
  // TRANSITIONS: NONE → SELECTED
  // ============================================================================

  describe('NONE → SELECTED', () => {
    it('selectClip transitions to SELECTED with clipId', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectionState.clipId).toBe('clip_1');
    });

    it('derives selectedRegionId from SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      expect(result.current.selectedRegionId).toBe('clip_1');
    });

    it('derives isEditMode=true from SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      expect(result.current.isEditMode).toBe(true);
    });

    it('derives isOverlayOpen=false from SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      expect(result.current.isOverlayOpen).toBe(false);
    });
  });

  // ============================================================================
  // TRANSITIONS: SELECTED → NONE (deselect on playhead leave)
  // ============================================================================

  describe('SELECTED → NONE (deselect)', () => {
    it('deselectClip transitions from SELECTED to NONE', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      act(() => result.current.deselectClip());

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.NONE);
      expect(result.current.selectedRegionId).toBeNull();
      expect(result.current.isEditMode).toBe(false);
    });
  });

  // ============================================================================
  // TRANSITIONS: SELECTED → EDITING
  // ============================================================================

  describe('SELECTED → EDITING', () => {
    it('editClip transitions to EDITING with same clipId', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      act(() => result.current.editClip('clip_1'));

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.EDITING);
      expect(result.current.selectionState.clipId).toBe('clip_1');
    });

    it('derives isOverlayOpen=true from EDITING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      act(() => result.current.editClip('clip_1'));
      expect(result.current.isOverlayOpen).toBe(true);
    });

    it('derives selectedRegionId from EDITING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      act(() => result.current.editClip('clip_1'));
      expect(result.current.selectedRegionId).toBe('clip_1');
    });
  });

  // ============================================================================
  // TRANSITIONS: NONE → EDITING directly (T10610 create-at-tap: a play is
  // created + selected atomically via editClip, with no CREATING stopover)
  // ============================================================================

  describe('NONE → EDITING (create-at-tap)', () => {
    it('editClip from NONE goes straight to EDITING with the new clipId', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.editClip('new_clip'));

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.EDITING);
      expect(result.current.selectedRegionId).toBe('new_clip');
      expect(result.current.isOverlayOpen).toBe(true);
    });
  });

  // ============================================================================
  // TRANSITIONS: EDITING → SELECTED (close overlay keeps selection)
  // ============================================================================

  describe('EDITING → SELECTED (close overlay)', () => {
    it('closeOverlay transitions from EDITING to SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      act(() => result.current.editClip('clip_1'));
      act(() => result.current.closeOverlay());

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectionState.clipId).toBe('clip_1');
      expect(result.current.isOverlayOpen).toBe(false);
      expect(result.current.isEditMode).toBe(true);
    });

    it('closeOverlay from EDITING reached via create-at-tap keeps the clip selected (never NONE)', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.editClip('new_clip'));
      act(() => result.current.closeOverlay());

      // T10610 D6: closing never discards. There is no CREATING->NONE branch
      // anymore because the play already exists by the time the editor is open.
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectionState.clipId).toBe('new_clip');
    });
  });

  // ============================================================================
  // TRANSITIONS: EDITING + select different clip → SELECTED(other)
  // ============================================================================

  describe('EDITING → SELECTED (select different clip)', () => {
    it('selectClip while EDITING transitions to SELECTED with new clipId', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.editClip('clip_1'));
      act(() => result.current.selectClip('clip_2'));

      // selectClip from EDITING should go to SELECTED(other), not EDITING(other)
      // The container handles the EDITING+click_other logic
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectionState.clipId).toBe('clip_2');
    });
  });

  // ============================================================================
  // EDITING is immune to deselect (scrub handles)
  // ============================================================================

  describe('EDITING is immune to deselectClip', () => {
    it('deselectClip is a no-op when EDITING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.editClip('clip_1'));
      act(() => result.current.deselectClip());

      // Should stay in EDITING — scrub handles move playhead but shouldn't deselect
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.EDITING);
      expect(result.current.selectionState.clipId).toBe('clip_1');
    });
  });

  // ============================================================================
  // SELECTED → SELECTED (click different clip)
  // ============================================================================

  describe('SELECTED → SELECTED (different clip)', () => {
    it('selectClip with different id changes the selected clip', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.selectClip('clip_1'));
      act(() => result.current.selectClip('clip_2'));

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectionState.clipId).toBe('clip_2');
    });
  });

  // ============================================================================
  // Full scenario: explicit edit open/close preserves selection
  // ============================================================================

  // T10400: editClip() is no longer invoked automatically by entering fullscreen
  // (that auto-open was removed — see AnnotateContainer.handleToggleFullscreen);
  // this exercises the same SELECTED -> EDITING -> SELECTED transitions the way
  // an explicit "Edit play" click / overlay close now drive them.
  describe('explicit edit-open/close scenarios (REQ 8, T10400)', () => {
    it('SELECTED → editClip (Edit play click) → closeOverlay (overlay close) → SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());

      // User selects a clip
      act(() => result.current.selectClip('clip_1'));
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);

      // Explicit "Edit play" click → open overlay
      act(() => result.current.editClip('clip_1'));
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.EDITING);
      expect(result.current.isOverlayOpen).toBe(true);

      // Close overlay → keep selection
      act(() => result.current.closeOverlay());
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectedRegionId).toBe('clip_1');
      expect(result.current.isOverlayOpen).toBe(false);
    });
  });

  // ============================================================================
  // Full scenario: create-at-tap flow (T10610 replaces the old CREATING flow —
  // the region+row are created BEFORE the editor opens, so editClip lands
  // straight on EDITING; there is no intermediate "no clipId yet" state)
  // ============================================================================

  describe('create-at-tap flow (T10610)', () => {
    it('NONE → editClip(newRegionId) lands directly on EDITING, never NONE/CREATING', () => {
      const { result } = renderHook(() => useClipSelection());

      // Mark play tap: the container creates the region+row synchronously, then
      // calls editClip(newRegion.id) via addClipRegion's onCreateSelect wiring.
      act(() => result.current.editClip('new_clip'));

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.EDITING);
      expect(result.current.isOverlayOpen).toBe(true);
      expect(result.current.selectedRegionId).toBe('new_clip');
    });
  });
});
