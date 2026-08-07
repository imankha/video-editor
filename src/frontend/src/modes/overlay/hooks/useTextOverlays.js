import { useCallback, useMemo, useState } from 'react';
import { pickDefaultPreset } from '../../../constants/textPositionPresets';

/**
 * useTextOverlays -- manages Overlay text REGIONS, each containing N ELEMENTS
 * (T6630 round 4 model reframe; T5225 design SS1, SS5.1 for the original
 * single-element shape this replaces).
 *
 * MODEL (user direction, 2026-08-07): "Adding a text element is not adding a
 * text region. A text region can have multiple text elements." A REGION is a
 * time span; it CONTAINS N elements that all render SIMULTANEOUSLY during the
 * region's `[startTime, endTime)` window (half-open at burn-in, design O6).
 * The OLD model was "one block = one time span = one element", so two
 * elements added at different times could never render together.
 *
 * DATA MODEL: `{ id, startTime, endTime, elements: [{ id, spec: TextSpec,
 * enabled }, ...] }`. A region always has >=1 element while it exists --
 * deleting the last element deletes the region too (no empty-region records).
 *
 * Every mutating method RETURNS the updated/new/removed entity -- NEVER
 * relies on a same-tick re-read of `textOverlays` -- mirroring the T5644 fix
 * (OverlayScreen's wrapped handlers read the gesture's own return value to
 * dispatch the surgical POST, since React state updates are not synchronously
 * visible in the same closure).
 */

const DEFAULT_TEXT_DURATION = 2.0; // seconds
const MIN_TEXT_DURATION = 0.3; // seconds -- an edge can't cross its partner

