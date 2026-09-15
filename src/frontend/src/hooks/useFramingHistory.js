import { useRef, useCallback } from 'react';

/**
 * T9950 Slice 2 -- session-scoped Undo for framing edits (wider frame + ordinary
 * focus-point edits). Ref-backed LIFO stack of inverse thunks, MEMORY ONLY:
 * never persisted, never written from a useEffect (design doc section 2.1 --
 * gesture-based persistence). Cleared by the caller on the existing
 * clip-selection gesture, not by an effect keyed on clip id.
 *
 * `canUndo` is read directly off the ref at render time, not mirrored into
 * useState -- every caller of push/undo/clear also changes OTHER hook state in
 * the same gesture (a keyframe edit, a clip switch), which already triggers the
 * re-render that makes the fresh ref value visible. Same pattern as the
 * existing `keyframesRef` mirror in useCrop.js.
 */
const MAX_DEPTH = 20;

export default function useFramingHistory() {
  const stackRef = useRef([]);

  const push = useCallback((label, apply) => {
    const next = [...stackRef.current, { label, apply }];
    stackRef.current = next.length > MAX_DEPTH ? next.slice(next.length - MAX_DEPTH) : next;
  }, []);

  const undo = useCallback(async () => {
    const stack = stackRef.current;
    if (stack.length === 0) return false;
    const entry = stack[stack.length - 1];
    stackRef.current = stack.slice(0, -1);
    await entry.apply();
    return true;
  }, []);

  const clear = useCallback(() => {
    stackRef.current = [];
  }, []);

  return {
    push,
    undo,
    clear,
    canUndo: stackRef.current.length > 0,
  };
}
