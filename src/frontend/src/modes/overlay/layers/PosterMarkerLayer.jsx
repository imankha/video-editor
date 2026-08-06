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
 * PLACEMENT (T6590 round 2 -- do NOT restore the old top-rail position): the
 * marker is a FULL-HEIGHT vertical guide line with its draggable handle at the
 * VERTICAL MIDDLE of the timeline. It used to be a chip pinned to the video
 * track's TOP RAIL (same band as the playhead) with a negative `-top-3` offset.
 * That had two defects: (1) CUT OFF -- the `.timeline-scroll-container`'s
 * overflow clipped the negative-offset glyph; (2) OCCLUDED -- it shared the
 * playhead's band, and setting the frame parks the playhead AT the marker, so the
 * two were guaranteed to coincide exactly when the feature is used. top-0/bottom-0
 * is never clipped, and the mid handle is out of the playhead's top band. The line
 * is pointer-events-none (never blocks editing the lanes it crosses); only the
 * handle is grabbable; z-30 keeps the handle above the playhead where they cross.
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

  // T6630/T6590 round 2: the marker is a FULL-HEIGHT guide line (reads THROUGH the
  // lanes like a secondary playhead) with the draggable handle lowered to the
  // vertical MIDDLE of the timeline. The old `-top-3` chip was (a) CLIPPED by the
  // `.timeline-scroll-container` overflow and (b) OCCLUDED by the playhead, which
  // is worst exactly when the feature is used (setting the frame parks the
  // playhead at the marker). top-0/bottom-0 is never clipped; the mid handle sits
  // out of the playhead's top-rail band. Only the handle is pointer-interactive —
  // the line is `pointer-events-none` so it never blocks editing the lanes beneath
  // it. z-30 keeps the handle above the playhead line where they coincide.
  const markerLeft = `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${positionPercent / 100})`;

  return (
    <>
      {/* Full-height guide line (visual only, never blocks the lanes it crosses) */}
      <div
        aria-hidden="true"
        className={`absolute top-0 bottom-0 -translate-x-1/2 w-0.5 z-20 pointer-events-none
          ${isUploaded ? 'bg-gray-500/50' : isDragging ? 'bg-cyan-300' : 'bg-cyan-400/70'}`}
        style={{ left: markerLeft }}
      />
      {/* Draggable handle at the vertical MIDDLE. Carries the position + hit-size +
          slider semantics; only this (small) element is pointer-interactive. */}
      <div
        ref={trackRef}
        data-testid="poster-marker"
        role="slider"
        aria-label="Thumbnail marker — drag to choose the thumbnail frame"
        aria-valuetext={sourceTimeLabel}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        title={label}
        className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 flex flex-col items-center touch-none
                    focus:outline-none focus:ring-2 focus:ring-cyan-300 rounded-md
                    ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-grab active:cursor-grabbing pointer-events-auto'}`}
        style={{ left: markerLeft, width: `${hitSize}px` }}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
      >
        <div
          className={`w-7 h-7 rounded-md border-2 flex items-center justify-center shadow-lg transition-transform
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
        {isDragging && (
          <div className="absolute -top-8 -translate-x-1/2 left-1/2 px-2 py-1 bg-gray-900 text-white text-xs rounded pointer-events-none whitespace-nowrap">
            {sourceTimeLabel}
          </div>
        )}
      </div>
    </>
  );
}