function generateRegionId() {
  return `txt_${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}
function generateElementId() {
  return `el_${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export default function useTextOverlays() {
  const [textOverlays, setTextOverlays] = useState([]); // REGIONS
  const [duration, setDurationState] = useState(null);
  const [selectedRegionId, setSelectedRegionId] = useState(null);
  const [selectedElementId, setSelectedElementId] = useState(null);

  const initializeWithDuration = useCallback((videoDuration) => {
    setDurationState(videoDuration);
  }, []);

  // T6630 round 4: select a region AND (unless elementId names one already in
  // it) auto-select its first element -- the Text tab always has a concrete
  // element to show settings for the moment a region is selected (design:
  // "selecting a region exposes all of its elements... selecting an element
  // exposes its settings").
  const selectRegion = useCallback((regionId, elementId = null) => {
    setSelectedRegionId(regionId);
    if (!regionId) {
      setSelectedElementId(null);
      return;
    }
    const region = textOverlays.find((r) => r.id === regionId);
    if (elementId && region?.elements.some((el) => el.id === elementId)) {
      setSelectedElementId(elementId);
    } else {
      setSelectedElementId(region?.elements[0]?.id ?? null);
    }
  }, [textOverlays]);

  const selectElement = useCallback((elementId) => {
    if (!elementId) {
      setSelectedElementId(null);
      return;
    }
    const region = textOverlays.find((r) => r.elements.some((el) => el.id === elementId));
    setSelectedRegionId(region?.id ?? null);
    setSelectedElementId(elementId);
  }, [textOverlays]);

  // Creates a NEW REGION with exactly one starter element. `spec.position`/
  // `spec.align` are overridden with a DEFAULT PRESET (round 4 item 2: a new
  // element must never spawn as "Custom position" -- the user must see text
  // on screen immediately). A fresh region has no siblings, so this is always
  // bottom-center (pickDefaultPreset's top priority).
  const addRegion = useCallback((clickTime, spec) => {
    const startTime = Math.max(0, clickTime);
    const endTime = duration != null
      ? Math.min(duration, startTime + DEFAULT_TEXT_DURATION)
      : startTime + DEFAULT_TEXT_DURATION;

    const preset = pickDefaultPreset([]);
    const elementSpec = { ...spec, position: { x: preset.x, y: preset.y }, align: preset.align };
    const element = { id: generateElementId(), spec: elementSpec, enabled: true };
    const newRegion = {
      id: generateRegionId(),
      startTime,
      endTime: Math.max(endTime, startTime + MIN_TEXT_DURATION),
      elements: [element],
    };

    setTextOverlays(prev => [...prev, newRegion]);
    return newRegion;
  }, [duration]);

  // Appends a NEW ELEMENT into an EXISTING region -- the region's timing is
  // untouched, and NO sibling element's spec/enabled is ever read-modified
  // (only the new element is added to the array; every existing element
  // object is carried over by reference, unchanged).
  const addElement = useCallback((regionId, spec) => {
    const region = textOverlays.find(r => r.id === regionId);
    if (!region) return null;

    const preset = pickDefaultPreset(region.elements.map(el => el.spec));
    const elementSpec = { ...spec, position: { x: preset.x, y: preset.y }, align: preset.align };
    const newElement = { id: generateElementId(), spec: elementSpec, enabled: true };

    const updatedRegion = { ...region, elements: [...region.elements, newElement] };
    setTextOverlays(prev => prev.map(r => (r.id === regionId ? updatedRegion : r)));
    return { ...newElement, regionId };
  }, [textOverlays]);

  // NOTE: every mutating method below computes the resulting entity from the
  // CURRENT `textOverlays` closure value BEFORE calling setTextOverlays, and
  // returns that already-known value directly -- never from inside a
  // functional setState updater (T5644 fix, see module docstring).

  const moveRegionStart = useCallback((id, newStartTime) => {
    const target = textOverlays.find(r => r.id === id);
    if (!target) return null;
    const clampedStart = Math.max(
      0,
      Math.min(newStartTime, target.endTime - MIN_TEXT_DURATION)
    );
    const updated = { ...target, startTime: clampedStart };
    setTextOverlays(prev => prev.map(r => (r.id === id ? updated : r)));
    return updated;
  }, [textOverlays]);

  const moveRegionEnd = useCallback((id, newEndTime) => {
    const target = textOverlays.find(r => r.id === id);
    if (!target) return null;
    const maxEnd = duration != null ? duration : Infinity;
    const clampedEnd = Math.min(
      maxEnd,
      Math.max(newEndTime, target.startTime + MIN_TEXT_DURATION)
    );
    const updated = { ...target, endTime: clampedEnd };
    setTextOverlays(prev => prev.map(r => (r.id === id ? updated : r)));
    return updated;
  }, [textOverlays, duration]);

  // T6610 (unchanged semantics, now operates on the REGION): move the WHOLE
  // region in time -- start and end shift together, so duration is preserved.
  const moveRegionBlock = useCallback((id, newStartTime) => {
    const target = textOverlays.find(r => r.id === id);
    if (!target) return null;
    const blockDuration = target.endTime - target.startTime;
    const maxStart = (duration != null ? duration : Infinity) - blockDuration;
    const clampedStart = Math.max(0, Math.min(newStartTime, Math.max(0, maxStart)));
    const updated = { ...target, startTime: clampedStart, endTime: clampedStart + blockDuration };
    setTextOverlays(prev => prev.map(r => (r.id === id ? updated : r)));
    return updated;
  }, [textOverlays, duration]);

  // Replaces ONE element's whole spec. Finds the element's parent region by
  // searching (elements are nested); only that element's spec changes --
  // every sibling element and the region's own timing are untouched.
  const updateElementSpec = useCallback((elementId, nextSpec) => {
    const region = textOverlays.find(r => r.elements.some(el => el.id === elementId));
    if (!region) return null;
    const updatedElements = region.elements.map(el => (el.id === elementId ? { ...el, spec: nextSpec } : el));
    const updatedRegion = { ...region, elements: updatedElements };
    setTextOverlays(prev => prev.map(r => (r.id === region.id ? updatedRegion : r)));
    return { id: elementId, spec: nextSpec, regionId: region.id };
  }, [textOverlays]);

  const toggleElement = useCallback((elementId, enabled) => {
    const region = textOverlays.find(r => r.elements.some(el => el.id === elementId));
    if (!region) return null;
    const updatedElements = region.elements.map(el => (el.id === elementId ? { ...el, enabled } : el));
    const updatedRegion = { ...region, elements: updatedElements };
    setTextOverlays(prev => prev.map(r => (r.id === region.id ? updatedRegion : r)));
    return { id: elementId, enabled, regionId: region.id };
  }, [textOverlays]);

  // Deletes ONE element. A region always has >=1 element while it exists, so
  // deleting the LAST element of a region deletes the region too (mirrors the
  // backend's delete_text branch exactly).
  const deleteElement = useCallback((elementId) => {
    const region = textOverlays.find(r => r.elements.some(el => el.id === elementId));
    if (!region) return null;
    const removed = region.elements.find(el => el.id === elementId);
    const remainingElements = region.elements.filter(el => el.id !== elementId);

    if (remainingElements.length === 0) {
      setTextOverlays(prev => prev.filter(r => r.id !== region.id));
      if (selectedRegionId === region.id) {
        setSelectedRegionId(null);
        setSelectedElementId(null);
      }
    } else {
      const updatedRegion = { ...region, elements: remainingElements };
      setTextOverlays(prev => prev.map(r => (r.id === region.id ? updatedRegion : r)));
      if (selectedElementId === elementId) {
        setSelectedElementId(remainingElements[0].id);
      }
    }
    return { ...removed, regionId: region.id };
  }, [textOverlays, selectedRegionId, selectedElementId]);

  // Deletes a REGION and every element inside it in one gesture (the
  // timeline lane's keyboard Delete/Backspace on the focused region uses
  // this -- one user gesture, one surgical write, not N per-element deletes).
  const deleteRegion = useCallback((regionId) => {
    const found = textOverlays.find(r => r.id === regionId);
    if (!found) return null;
    setTextOverlays(prev => prev.filter(r => r.id !== regionId));
    if (selectedRegionId === regionId) {
      setSelectedRegionId(null);
      setSelectedElementId(null);
    }
    return found;
  }, [textOverlays, selectedRegionId]);

  /**
   * restoreTextOverlays -- read-only hydration from the backend-shaped
   * `text_overlays` array (design SS5.1: restore is read-only, no
   * write-back). The backend already stores REGIONS (profile_db v039
   * migration + every write path since), so this hook does NOT shape-guess
   * or transform -- it trusts the array 1:1. Callers must gate any surgical
   * dispatch on the sync-state machine (overlaySyncState==='ready') exactly
   * like useHighlightRegions.restoreRegions -- this hook has no opinion on
   * that; it only sets local state.
   */
  const restoreTextOverlays = useCallback((saved, videoDuration) => {
    setTextOverlays((saved || []).map(region => ({
      ...region,
      elements: (region.elements || []).map(el => ({ ...el })),
    })));
    if (videoDuration != null) {
      setDurationState(videoDuration);
    }
  }, []);

  const reset = useCallback(() => {
    setTextOverlays([]);
    setSelectedRegionId(null);
    setSelectedElementId(null);
  }, []);

  /**
   * Derived: regions with visual layout info for TextLayer (mirrors
   * useHighlightRegions.regionsWithLayout exactly -- index +
   * visualStartPercent/visualWidthPercent computed here, not in the view).
   */
  const textOverlaysWithLayout = useMemo(() => {
    if (!duration) return [];
    return textOverlays.map((region, index) => ({
      ...region,
      index,
      visualStartPercent: (region.startTime / duration) * 100,
      visualWidthPercent: ((region.endTime - region.startTime) / duration) * 100,
    }));
  }, [textOverlays, duration]);

  return {
    textOverlays,
    textOverlaysWithLayout,
    duration,
    selectedRegionId,
    selectedElementId,
    selectRegion,
    selectElement,
    initializeWithDuration,
    addRegion,
    addElement,
    moveRegionStart,
    moveRegionEnd,
    moveRegionBlock,
    updateElementSpec,
    toggleElement,
    deleteElement,
    deleteRegion,
    restoreTextOverlays,
    reset,
  };
}
