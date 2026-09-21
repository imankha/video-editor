import { useRef, useState, useCallback } from 'react';
import { Plus, Scissors, Copy, Trash2 } from 'lucide-react';
import { FOCUS_COCKPIT } from '../../../config/displayNames';

// Mirrors the shared timeline geometry (components/timeline/TimelineBase.jsx:114,
// EDGE_PADDING = 20). TimelineBase is intentionally NOT modified by this task, so
// the literal is re-stated here next to its use (greppability > a cross-file
// export). Markers use the SAME calc formula the base timeline uses, never a bare
// `%`, so a diamond and the playhead land on the identical usable-area pixel.
const EDGE_PADDING = 20;
const LONG_PRESS_MS = 300;
const MOVE_THRESHOLD_PX = 4;
const JOG_DIVISOR = 4;

// left offset for a marker at fractional position `pct` (0..1) of the track.
function markerLeft(pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  return `calc(${EDGE_PADDING}px + (100% - ${EDGE_PADDING * 2}px) * ${clamped})`;
}

const CAP =
  'flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-gray-800 active:bg-gray-700 transition-colors';

/**
 * CockpitTimelineStrip (T10840, Zone C) — the single 56px horizontal timeline
 * in flow beneath the stage (never floating over it, so the crop box's bottom
 * resize handle stays reachable). An amber `[+]` cap adds a focus point at the
 * playhead; a purple `[scissors]` cap opens the Trim and slo-mo sheet; the pill
 * between them is the 572px scrub track carrying keyframe diamonds + a playhead.
 *
 * Gestures (D10): tap = seek, drag = scrub, long-press+drag = jog (movement / 4,
 * replacing timeline zoom), tap a diamond = seek+select -> Copy/Delete popover,
 * drag a diamond = move that focus point in time -> onKeyframeTimeMove.
 */
