import { useCallback, useMemo, useState } from 'react';

/**
 * useTextOverlays -- manages Overlay text blocks as self-contained units
 * (T5225 design SS1, SS5.1).
 *
 * DATA MODEL (design SS1.1): { id, spec: TextSpec, startTime, endTime, enabled }
 * Times are on the WORKING-VIDEO (concatenated) timeline, half-open
 * `[startTime, endTime)` at burn-in (design O6).
 *
 * Every mutating method RETURNS the updated/new/removed entity -- NEVER relies
 * on a same-tick re-read of `textOverlays` -- mirroring the T5644 fix for
 * `useHighlightRegions.addRegion` (OverlayScreen.jsx's wrapped handlers read
 * the gesture's own return value to dispatch the surgical POST, since React
 * state updates are not synchronously visible in the same closure).
 */

const DEFAULT_TEXT_DURATION = 2.0; // seconds
const MIN_TEXT_DURATION = 0.3; // seconds -- an edge can't cross its partner

function generateTextId() {
  return `txt_${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

export default function useTextOverlays() {
  const [textOverlays, setTextOverlays] = useState([]);
  const [duration, setDurationState] = useState(null);
  const [selectedTextId, setSelectedTextId] = useState(null);

  const initializeWithDuration = useCallback((videoDuration) => {
    setDurationState(videoDuration);
  }, []);

  const addText = useCallback((clickTime, spec) => {
    const startTime = Math.max(0, clickTime);
    const endTime = duration != null
      ? Math.min(duration, startTime + DEFAULT_TEXT_DURATION)
      : startTime + DEFAULT_TEXT_DURATION;

    const newBlock = {
      id: generateTextId(),
      spec,
      startTime,
      endTime: Math.max(endTime, startTime + MIN_TEXT_DURATION),
      enabled: true,
    };

    setTextOverlays(prev => [...prev, newBlock]);
    return newBlock;
  }, [duration]);

  // NOTE: every mutating method below computes the resulting entity from the
  // CURRENT `textOverlays` closure value BEFORE calling setTextOverlays, and
  // returns that already-known value directly -- never from inside a
  // functional setState updater. React 18 does not run a functional updater
  // synchronously at call time (it's deferred to the render phase), so
  // capturing a return value via a `let` closed over by the updater is
  // unreliable and previously returned null. Computing eagerly and passing
  // the finished array/value to setState sidesteps this entirely.

  const moveTextStart = useCallback((id, newStartTime) => {
    const target = textOverlays.find(block => block.id === id);
    if (!target) return null;
    const clampedStart = Math.max(
      0,
      Math.min(newStartTime, target.endTime - MIN_TEXT_DURATION)
    );
    const updated = { ...target, startTime: clampedStart };
    setTextOverlays(prev => prev.map(block => (block.id === id ? updated : block)));
    return updated;
  }, [textOverlays]);

  const moveTextEnd = useCallback((id, newEndTime) => {
    const target = textOverlays.find(block => block.id === id);
    if (!target) return null;
    const maxEnd = duration != null ? duration : Infinity;
    const clampedEnd = Math.min(
      maxEnd,
      Math.max(newEndTime, target.startTime + MIN_TEXT_DURATION)
    );
    const updated = { ...target, endTime: clampedEnd };
    setTextOverlays(prev => prev.map(block => (block.id === id ? updated : block)));
    return updated;
  }, [textOverlays, duration]);

  // T6610: move the WHOLE block in time -- start and end shift together, so the
  // block's DURATION is preserved (unlike moveTextStart/moveTextEnd, which move a
  // single edge and thus resize). `newStartTime` is the desired new start (the
  // body-drag caller has already applied leading-edge boundary snapping); we only
  // clamp the block inside [0, duration] here so it can't be dragged off the reel.
  // Returns the updated entity (same contract as the edge movers) so the wrapped
  // handler can fire ONE surgical persist on drag end from the return value.
  const moveTextBlock = useCallback((id, newStartTime) => {
    const target = textOverlays.find(block => block.id === id);
    if (!target) return null;
    const blockDuration = target.endTime - target.startTime;
    const maxStart = (duration != null ? duration : Infinity) - blockDuration;
    const clampedStart = Math.max(0, Math.min(newStartTime, Math.max(0, maxStart)));
    const updated = { ...target, startTime: clampedStart, endTime: clampedStart + blockDuration };
    setTextOverlays(prev => prev.map(block => (block.id === id ? updated : block)));
    return updated;
  }, [textOverlays, duration]);

  const updateTextSpec = useCallback((id, nextSpec) => {
    const target = textOverlays.find(block => block.id === id);
    if (!target) return null;
    const updated = { ...target, spec: nextSpec };
    setTextOverlays(prev => prev.map(block => (block.id === id ? updated : block)));
    return updated;
  }, [textOverlays]);

  const toggleText = useCallback((id, enabled) => {
    const target = textOverlays.find(block => block.id === id);
    if (!target) return null;
    const updated = { ...target, enabled };
    setTextOverlays(prev => prev.map(block => (block.id === id ? updated : block)));
    return updated;
  }, [textOverlays]);

  const deleteText = useCallback((id) => {
    const found = textOverlays.find(block => block.id === id);
    if (!found) return null;
    setTextOverlays(prev => prev.filter(block => block.id !== id));
    if (selectedTextId === id) {
      setSelectedTextId(null);
    }
    return found;
  }, [textOverlays, selectedTextId]);

  /**
   * restoreTextOverlays -- read-only hydration from the backend-shaped
   * `text_overlays` array (design SS5.1: restore is read-only, no write-back).
   * Callers must gate any surgical dispatch on the sync-state machine
   * (overlaySyncState==='ready') exactly like useHighlightRegions.restoreRegions
   * -- this hook has no opinion on that; it only sets local state.
   */
  const restoreTextOverlays = useCallback((saved, videoDuration) => {
    setTextOverlays((saved || []).map(block => ({ ...block })));
    if (videoDuration != null) {
      setDurationState(videoDuration);
    }
  }, []);

  const reset = useCallback(() => {
    setTextOverlays([]);
    setSelectedTextId(null);
  }, []);

  /**
   * Derived: text blocks with visual layout info for TextLayer (mirrors
   * useHighlightRegions.regionsWithLayout exactly -- index +
   * visualStartPercent/visualWidthPercent computed here, not in the view).
   */
  const textOverlaysWithLayout = useMemo(() => {
    if (!duration) return [];
    return textOverlays.map((block, index) => ({
      ...block,
      index,
      visualStartPercent: (block.startTime / duration) * 100,
      visualWidthPercent: ((block.endTime - block.startTime) / duration) * 100,
    }));
  }, [textOverlays, duration]);

  return {
    textOverlays,
    textOverlaysWithLayout,
    duration,
    selectedTextId,
    setSelectedTextId,
    initializeWithDuration,
    addText,
    moveTextStart,
    moveTextEnd,
    moveTextBlock,
    updateTextSpec,
    toggleText,
    deleteText,
    restoreTextOverlays,
    reset,
  };
}
