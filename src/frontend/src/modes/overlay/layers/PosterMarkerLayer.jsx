import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, ImageOff } from 'lucide-react';
import { formatTimeSimple } from '../../../components/shared/clipConstants';
import { useIsCoarsePointer } from '../../../hooks/useIsMobile';

/**
 * PosterMarkerLayer - the cover-photo (poster) marker on the overlay timeline (T5410).
 *
 * Pinned to the TOP RAIL of the video track (same band as the playhead), so it
 * never collides with the region drag handles below (RegionLayer occupies its
 * own band, bottom-anchored). Rendered as a sibling of RegionLayer inside
 * TimelineBase's children slot, absolutely positioned at top:0 using the SAME
 * EDGE_PADDING formula the playhead uses -- it stays aligned at any timelineScale.
 *
 * Discoverability is the entire point of this surface (design gate, T5410):
 * visible at rest (never hover-gated), reachable via keyboard (role="slider"),
 * and sized to a 44px hit box on coarse pointers -- guards against the
 * hidden-affordance class of bug (T5910, T6300).
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
    setIsDragging(true);
    setDragVisualTime(shownVisualTime);
  }, [disabled, shownVisualTime]);

  useEffect(() => {
    if (!isDragging) return;

    const handlePointerMove = (e) => {
      if (e.cancelable) e.preventDefault();
      setDragVisualTime(pixelToVisualTime(e.clientX));
    };
    const handlePointerUp = (e) => {
      const finalTime = pixelToVisualTime(e.clientX);
      setIsDragging(false);
      setDragVisualTime(null);
      commitDrag(finalTime);
    };
    const handlePointerCancel = () => {
      setIsDragging(false);
      setDragVisualTime(null);
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
  const label = isUploaded
    ? 'Cover photo: custom image in use. This marker is inactive.'
    : isDragging
      ? `Cover frame: ${sourceTimeLabel}`
      : 'Cover frame — the middle of the open-play slow-mo. Drag to change, or use the panel below.';

  return (
    <div
      ref={trackRef}
      data-testid="poster-marker"
      role="slider"
      aria-label="Cover photo marker"
      aria-valuetext={sourceTimeLabel}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      title={label}
      className={`lever-handle absolute -top-3 z-30 flex flex-col items-center -translate-x-1/2 touch-none
                  focus:outline-none focus:ring-2 focus:ring-cyan-300 rounded
                  ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-grab active:cursor-grabbing pointer-events-auto'}`}
      style={{
        left: `calc(${edgePadding}px + (100% - ${edgePadding * 2}px) * ${positionPercent / 100})`,
        width: `${hitSize}px`,
      }}
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
