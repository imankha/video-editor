import React from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * TimelineZoomChip (T10930) - the ONE visible timeline-zoom control, for every
 * pointer: `-  N%  +`, the % resets to 100%. Rendered by TimelineBase in place
 * of the read-only "Zoom: N%" badge whenever a mode hands it the zoom
 * callbacks (useTimelineZoom's zoomIn/zoomOut/resetZoom). Wheel zoom on desktop
 * and the touch scroll pill on phones stay as they are; this is the affordance
 * they never had. Targets grow to 44px on coarse pointers.
 */
export function TimelineZoomChip({ zoom, minZoom = 100, maxZoom = 500, onZoomIn, onZoomOut, onZoomReset }) {
  const atMin = zoom <= minZoom;
  const atMax = zoom >= maxZoom;
  const btn = 'flex items-center justify-center w-7 h-7 coarse-pointer:w-11 coarse-pointer:h-11 text-gray-200 hover:bg-white/15 disabled:opacity-35 disabled:hover:bg-transparent transition-colors';
  return (
    <div
      data-testid="timeline-zoom-chip"
      role="group"
      aria-label="Timeline zoom"
      className="inline-flex items-center rounded-full border border-white/20 bg-black/40 text-xs font-mono tabular-nums overflow-hidden"
    >
      <button
        type="button"
        onClick={onZoomOut}
        disabled={atMin}
        aria-label="Zoom out timeline"
        title="Zoom out"
        data-testid="timeline-zoom-out"
        className={btn}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        disabled={atMin}
        aria-label="Reset timeline zoom to 100%"
        title="Reset to 100%"
        data-testid="timeline-zoom-reset"
        className="px-2 min-w-[3.25rem] h-7 coarse-pointer:h-11 text-gray-100 hover:bg-white/15 disabled:hover:bg-transparent transition-colors"
      >
        {Math.round(zoom)}%
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        disabled={atMax}
        aria-label="Zoom in timeline"
        title="Zoom in"
        data-testid="timeline-zoom-in"
        className={btn}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export default TimelineZoomChip;
