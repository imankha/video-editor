import React, { useRef, useState, useEffect } from 'react';
import { Video } from 'lucide-react';

/**
 * AngleLanes (T8890) — the violet "angle" strip that sits ABOVE the video track
 * in Annotate, rendered ONLY for a game with overlapping footage. Each lane row
 * (lanes 1+ from buildGameTimeline) shows its angle bars where that footage
 * exists; clicking a bar seeks to the click position AND makes that angle the
 * active camera.
 *
 * ZERO ANGLES = ZERO PIXELS: callers must not mount this component when there are
 * no angles (AnnotateTimeline gates on `angles.length`), and it also self-guards.
 *
 * Positioning uses the SAME EDGE_PADDING formula as every other timeline layer
 * (bare % drifts): left/width are `calc(pad + (100% - 2*pad) * frac)`.
 *
 * Vocabulary is "angle" everywhere (EPIC decision 8); color is the violet family,
 * the only unclaimed hue on the Annotate screen.
 */

// Max angle lane ROWS shown on desktop; deeper concurrency collapses to a +N
// affordance (the switcher badge popover reaches the rest).
const MAX_ANGLE_ROWS = 3;
// Below this rendered bar width (px) we drop the label and show the icon only.
const ICON_ONLY_BELOW_PX = 40;

function angleClasses(isActive) {
  return isActive
    ? 'bg-violet-600 text-white ring-1 ring-inset ring-violet-300'
    : 'bg-gray-700 border border-violet-500/40 text-violet-300 hover:bg-gray-600';
}

export default function AngleLanes({
  angles = [],
  laneCount = 0,          // number of angle lanes (lanes.length - 1)
  duration,
  activeSourceSequence = null,
  onSelectAngle,
  edgePadding = 20,
  isMobile = false,
}) {
  const trackRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!duration || angles.length === 0) return null;

  const usableWidth = Math.max(0, trackWidth - edgePadding * 2);
  const frac = (t) => t / duration;
  const leftCalc = (t) => `calc(${edgePadding}px + (100% - ${2 * edgePadding}px) * ${frac(t)})`;
  const widthCalc = (a, b) => `calc((100% - ${2 * edgePadding}px) * ${frac(b - a)})`;

  // Click within a bar -> the exact virtual time under the pointer (so the
  // playhead lands where the user aimed, then the angle goes active).
  const clickVirtualTime = (e, fallbackStart) => {
    const el = trackRef.current;
    if (!el || usableWidth <= 0) return fallbackStart;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - edgePadding;
    const clamped = Math.max(0, Math.min(x, usableWidth));
    return (clamped / usableWidth) * duration;
  };

  const renderBar = (a) => {
    const isActive = a.sequence === activeSourceSequence;
    const barPx = usableWidth * frac(a.virtualEnd - a.virtualStart);
    const iconOnly = isMobile || barPx < ICON_ONLY_BELOW_PX;
    return (
      <button
        key={a.sequence}
        type="button"
        data-testid={`angle-bar-${a.sequence}`}
        data-active={isActive ? 'true' : 'false'}
        aria-label={`Angle: ${a.name}`}
        aria-pressed={isActive}
        title={a.name}
        onClick={(e) => {
          e.stopPropagation();
          onSelectAngle?.(a.sequence, clickVirtualTime(e, a.virtualStart));
        }}
        className={`absolute top-0 bottom-0 flex items-center gap-1 rounded ${isMobile ? 'px-0.5' : 'px-1'} min-w-[16px] overflow-hidden text-[10px] leading-none transition-colors ${angleClasses(isActive)}`}
        style={{
          left: leftCalc(a.virtualStart),
          width: widthCalc(a.virtualStart, a.virtualEnd),
          // Coarse-pointer hit target without changing the visual height.
          touchAction: 'none',
        }}
      >
        <Video size={isMobile ? 9 : 11} className="shrink-0" />
        {!iconOnly && <span className="truncate">{a.name}</span>}
      </button>
    );
  };

  // Mobile: ONE merged strip (h-3.5), icon-only pills, all angles on one row.
  if (isMobile) {
    return (
      <div className="mt-1" data-testid="angle-strip-mobile">
        <div
          ref={trackRef}
          className="relative h-3.5 bg-gray-800 rounded"
          style={{ paddingLeft: `${edgePadding}px`, paddingRight: `${edgePadding}px` }}
        >
          <div className="relative h-full">{angles.map(renderBar)}</div>
        </div>
      </div>
    );
  }

  // Desktop: one row per angle lane (1..MAX_ANGLE_ROWS), each bar on its lane.
  const shownLanes = Math.min(laneCount, MAX_ANGLE_ROWS);
  const overflow = laneCount - shownLanes;
  return (
    <div className="mt-1" data-testid="angle-strip">
      <div
        ref={trackRef}
        className="relative"
        style={{ paddingLeft: `${edgePadding}px`, paddingRight: `${edgePadding}px` }}
      >
        <div className="relative">
          {Array.from({ length: shownLanes }, (_, i) => {
            const lane = i + 1;
            const laneAngles = angles.filter((a) => a.lane === lane);
            return (
              <div key={lane} className="relative h-5 bg-gray-800 rounded mb-0.5" data-testid={`angle-lane-${lane}`}>
                {laneAngles.map(renderBar)}
              </div>
            );
          })}
        </div>
        {overflow > 0 && (
          <span
            className="absolute -top-1 right-0 px-1 rounded bg-violet-600 text-white text-[9px] leading-tight"
            data-testid="angle-overflow"
            title={`${overflow} more angle${overflow > 1 ? 's' : ''} — use the switcher`}
          >
            +{overflow}
          </span>
        )}
      </div>
    </div>
  );
}
