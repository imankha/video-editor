import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  });

  // ============================================================================
  // TRANSITIONS: NONE → CREATING
  // ============================================================================

  describe('NONE → CREATING', () => {
    it('startCreating transitions to CREATING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.startCreating());

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.CREATING);
    });

    it('derives isOverlayOpen=true from CREATING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.startCreating());
      expect(result.current.isOverlayOpen).toBe(true);
    });

    it('derives selectedRegionId=null from CREATING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.startCreating());
      expect(result.current.selectedRegionId).toBeNull();
    });

    it('derives isEditMode=false from CREATING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.startCreating());
      expect(result.current.isEditMode).toBe(false);
    });
  });

  // ============================================================================
  // TRANSITIONS: CREATING → NONE (close overlay)
  // ============================================================================

  describe('CREATING → NONE (close overlay)', () => {
    it('closeOverlay transitions from CREATING to NONE', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.startCreating());
      act(() => result.current.closeOverlay());

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.NONE);
      expect(result.current.isOverlayOpen).toBe(false);
    });
  });

  // ============================================================================
  // TRANSITIONS: EDITING + select different clip → EDITING(other)
  // ============================================================================

  describe('EDITING → EDITING (select different clip)', () => {
    it('selectClip while EDITING transitions to EDITING with new clipId', () => {
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
  // CREATING is immune to deselect
  // ============================================================================

  describe('CREATING is immune to deselectClip', () => {
    it('deselectClip is a no-op when CREATING', () => {
      const { result } = renderHook(() => useClipSelection());
      act(() => result.current.startCreating());
      act(() => result.current.deselectClip());

      expect(result.current.selectionState.type).toBe(SELECTION_STATES.CREATING);
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
  // Full scenario: selection survives fullscreen toggle
  // ============================================================================

  describe('fullscreen toggle scenarios', () => {
    it('SELECTED → editClip (enter fullscreen) → closeOverlay (exit fullscreen) → SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());

      // User selects a clip
      act(() => result.current.selectClip('clip_1'));
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);

      // Enter fullscreen → open overlay
      act(() => result.current.editClip('clip_1'));
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.EDITING);
      expect(result.current.isOverlayOpen).toBe(true);

      // Exit fullscreen → close overlay, keep selection
      act(() => result.current.closeOverlay());
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectedRegionId).toBe('clip_1');
      expect(result.current.isOverlayOpen).toBe(false);
    });
  });

  // ============================================================================
  // Full scenario: create clip flow
  // ============================================================================

  describe('create clip flow', () => {
    it('NONE → startCreating → selectClip (after save) → SELECTED', () => {
      const { result } = renderHook(() => useClipSelection());

      // Click "Add Clip" with no selection
      act(() => result.current.startCreating());
      expect(result.current.isOverlayOpen).toBe(true);
      expect(result.current.selectedRegionId).toBeNull();

      // After saving, addClipRegion calls onSelect which calls selectClip
      act(() => result.current.selectClip('new_clip'));
      expect(result.current.selectionState.type).toBe(SELECTION_STATES.SELECTED);
      expect(result.current.selectedRegionId).toBe('new_clip');
      expect(result.current.isOverlayOpen).toBe(false);
    });
  });
});
