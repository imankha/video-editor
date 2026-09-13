import { useCallback, useState } from 'react';
import { formatInstant, parseTimeInput, snapToStep, PRECISION, UI_STEP_FPS } from '../../../utils/timeFormat';
import { clampTrim } from '../trimBounds';

const INVALID_INPUT_MESSAGE = 'Use M:SS.s (e.g. 2:09.5)';

/**
 * T9480 -- one controlled boundary field (AC2: exact start/end entry + frame
 * stepping). Rendered twice by ClipScrubRegion, once per edge.
 *
 * At rest it renders EXACTLY the string the trim-detail readout already shows
 * (formatInstant(value, TENTH), post Stage D1) -- the resting DOM is
 * byte-identical in every layout. It becomes an input on click/Enter/focus.
 *
 * Commit path: parseTimeInput -> snapToStep -> clampTrim -> onCommit -> onSeek
 * -> onCommitComplete -- the SAME onStartTimeChange/onEndTimeChange the drag
 * path already calls, so there is one write path for a trim boundary (drag,
 * entry, steps). `onCommitComplete` fires the SAME "this edit is finished"
 * signal the drag path's `onDragEnd(finalStart, finalEnd)` fires -- some
 * callers (e.g. ClipDetailsEditor's sidebar) only PERSIST on that signal
 * (`onCommit` there is local-state-only, mirroring the drag path's
 * intermediate updates), so a typed/step commit that never fires it would
 * update the on-screen preview and then silently be discarded the moment the
 * parent re-syncs local state from a clip switch.
 *
 * @param {number} value - this field's own current boundary (start or end)
 * @param {'start'|'end'} edge - which boundary this field controls
 * @param {number} otherValue - the OTHER boundary (the anchor clampTrim needs)
 * @param {{mediaStart?: number, mediaEnd: number}} mediaBounds - true media bounds
 * @param {(value: number) => void} onCommit - the existing onStartTimeChange/onEndTimeChange
 * @param {(value: number) => void} onSeek - seeks the preview to the committed value (AC2)
 * @param {(finalStart: number, finalEnd: number) => void} [onCommitComplete] -
 *   fired after a real (non-rejected) commit/step, with BOTH final boundaries
 *   -- the same shape as ClipScrubRegion's onDragEnd
 * @param {boolean} [compact] - sidebar/landscape-strip layout: click-to-edit in
 *   place, no step-button chevrons (zero added footprint)
 */
export function TrimTimeField({ value, edge, otherValue, mediaBounds, onCommit, onSeek, onCommitComplete, compact = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState(null);

  const mediaStart = mediaBounds?.mediaStart ?? 0;
  const mediaEnd = mediaBounds?.mediaEnd;

  const startEditing = useCallback(() => {
    setDraft(formatInstant(value, PRECISION.TENTH));
    setMessage(null);
    setEditing(true);
  }, [value]);

  const discardEditing = useCallback(() => {
    setEditing(false);
    setMessage(null);
  }, []);

  const applyClamp = useCallback((candidate) => {
    const start = edge === 'start' ? candidate : otherValue;
    const end = edge === 'end' ? candidate : otherValue;
    return clampTrim({ start, end, edge, mediaStart, mediaEnd });
  }, [edge, otherValue, mediaStart, mediaEnd]);

  // Fires onCommitComplete with BOTH final boundaries -- the same shape as
  // ClipScrubRegion's onDragEnd(finalStart, finalEnd) -- so a caller that
  // only persists on that signal (ClipDetailsEditor's sidebar) sees the
  // typed/step commit, not just the drag path's.
  const signalCommitComplete = useCallback((committedValue) => {
    const finalStart = edge === 'start' ? committedValue : otherValue;
    const finalEnd = edge === 'end' ? committedValue : otherValue;
    onCommitComplete?.(finalStart, finalEnd);
  }, [edge, otherValue, onCommitComplete]);

  const commit = useCallback((text) => {
    const parsed = parseTimeInput(text);
    if (parsed == null) {
      setMessage(INVALID_INPUT_MESSAGE);
      return;
    }
    const snapped = snapToStep(parsed);
    const r = applyClamp(snapped);
    if (r.rejected) {
      setMessage(r.message ?? 'That range is not possible.');
      return;
    }
    // r.clamped: the value DID move -- say so, never silently.
    setMessage(r.clamped ? r.message : null);
    onCommit(r.value);
    onSeek(r.value);
    signalCommitComplete(r.value);
    setEditing(false);
  }, [applyClamp, onCommit, onSeek, signalCommitComplete]);

  const step = useCallback((deltaSeconds) => {
    // T9480 review fix: snap the STEPPED result too, so stepping from an
    // off-grid value (dragging is deliberately NOT snapped, see UI_STEP_FPS)
    // lands back on the UI_STEP_FPS grid instead of staying off-grid forever
    // -- typed entry and step buttons both produce values from the same grid.
    const snapped = snapToStep(value + deltaSeconds);
    const r = applyClamp(snapped);
    if (r.rejected) return;
    setMessage(r.clamped ? r.message : null);
    onCommit(r.value);
    onSeek(r.value);
    signalCommitComplete(r.value);
  }, [applyClamp, value, onCommit, onSeek, signalCommitComplete]);

  const handleKeyDown = useCallback((e) => {
    // Keyboard safety: AnnotateScreen's keydown handler already disables
    // arrow-key seek/rating shortcuts while the overlay is open; this
    // additionally stops the event from ever reaching that handler.
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      discardEditing();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const direction = e.key === 'ArrowUp' ? 1 : -1;
      const magnitude = e.shiftKey ? 1 : 1 / UI_STEP_FPS;
      step(direction * magnitude);
    }
  }, [draft, commit, discardEditing, step]);

  const field = editing ? (
    <input
      type="text"
      inputMode="decimal"
      autoFocus
      className="font-mono bg-gray-800 text-white border border-purple-500 rounded px-1 w-[4.5rem] text-center"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={() => commit(draft)}
      onClick={(e) => e.stopPropagation()}
      data-testid={`trim-field-input-${edge}`}
    />
  ) : (
    <button
      type="button"
      className="font-mono text-white hover:text-purple-300 transition-colors"
      onClick={(e) => { e.stopPropagation(); startEditing(); }}
      onFocus={startEditing}
      data-testid={`trim-field-${edge}`}
    >
      {formatInstant(value, PRECISION.TENTH)}
    </button>
  );

  const body = (
    <span className="inline-flex flex-col items-center">
      {field}
      {message && (
        <span className="text-[10px] text-amber-400 whitespace-nowrap" data-testid={`trim-field-message-${edge}`}>
          {message}
        </span>
      )}
    </span>
  );

  if (compact) {
    return body;
  }

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="coarse-pointer:min-h-[44px] px-1 text-gray-400 hover:text-white transition-colors"
        title="Step one frame (1/30 s)"
        onClick={() => step(-1 / UI_STEP_FPS)}
      >
        &#9664;
      </button>
      {body}
      <button
        type="button"
        className="coarse-pointer:min-h-[44px] px-1 text-gray-400 hover:text-white transition-colors"
        title="Step one frame (1/30 s)"
        onClick={() => step(1 / UI_STEP_FPS)}
      >
        &#9654;
      </button>
    </span>
  );
}
