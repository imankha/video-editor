import { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Video, Clock } from 'lucide-react';
import { PULSE_CLASS } from './hooks/usePulseHighlight';

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
 *
 * T8900 Fix-timing: an angle bar is an ENTRY POINT for Fix-timing (long-press
 * 500ms or right-click -> a one-item "Fix timing" menu -> onRequestFixTiming).
 * While Fix-timing is open for a bar (`fixSequence === a.sequence`) that ONE bar
 * becomes horizontally draggable (Pointer Events + setPointerCapture + touch-none,
 * orange styling) and its click-to-switch is suppressed. Drag is attached ONLY to
 * the fix-target bar, so a bare drag outside the mode is structurally impossible
 * — there is no code path that binds pointer-move to a bar when fixSequence is null.
 */

// Max angle lane ROWS shown on desktop; deeper concurrency collapses to a +N
// affordance (the switcher badge popover reaches the rest).
const MAX_ANGLE_ROWS = 3;
// Below this rendered bar width (px) we drop the label and show the icon only.
const ICON_ONLY_BELOW_PX = 40;
// Long-press threshold to open the Fix-timing menu (GameTile precedent).
const LONG_PRESS_MS = 500;

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
  // T8900 Fix-timing
  fixSequence = null,        // the sequence currently in Fix-timing drag mode, or null
  fixPendingOffset = 0,      // the pending offset (seconds) at drag start
  onFixDragTo,               // (absoluteOffsetSeconds) => void
  onRequestFixTiming,        // (sequence) => void — open Fix-timing for this angle
  pulseSequence = null,      // a sequence to pulse-highlight (lane changed on Done)
  pulseNonce = 0,            // bumps so the same sequence re-pulses
}) {
  const trackRef = useRef(null);
  const menuRef = useRef(null);
  const [trackWidth, setTrackWidth] = useState(0);
  // One-item Fix-timing menu: { sequence, x, y } in viewport coords, or null.
  const [menu, setMenu] = useState(null);
  // Long-press + drag bookkeeping (per active pointer).
  const pressRef = useRef(null); // { timer, sequence, moved }
  const dragRef = useRef(null);  // { startX, startOffset }

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setTrackWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Any click/scroll dismisses the menu.
  useEffect(() => {
    if (!menu) return;
    // Ignore pointerdowns INSIDE the menu (its own item click would otherwise
    // detach the menu before onClick runs).
    const dismiss = (e) => {
      if (menuRef.current && e && menuRef.current.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', dismiss, { capture: true });
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', dismiss, { capture: true });
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [menu]);

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

  // ---- Long-press / right-click -> Fix-timing menu (entry point) ----
  const clearPress = () => {
    if (pressRef.current?.timer) clearTimeout(pressRef.current.timer);
    pressRef.current = null;
  };
  const openMenuAt = (sequence, x, y) => setMenu({ sequence, x, y });

  // ---- Drag-in-mode (ONLY the fix-target bar binds these) ----
  const onDragPointerDown = (e, sequence) => {
    if (sequence !== fixSequence) return; // structurally: no drag off-target
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startOffset: fixPendingOffset };
  };
  const onDragPointerMove = (e, sequence) => {
    if (!dragRef.current || sequence !== fixSequence || usableWidth <= 0) return;
    const dx = e.clientX - dragRef.current.startX;
    const deltaSeconds = (dx / usableWidth) * duration;
    onFixDragTo?.(dragRef.current.startOffset + deltaSeconds);
  };
  const onDragPointerUp = (e) => {
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  const renderBar = (a) => {
    const isActive = a.sequence === activeSourceSequence;
    const isFixTarget = a.sequence === fixSequence;
    const isPulsing = a.sequence === pulseSequence;
    const barPx = usableWidth * frac(a.virtualEnd - a.virtualStart);
    const iconOnly = isMobile || barPx < ICON_ONLY_BELOW_PX;

    // Base handlers shared by every bar: right-click + long-press open the
    // Fix-timing menu (only when an opener is provided and we're not already
    // dragging this bar in Fix-timing).
    const entryProps = onRequestFixTiming && !isFixTarget
      ? {
          onContextMenu: (e) => {
            e.preventDefault();
            e.stopPropagation();
            clearPress(); // a right-click must not also leave a long-press timer armed
            openMenuAt(a.sequence, e.clientX, e.clientY);
          },
          onPointerDown: (e) => {
            // Long-press only on the PRIMARY button / touch — a right-click is
            // handled by onContextMenu (else its own timer re-fires and detaches
            // the just-opened menu).
            if (e.button && e.button !== 0) return;
            const { clientX, clientY } = e;
            pressRef.current = {
              sequence: a.sequence,
              moved: false,
              timer: setTimeout(() => {
                openMenuAt(a.sequence, clientX, clientY);
                if (pressRef.current) pressRef.current.fired = true;
              }, LONG_PRESS_MS),
            };
          },
          onPointerMove: () => { if (pressRef.current) { pressRef.current.moved = true; clearPress(); } },
          onPointerUp: () => clearPress(),
          onPointerLeave: () => clearPress(),
        }
      : {};

    // Fix-target bar: drag replaces the entry/switch handlers entirely.
    const dragProps = isFixTarget
      ? {
          onPointerDown: (e) => onDragPointerDown(e, a.sequence),
          onPointerMove: (e) => onDragPointerMove(e, a.sequence),
          onPointerUp: onDragPointerUp,
          onPointerCancel: onDragPointerUp,
        }
      : {};

    const onBarClick = (e) => {
      e.stopPropagation();
      if (isFixTarget) return;                 // dragging, not switching
      if (pressRef.current?.fired) { clearPress(); return; } // long-press consumed it
      onSelectAngle?.(a.sequence, clickVirtualTime(e, a.virtualStart));
    };

    const colorClasses = isFixTarget
      ? 'bg-orange-500 text-white ring-2 ring-inset ring-orange-300 cursor-ew-resize'
      : angleClasses(isActive);

    return (
      <button
        key={a.sequence}
        type="button"
        data-testid={`angle-bar-${a.sequence}`}
        data-active={isActive ? 'true' : 'false'}
        data-fix-target={isFixTarget ? 'true' : 'false'}
        aria-label={`Angle: ${a.name}`}
        aria-pressed={isActive}
        title={isFixTarget ? `Drag to nudge ${a.name}` : a.name}
        onClick={onBarClick}
        {...entryProps}
        {...dragProps}
        className={`absolute top-0 bottom-0 flex items-center gap-1 rounded ${isMobile ? 'px-0.5' : 'px-1'} min-w-[16px] overflow-hidden text-[10px] leading-none transition-colors ${colorClasses} ${isPulsing ? PULSE_CLASS : ''}`}
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

  // Nonce keeps the re-pulse honest even though we don't render it — reading it
  // avoids an unused-prop lint and documents the re-mount contract.
  void pulseNonce;

  // Portal to document.body: a `fixed` element is positioned relative to the
  // nearest transformed ancestor, not the viewport, and the timeline/canvas has
  // transformed ancestors (same stacking-context landmine as T5700/T8600) — that
  // made the menu drift + detach under Playwright. Portalling escapes it.
  const fixMenu = menu ? createPortal(
    <div
      ref={menuRef}
      data-testid="fix-timing-menu"
      className="fixed z-50 rounded-lg bg-gray-900 border border-gray-700 shadow-xl py-1 text-sm"
      style={{ left: menu.x, top: menu.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        data-testid="fix-timing-menu-item"
        onClick={() => { const seq = menu.sequence; setMenu(null); onRequestFixTiming?.(seq); }}
        className="flex items-center gap-2 px-3 py-1.5 text-left text-gray-100 hover:bg-gray-800 w-full"
      >
        <Clock size={14} className="text-yellow-300" /> Fix timing
      </button>
    </div>,
    document.body,
  ) : null;

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
        {fixMenu}
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
      {fixMenu}
    </div>
  );
}