export default function CockpitTimelineStrip({
  keyframes = [],
  currentTime = 0,
  duration = 0,
  framerate = 30,
  onSeek,
  onAddFocusPoint,
  onOpenTrim,
  onKeyframeTimeMove,
  onKeyframeDelete,
  onCopyCrop,
}) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const longPressRef = useRef(null);
  const diamondDragRef = useRef(null);
  const [dragDiamond, setDragDiamond] = useState(null); // { from, to }
  const [selectedTime, setSelectedTime] = useState(null); // popover anchor

  const dur = duration > 0 ? duration : 0;

  // Focus points are the non-trim keyframes (trim-origin ones are boundary residue).
  const diamonds = keyframes
    .filter((kf) => kf && kf.origin !== 'trim')
    .map((kf) => ({ kf, time: kf.frame / framerate }));

  const timeFromClientX = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el || dur <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const usable = rect.width - EDGE_PADDING * 2;
    const x = Math.max(0, Math.min(clientX - rect.left - EDGE_PADDING, usable));
    return usable > 0 ? (x / usable) * dur : 0;
  }, [dur]);

  // ----- track: tap / scrub / jog -----
  const handleTrackPointerDown = useCallback((e) => {
    if (dur <= 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, moved: false, mode: 'scrub' };
    longPressRef.current = setTimeout(() => {
      if (dragRef.current && !dragRef.current.moved) dragRef.current.mode = 'jog';
    }, LONG_PRESS_MS);
  }, [dur]);

  const handleTrackPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const delta = e.clientX - d.startClientX;
    if (!d.moved && Math.abs(delta) > MOVE_THRESHOLD_PX) {
      d.moved = true;
      if (d.mode === 'scrub' && longPressRef.current) {
        clearTimeout(longPressRef.current);
        longPressRef.current = null;
      }
    }
    if (!d.moved) return;
    const effectiveX = d.mode === 'jog' ? d.startClientX + delta / JOG_DIVISOR : e.clientX;
    onSeek?.(timeFromClientX(effectiveX));
  }, [onSeek, timeFromClientX]);

  const handleTrackPointerUp = useCallback((e) => {
    const d = dragRef.current;
    if (longPressRef.current) { clearTimeout(longPressRef.current); longPressRef.current = null; }
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      // Tap on the track: seek there and dismiss any open keyframe popover.
      setSelectedTime(null);
      onSeek?.(timeFromClientX(e.clientX));
    }
  }, [onSeek, timeFromClientX]);

  // ----- diamond: tap (select+popover) / drag (move in time) -----
  const handleDiamondPointerDown = useCallback((e, time) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    diamondDragRef.current = { pointerId: e.pointerId, time, startClientX: e.clientX, moved: false };
  }, []);

  const handleDiamondPointerMove = useCallback((e) => {
    const d = diamondDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moved && Math.abs(e.clientX - d.startClientX) > MOVE_THRESHOLD_PX) d.moved = true;
    if (d.moved) setDragDiamond({ from: d.time, to: timeFromClientX(e.clientX) });
  }, [timeFromClientX]);

  const handleDiamondPointerUp = useCallback((e) => {
    const d = diamondDragRef.current;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    diamondDragRef.current = null;
    if (!d) return;
    if (d.moved && dragDiamond) {
      onKeyframeTimeMove?.(d.time, dragDiamond.to);
    } else {
      // Tap: seek to the focus point AND select it (opens the popover above).
      onSeek?.(d.time);
      setSelectedTime(d.time);
    }
    setDragDiamond(null);
  }, [dragDiamond, onKeyframeTimeMove, onSeek]);

  const playheadPct = dur > 0 ? currentTime / dur : 0;
  const selectedPct = selectedTime != null && dur > 0 ? selectedTime / dur : null;

  return (
    <div
      data-testid="cockpit-timeline"
      className="relative flex h-14 flex-none items-center gap-2 border-t border-gray-700 bg-gray-900 px-1"
    >
      <button
        type="button"
        data-testid="cockpit-add-focus-point"
        onClick={onAddFocusPoint}
        title={FOCUS_COCKPIT.ADD_FOCUS_POINT}
        aria-label={FOCUS_COCKPIT.ADD_FOCUS_POINT}
        className={`${CAP} text-amber-400`}
      >
        <Plus size={20} aria-hidden="true" />
      </button>

      <div
        ref={trackRef}
        data-testid="cockpit-scrub-track"
        onPointerDown={handleTrackPointerDown}
        onPointerMove={handleTrackPointerMove}
        onPointerUp={handleTrackPointerUp}
        onPointerCancel={handleTrackPointerUp}
        className="relative h-9 min-w-0 flex-1 touch-none select-none rounded-full bg-gray-800"
      >
        {/* Playhead */}
        <div
          data-testid="cockpit-playhead"
          className="pointer-events-none absolute top-0 bottom-0 w-0.5 -translate-x-1/2 bg-white/80"
          style={{ left: markerLeft(playheadPct) }}
        />

        {/* Keyframe diamonds — 13px visual + a 44px transparent hit box */}
        {diamonds.map(({ time }, i) => {
          const shownTime = dragDiamond && dragDiamond.from === time ? dragDiamond.to : time;
          const pct = dur > 0 ? shownTime / dur : 0;
          return (
            <div
              key={`${time}-${i}`}
              data-testid="cockpit-keyframe-diamond"
              onPointerDown={(e) => handleDiamondPointerDown(e, time)}
              onPointerMove={handleDiamondPointerMove}
              onPointerUp={handleDiamondPointerUp}
              onPointerCancel={handleDiamondPointerUp}
              className="absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rotate-45 cursor-pointer touch-none border border-white bg-blue-500"
              style={{ left: markerLeft(pct) }}
            >
              <span aria-hidden className="absolute -inset-4" />
            </div>
          );
        })}

        {/* Copy / Delete popover ABOVE the strip (D10) — replaces the old floating
            red delete FAB that overlapped the track. Rendered INSIDE the track so
            its `markerLeft` `100%` resolves against the SAME width the diamonds
            use (the strip container is wider by the two caps + gaps, so a
            strip-relative offset would drift from the diamond toward the right
            edge). Pointer events are stopped here so the track's scrub/seek
            handlers never fire from a tap on Copy/Delete. */}
        {selectedPct != null && (
          <div
            data-testid="cockpit-keyframe-popover"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            className="absolute bottom-full z-50 mb-1 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-gray-700 bg-gray-900 p-1 shadow-lg"
            style={{ left: markerLeft(selectedPct) }}
          >
            <button
              type="button"
              data-testid="cockpit-keyframe-copy"
              onClick={() => { onCopyCrop?.(selectedTime); setSelectedTime(null); }}
              title="Copy keyframe"
              aria-label="Copy keyframe"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-200 hover:bg-white/10"
            >
              <Copy size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="cockpit-keyframe-delete"
              onClick={() => { onKeyframeDelete?.(selectedTime); setSelectedTime(null); }}
              title="Delete keyframe"
              aria-label="Delete keyframe"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-red-400 hover:bg-red-500/10"
            >
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        data-testid="cockpit-open-trim"
        onClick={onOpenTrim}
        title={FOCUS_COCKPIT.OPEN_TRIM}
        aria-label={FOCUS_COCKPIT.OPEN_TRIM}
        className={`${CAP} text-purple-400`}
      >
        <Scissors size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
