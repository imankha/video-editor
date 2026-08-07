import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ImageOff } from 'lucide-react';
import { formatTimeSimple } from '../../../components/shared/clipConstants';
import { useIsCoarsePointer } from '../../../hooks/useIsMobile';

// Pointer travel (px) below which a pointerdown->up is a CLICK, not a drag, and
// commits nothing. Small enough that any intended drag clears it, large enough
// to swallow the sub-pixel jitter of a "click in place" (T6560).
const DRAG_THRESHOLD_PX = 4;

/**
 * PosterMarkerLayer - the THUMBNAIL marker on the overlay timeline (T5410; UI term
 * "thumbnail" since T6590 -- the data model still calls it poster_*).
 *
 * PLACEMENT (T6590 round 3 -- user decision 2026-08-06: "it should be on top of
 * the timeline and draggable"). The marker lives in the VIDEO TRACK's own top
 * band -- same row the playhead's circle occupies -- and DOES NOT move lower.
 * Round 2 tried a full-height guide line with the handle at vertical middle to
 * dodge the playhead; that is REVERTED. Do not reintroduce it: the fix for
 * occlusion is z-order + an opaque, outlined chip, not relocation.
 *
 * CUT OFF -- fixed by NEVER using a negative offset. The old chip used `-top-3`
 * to sit proud above the row, and the `.timeline-scroll-container`'s
 * `overflow-x-auto` implicitly computes `overflow-y: auto` too (the CSS rule:
 * setting only one axis forces the other off `visible`), which clipped anything
 * extending above the container's top edge. The chip now starts at `top-0`
 * (mobile row is exactly chip height, so it fills the row with zero offset) /
 * `lg:top-2` (centred in the taller desktop row) -- both are POSITIVE, so
 * nothing is ever cut regardless of ancestor overflow. Verified at 100% and
 * 500% zoom (T6590 evidence).
 *
 * OCCLUDED -- fixed by making the marker WIN the overlap, not avoid it. The
 * unified playhead (`TimelineBase.jsx`, `data-testid="timeline-playhead"`) is
 * `position:absolute` with NO explicit z-index (CSS auto-stacks it at the
 * "z-index:0" painting level, ordered by DOM position). This marker's handle
 * carries an EXPLICIT `z-40` (a positive z-index always paints after every
 * auto/0-level sibling in the same stacking context, per the CSS stacking-order
 * algorithm), so it paints on top of the playhead UNCONDITIONALLY -- not by
 * fragile DOM-order luck. The chip is fully opaque with a dark `ring-2
 * ring-gray-900` halo, so even the exact-coincidence case (setting the frame
 * parks the playhead AT the marker) reads cleanly: the chip visually covers the
 * playhead's line/circle instead of the two blending together. Verified by
 * seeking the playhead exactly onto the marker's time and confirming the marker
 * is still the topmost element via `document.elementFromPoint` (T6590 evidence,
 * 100% and 500% zoom). z-40 is a local, intra-timeline scale rung (like the
 * `z-100` levers) -- `constants/zLayers.js` explicitly excludes intra-timeline
 * stacking from its app-wide ladder (see that file's own docstring), so this is
 * not a candidate for that scale.
 *
 * NO COLLISION WITH REGION LEVERS -- unchanged from the original reasoning: the
 * marker occupies the VIDEO TRACK row (the first/topmost lane); RegionLayer's
 * levers are bottom-anchored WITHIN the Highlight lane, a separate row further
 * down the stack. The two never share vertical space, so returning to the top
 * band does not reintroduce that collision (verified: T6590 evidence hit-tests
 * the marker against the region levers at both zoom levels).
 *
 * Discoverability is the entire point of this surface (design gate, T5410):
 * visible AND draggable at rest (never hover-gated), reachable via keyboard
 * (role="slider"), sized to a 44px hit box on coarse pointers -- guards against
 * the hidden-affordance class of bug (T5910, T6300). Since T6590 deleted the
 * "Use current frame" button, dragging this marker is the ONLY way to set the
 * frame, so the tooltip/aria state the interaction, not a noun label.
 */
export default function PosterMarkerLayer({
  visualTime,          // current marker position, in VISUAL (timeline) seconds
  duration,
  visualDuration,
  isUploaded = false,  // a custom image is in use -- marker renders inactive/muted
  onDragEnd,           // (visualTime) => void -- fires ONCE per drag, on pointerup
  visualTimeToSourceTime = (t) => t,
  edgePadding = 20,
  disabled = false,
}) {
  const trackRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragVisualTime, setDragVisualTime] = useState(null);
  // Where the pointer went down, and whether it has moved past DRAG_THRESHOLD_PX
  // since. A pointerdown+up with no real movement is a CLICK, not a drag, and
  // must NOT commit: the marker only MOVES on a deliberate drag (or arrow keys),
  // never on a stray click/tap. Without this, a click committed
  // pixelToVisualTime(clientX), snapping the marker to wherever inside its 32px
  // hit box you clicked -- so "click it / release in place" relocated the frame
  // (the T6560 "turn it off by clicking" report). Belt to the backend's brace:
  // /poster-time can no longer clear to none, and a click no longer writes.
  const pointerDownXRef = useRef(null);
  const movedRef = useRef(false);
  const isCoarsePointer = useIsCoarsePointer();
  const hitSize = isCoarsePointer ? 44 : 32;

  const timelineDuration = visualDuration || duration || 0;
  const shownVisualTime = isDragging && dragVisualTime != null ? dragVisualTime : visualTime;
  const positionPercent = timelineDuration > 0
    ? Math.max(0, Math.min(100, (shownVisualTime / timelineDuration) * 100))
    : 0;

  const pixelToVisualTime = useCallback((clientX) => {
    const container = trackRef.current?.closest('.timeline-scroll-container') || trackRef.current;
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    const usableWidth = rect.width - edgePadding * 2;
    const x = clientX - rect.left - edgePadding;
    const clampedX = Math.max(0, Math.min(x, usableWidth));
    const percent = usableWidth > 0 ? clampedX / usableWidth : 0;
    return percent * timelineDuration;
  }, [edgePadding, timelineDuration]);

  const commitDrag = useCallback((newVisualTime) => {
    if (onDragEnd) onDragEnd(newVisualTime);
  }, [onDragEnd]);

  const handlePointerDown = useCallback((e) => {
    if (disabled) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointerDownXRef.current = e.clientX;
    movedRef.current = false;
    setIsDragging(true);
    setDragVisualTime(shownVisualTime);
  }, [disabled, shownVisualTime]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      if (e.cancelable) e.preventDefault();
      if (pointerDownXRef.current != null
          && Math.abs(e.clientX - pointerDownXRef.current) > DRAG_THRESHOLD_PX) {
        movedRef.current = true;
      }
      // Only track the pointer once it's a real drag -- a sub-threshold jitter
      // must not visually nudge the marker off its committed frame.
      if (movedRef.current) setDragVisualTime(pixelToVisualTime(e.clientX));
    };
    const handlePointerUp = (e) => {
      const moved = movedRef.current;
      const finalTime = pixelToVisualTime(e.clientX);
      setIsDragging(false);
      setDragVisualTime(null);
      pointerDownXRef.current = null;
      movedRef.current = false;
      // A click / release-in-place is NOT a move: leave the frame untouched.
      if (moved) commitDrag(finalTime);
    };
    const handlePointerCancel = () => {
      setIsDragging(false);
      setDragVisualTime(null);
      pointerDownXRef.current = null;
      movedRef.current = false;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [isDragging, pixelToVisualTime, commitDrag]);

  const nudge = useCallback((deltaSeconds) => {
    if (disabled) return;
    const next = Math.max(0, Math.min(timelineDuration, shownVisualTime + deltaSeconds));
    commitDrag(next);
  }, [disabled, shownVisualTime, timelineDuration, commitDrag]);

  const handleKeyDown = useCallback((e) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        nudge(e.shiftKey ? -1.0 : -(1 / 30));
        break;
      case 'ArrowRight':
        e.preventDefault();
        nudge(e.shiftKey ? 1.0 : 1 / 30);
        break;
      case 'Home':
        e.preventDefault();
        commitDrag(0);
        break;
      case 'End':
        e.preventDefault();
        commitDrag(timelineDuration);
        break;
      default:
        break;
    }
  }, [disabled, nudge, commitDrag, timelineDuration]);

  if (timelineDuration <= 0) return null;

  const sourceTimeLabel = formatTimeSimple(visualTimeToSourceTime(shownVisualTime));
  // UI term is "thumbnail" (T6590); the model still calls it poster_*. The
  // tooltip/aria STATE THE INTERACTION (drag to choose the frame), not a noun.
  const label = isUploaded
    ? 'Custom thumbnail image in use. This marker is inactive.'
    : isDragging
      ? `Thumbnail frame: ${sourceTimeLabel}`
      : 'Drag to choose which frame is the thumbnail — the still people see when you share. Currently the middle of the open-play slow-mo.';

  // T6590 round 3: the marker lives in the VIDEO TRACK's top band -- see the
  // component docstring for the full CUT-OFF / OCCLUDED reasoning. `top-0` on
  // mobile (the chip's own height ~ fills the row exactly) / `lg:top-2` on
  // desktop (centres it in the taller row) -- both POSITIVE, so nothing is ever
  // clipped by the scroll container's implicit overflow-y. `z-40` is an explicit,
  // positive z-index -- it paints unconditionally above the playhead (which has
  // no z-index and auto-stacks at the 0 level), regardless of DOM order. The
  // inner chip carries a dark `ring-2 ring-gray-900` halo so it reads cleanly
  // against the white playhead line even at exact coincidence.
  const markerLeft = `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${positionPercent / 100})`;

  return (
    <div
      ref={trackRef}
      data-testid="poster-marker"
      role="slider"
      aria-label="Thumbnail marker — drag to choose the thumbnail frame"
      aria-valuetext={sourceTimeLabel}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={label}
      className={`absolute top-0 lg:top-2 z-40 -translate-x-1/2 flex flex-col items-center touch-none
                  focus:outline-none focus:ring-2 focus:ring-cyan-300 rounded-md
                  ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-grab active:cursor-grabbing pointer-events-auto'}`}
      style={{ left: markerLeft, width: `${hitSize}px` }}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    >
      <div
        className={`w-7 h-7 rounded-md border-2 ring-2 ring-gray-900 flex items-center justify-center shadow-lg transition-transform
          ${isUploaded
            ? 'bg-gray-600 border-gray-400 opacity-60'
            : isDragging
              ? 'bg-cyan-400 border-cyan-200 scale-110'
              : 'bg-cyan-500 border-cyan-300'}`}
      >
        {isUploaded
          ? <ImageOff size={16} className="text-white" />
          : <Image size={16} className="text-white" />}
      </div>
      <div
        className={`w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent -mt-px
          ${isUploaded ? 'border-t-gray-600' : isDragging ? 'border-t-cyan-400' : 'border-t-cyan-500'}`}
      />
      {isDragging && (
        <div className="absolute -top-8 -translate-x-1/2 left-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none whitespace-nowrap">
          {sourceTimeLabel}
        </div>
      )}
    </div>
  );
}
