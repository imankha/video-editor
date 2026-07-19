import { useState, useRef, useEffect, useCallback } from 'react';
import { HighlightEffect } from '../../../constants/highlightEffects';
import useVideoDisplayRect, { round3 } from '../../../hooks/useVideoDisplayRect';
import { useIsCoarsePointer } from '../../../hooks/useIsMobile';

// Touch target sizing (T5390). On coarse pointers the resize handles only appear
// once the circle is SELECTED, and their invisible hit circle is >=44px (radius 22)
// per the mobile touch-target rule (matches T5360). Desktop keeps the original 7px.
const HANDLE_VISIBLE_RADIUS_DESKTOP = 7;
const HANDLE_VISIBLE_RADIUS_TOUCH = 12;
const HANDLE_HIT_RADIUS_TOUCH = 22; // 44px diameter

/**
 * HighlightOverlay component - renders a draggable/resizable highlight ellipse
 * over the video player to indicate the highlighted player
 * Uses a vertical ellipse (taller than wide) for upright players
 *
 * Input is unified on Pointer Events (mouse + touch share one path) with
 * setPointerCapture, so a drag stays glued to the circle even if the finger/cursor
 * leaves it (T5390, replaces the old mouse-only + window-listener model).
 *
 * On coarse (touch) pointers the interaction is SELECT-THEN-MANIPULATE: one tap on
 * the ellipse selects it (ephemeral view state, never persisted), which reveals the
 * >=44px resize handles and lets the body drag to move / handles drag to resize. A
 * tap elsewhere deselects. Desktop (fine pointer) is byte-identical to before: no
 * selection step, direct drag/resize. Selection is controlled by the parent
 * (`isSelected`/`onSelectedChange`) so the video tap-nav owner can yield while a
 * circle is selected; it falls back to internal state when uncontrolled.
 */
export default function HighlightOverlay({
  videoRef,
  videoMetadata,
  currentHighlight,
  onHighlightChange,
  onHighlightComplete,
  isEnabled = false,
  effectType = HighlightEffect.DARK_OVERLAY,
  highlightShape = 'body',
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  isFullscreen = false,
  strokeWidth = 3,
  fillEnabled = false,
  fillOpacity = 0.10,
  dimStrength = 0.15,
  isSelected,
  onSelectedChange,
}) {
  const overlayRef = useRef(null);

  const isCoarse = useIsCoarsePointer();

  // Controlled/uncontrolled selection. The parent (OverlayModeView) owns the state
  // so the video tap-nav can yield while selected; when no handler is passed we keep
  // a local copy so other render paths / tests still work.
  const [internalSelected, setInternalSelected] = useState(false);
  const selected = onSelectedChange ? !!isSelected : internalSelected;
  const setSelected = useCallback((next) => {
    if (onSelectedChange) onSelectedChange(next);
    else setInternalSelected(next);
  }, [onSelectedChange]);

  // Transient interaction data kept in refs (not state) so the pointer-move handler
  // reads the current values with zero re-render lag between pointerdown and the
  // first move — the flags/geometry are set synchronously when the drag begins.
  const activePointerIdRef = useRef(null);
  const draggingRef = useRef(false);
  const resizingRef = useRef(false);
  const resizeHandleRef = useRef(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const highlightStartRef = useRef(null);

  // Ref to track the latest highlight during drag/resize
  // This ensures the pointer-up commit always has the most recent position,
  // even if React hasn't re-rendered yet after the last pointer move
  const latestHighlightRef = useRef(null);

  // Single source of truth for the video->screen transform. Ships both fixes
  // (first-paint layout effect + rAF-leak/fullscreen settle) by construction.
  const { rect: videoDisplayRect, videoToScreen } = useVideoDisplayRect(
    videoRef,
    videoMetadata,
    { zoom, panOffset, isFullscreen }
  );

  /**
   * Constrain highlight ellipse to video bounds
   */
  const constrainHighlight = useCallback((highlight) => {
    const maxWidth = videoMetadata.width;
    const maxHeight = videoMetadata.height;

    let constrained = { ...highlight };

    // Ensure minimum radii
    constrained.radiusX = Math.max(10, constrained.radiusX);
    constrained.radiusY = Math.max(15, constrained.radiusY);

    // Constrain center position to keep ellipse within video bounds
    const minX = constrained.radiusX;
    const maxX = maxWidth - constrained.radiusX;
    const minY = constrained.radiusY;
    const maxY = maxHeight - constrained.radiusY;

    constrained.x = Math.max(minX, Math.min(constrained.x, maxX));
    constrained.y = Math.max(minY, Math.min(constrained.y, maxY));

    // If radii are too large, reduce them
    if (constrained.radiusX > maxWidth / 2) {
      constrained.radiusX = maxWidth / 2;
    }
    if (constrained.radiusY > maxHeight / 2) {
      constrained.radiusY = maxHeight / 2;
    }

    return {
      x: round3(constrained.x),
      y: round3(constrained.y),
      radiusX: round3(constrained.radiusX),
      radiusY: round3(constrained.radiusY),
      strokeOpacity: constrained.strokeOpacity,
      fillOpacity: constrained.fillOpacity,
      color: constrained.color
    };
  }, [videoMetadata]);

  /**
   * Begin a body drag. Captures the pointer so the move stays glued to the circle
   * even if the finger/cursor leaves it, and snapshots the start geometry.
   */
  const beginDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    highlightStartRef.current = currentHighlight;
    draggingRef.current = true;
    resizingRef.current = false;
    resizeHandleRef.current = null;
  };

  /**
   * Begin a handle resize.
   */
  const beginResize = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    activePointerIdRef.current = e.pointerId;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    highlightStartRef.current = currentHighlight;
    resizingRef.current = true;
    draggingRef.current = false;
    resizeHandleRef.current = handle;
  };

  /**
   * Pointer down on the ellipse body. On a coarse pointer the FIRST tap only
   * selects (no move); once selected the body drags. Fine pointers (mouse) drag
   * immediately, exactly as before — no selection step.
   */
  const handleEllipsePointerDown = (e) => {
    if (e.target.classList.contains('resize-handle')) return;

    if (isCoarse && !selected) {
      e.preventDefault();
      e.stopPropagation();
      setSelected(true);
      return;
    }

    beginDrag(e);
  };

  /**
   * Pointer down on a resize handle. Handles only render when draggable
   * (desktop always; touch once selected), so reaching here means resize.
   */
  const handleResizePointerDown = (e, handle) => {
    beginResize(e, handle);
  };

  /**
   * Pointer down on the deselect backdrop (only rendered while selected on touch).
   * A tap anywhere off the circle deselects and does NOT reach the video tap-nav.
   */
  const handleBackdropPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(false);
  };

  /**
   * Handle pointer move (drag or resize). Reads transient state from refs so the
   * very first move after pointerdown is honoured with no re-render lag.
   */
  const handlePointerMove = (e) => {
    if (e.pointerId !== activePointerIdRef.current) return;
    if (!draggingRef.current && !resizingRef.current) return;
    const highlightStart = highlightStartRef.current;
    if (!highlightStart || !videoDisplayRect) return;

    const deltaX = (e.clientX - dragStartRef.current.x) / videoDisplayRect.scaleX;
    const deltaY = (e.clientY - dragStartRef.current.y) / videoDisplayRect.scaleY;

    let constrained;

    if (draggingRef.current) {
      constrained = constrainHighlight({
        ...highlightStart,
        x: highlightStart.x + deltaX,
        y: highlightStart.y + deltaY,
      });
    } else {
      // Delta-based resizing - much more intuitive
      let newRadiusX = highlightStart.radiusX;
      let newRadiusY = highlightStart.radiusY;

      if (resizeHandleRef.current === 'horizontal') {
        newRadiusX = highlightStart.radiusX + deltaX;
      } else if (resizeHandleRef.current === 'vertical') {
        newRadiusY = highlightStart.radiusY + deltaY;
      }

      constrained = constrainHighlight({
        ...highlightStart,
        radiusX: newRadiusX,
        radiusY: newRadiusY,
      });
    }

    if (constrained) {
      // Store in ref for pointer-up to use (avoids stale closure issues)
      latestHighlightRef.current = constrained;
      onHighlightChange(constrained);
    }
  };

  /**
   * Handle pointer up / cancel — commit the final geometry once.
   */
  const handlePointerUp = (e) => {
    if (e.pointerId !== activePointerIdRef.current) return;

    if (draggingRef.current || resizingRef.current) {
      // Use the ref which has the most recent highlight position, avoiding stale
      // closure issues where currentHighlight hasn't updated from the last move
      const finalHighlight = latestHighlightRef.current || currentHighlight;
      onHighlightComplete({
        x: round3(finalHighlight.x),
        y: round3(finalHighlight.y),
        radiusX: round3(finalHighlight.radiusX),
        radiusY: round3(finalHighlight.radiusY),
        strokeOpacity: finalHighlight.strokeOpacity,
        fillOpacity: finalHighlight.fillOpacity,
        color: finalHighlight.color
      });
    }

    activePointerIdRef.current = null;
    draggingRef.current = false;
    resizingRef.current = false;
    resizeHandleRef.current = null;
    highlightStartRef.current = null;
    latestHighlightRef.current = null;  // Clear the ref
  };

  // Reconcile ephemeral selection when the circle is no longer interactable (e.g.
  // the playhead leaves the region and the overlay stops rendering). Without this
  // the parent's selection would stay latched and keep the video tap-nav suppressed
  // even though no circle is visible. This is view-state reconciliation, NOT reactive
  // persistence — it writes no store/DB (see CLAUDE.md gesture-persistence rule).
  const shouldRender = isEnabled && currentHighlight && videoDisplayRect;
  useEffect(() => {
    if (!shouldRender && selected) setSelected(false);
  }, [shouldRender, selected, setSelected]);

  if (!shouldRender) {
    return null;
  }

  // Handles are draggable (and thus rendered) whenever direct manipulation is
  // available: desktop always, touch only once the circle is selected.
  const showHandles = !isCoarse || selected;
  const handleVisibleRadius = (isCoarse && selected)
    ? HANDLE_VISIBLE_RADIUS_TOUCH
    : HANDLE_VISIBLE_RADIUS_DESKTOP;
  const handleHitRadius = isCoarse ? HANDLE_HIT_RADIUS_TOUCH : HANDLE_VISIBLE_RADIUS_DESKTOP;

  // Apply ground spotlight transform: shift center to feet, flatten ellipse
  let displayX = currentHighlight.x;
  let displayY = currentHighlight.y;
  let displayRadiusX = currentHighlight.radiusX;
  let displayRadiusY = currentHighlight.radiusY;

  if (highlightShape === 'ground') {
    displayY = currentHighlight.y + currentHighlight.radiusY / 1.3;
    displayRadiusX = currentHighlight.radiusX * (2.0 / 1.3);
    displayRadiusY = currentHighlight.radiusY * 0.3;
  }

  // Convert highlight to screen coordinates. The shared transform returns
  // {x, y, width, height}; an ellipse's radii scale exactly like width/height.
  const s = videoToScreen(displayX, displayY, displayRadiusX, displayRadiusY);
  const screenHighlight = { x: s.x, y: s.y, radiusX: s.width, radiusY: s.height };

  const fillColor = currentHighlight.color || '#FFFFFF';
  const strokeColor = fillColor;
  const outlineColor = (() => {
    const hex = (fillColor || '#FFFFFF').replace('#', '');
    if (hex.length !== 6) return '#000000';
    const r = Math.round(parseInt(hex.slice(0, 2), 16) * 0.3);
    const g = Math.round(parseInt(hex.slice(2, 4), 16) * 0.3);
    const b = Math.round(parseInt(hex.slice(4, 6), 16) * 0.3);
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  })();

  // Calculate container dimensions for dark_overlay effect
  const containerWidth = videoDisplayRect.offsetX * 2 + videoDisplayRect.width;
  const containerHeight = videoDisplayRect.offsetY * 2 + videoDisplayRect.height;

  // Ground spotlight: bottom arc path (240°, skipping top 120° where player body is)
  const isGround = highlightShape === 'ground';
  const arcPath = isGround ? (() => {
    const cx = screenHighlight.x;
    const cy = screenHighlight.y;
    const rx = screenHighlight.radiusX;
    const ry = screenHighlight.radiusY;
    const startDeg = -30;
    const endDeg = 210;
    const startRad = (startDeg * Math.PI) / 180;
    const endRad = (endDeg * Math.PI) / 180;
    const x1 = cx + rx * Math.cos(startRad);
    const y1 = cy + ry * Math.sin(startRad);
    const x2 = cx + rx * Math.cos(endRad);
    const y2 = cy + ry * Math.sin(endRad);
    return `M ${x1} ${y1} A ${rx} ${ry} 0 1 1 ${x2} ${y2}`;
  })() : null;

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
      // Captured pointer events bubble here from the ellipse/handle even when the
      // finger/cursor leaves them, so the whole drag is handled in one place.
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Highlight ellipse using SVG */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <defs>
          <mask id="highlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <ellipse
              cx={screenHighlight.x}
              cy={screenHighlight.y}
              rx={screenHighlight.radiusX}
              ry={screenHighlight.radiusY}
              fill="black"
            />
          </mask>
        </defs>

        {/* Deselect backdrop (touch, while selected): a tap off the circle deselects
            and — because it captures the tap — keeps it off the video's play/seek
            tap-nav. Rendered first so the circle + handles sit on top of it. */}
        {isCoarse && selected && (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="transparent"
            className="pointer-events-auto"
            style={{ touchAction: 'none' }}
            data-testid="highlight-backdrop"
            onPointerDown={handleBackdropPointerDown}
          />
        )}

        {/* Dark overlay effect - dim everything outside the ellipse */}
        {effectType === HighlightEffect.DARK_OVERLAY && (
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="black"
            fillOpacity={dimStrength}
            mask="url(#highlight-mask)"
            className="pointer-events-none"
          />
        )}

        {/* Fill - full ellipse for ground (subtle glow pool), normal for body */}
        {(isGround || (fillEnabled && currentHighlight.color && currentHighlight.color !== 'none')) && (
          <ellipse
            cx={screenHighlight.x}
            cy={screenHighlight.y}
            rx={screenHighlight.radiusX}
            ry={screenHighlight.radiusY}
            fill={fillColor}
            fillOpacity={isGround ? (fillOpacity || 0.15) : (fillOpacity ?? currentHighlight.fillOpacity ?? 0.05)}
            className="pointer-events-none"
          />
        )}

        {/* Dark outline stroke (renders behind main stroke for contrast) */}
        {isGround ? (
          <path
            d={arcPath}
            fill="none"
            stroke={outlineColor}
            strokeWidth={strokeWidth + 2}
            strokeOpacity={0.5}
            strokeLinecap="round"
            className="pointer-events-none"
          />
        ) : (
          <ellipse
            cx={screenHighlight.x}
            cy={screenHighlight.y}
            rx={screenHighlight.radiusX}
            ry={screenHighlight.radiusY}
            fill="transparent"
            stroke={outlineColor}
            strokeWidth={strokeWidth + 2}
            strokeOpacity={0.5}
            className="pointer-events-none"
          />
        )}

        {/* Main colored stroke - arc for ground, full ellipse for body */}
        {isGround ? (
          <path
            d={arcPath}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={currentHighlight.strokeOpacity ?? 0.85}
            strokeLinecap="round"
            className="pointer-events-auto cursor-move"
            style={{ touchAction: 'none' }}
            data-testid="highlight-body"
            onPointerDown={handleEllipsePointerDown}
          />
        ) : (
          <ellipse
            cx={screenHighlight.x}
            cy={screenHighlight.y}
            rx={screenHighlight.radiusX}
            ry={screenHighlight.radiusY}
            fill="transparent"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeOpacity={currentHighlight.strokeOpacity ?? 0.85}
            className="pointer-events-auto cursor-move"
            style={{ touchAction: 'none' }}
            data-testid="highlight-body"
            onPointerDown={handleEllipsePointerDown}
          />
        )}

        {/* Resize handles — desktop always; touch only once selected. Each is a
            visible marker plus a >=44px invisible hit circle on coarse pointers. */}
        {showHandles && (
          <>
            {/* Horizontal resize handle (right edge) */}
            <circle
              cx={screenHighlight.x + screenHighlight.radiusX}
              cy={screenHighlight.y}
              r={handleVisibleRadius}
              fill="white"
              stroke={strokeColor}
              strokeWidth="2"
              className="pointer-events-none"
            />
            <circle
              cx={screenHighlight.x + screenHighlight.radiusX}
              cy={screenHighlight.y}
              r={handleHitRadius}
              fill="transparent"
              className="resize-handle pointer-events-auto cursor-ew-resize"
              style={{ touchAction: 'none' }}
              data-testid="highlight-handle-horizontal"
              onPointerDown={(e) => handleResizePointerDown(e, 'horizontal')}
            />

            {/* Vertical resize handle (bottom edge) */}
            <circle
              cx={screenHighlight.x}
              cy={screenHighlight.y + screenHighlight.radiusY}
              r={handleVisibleRadius}
              fill="white"
              stroke={strokeColor}
              strokeWidth="2"
              className="pointer-events-none"
            />
            <circle
              cx={screenHighlight.x}
              cy={screenHighlight.y + screenHighlight.radiusY}
              r={handleHitRadius}
              fill="transparent"
              className="resize-handle pointer-events-auto cursor-ns-resize"
              style={{ touchAction: 'none' }}
              data-testid="highlight-handle-vertical"
              onPointerDown={(e) => handleResizePointerDown(e, 'vertical')}
            />
          </>
        )}

        {/* Center indicator */}
        <circle
          cx={screenHighlight.x}
          cy={screenHighlight.y}
          r="3"
          fill="white"
          stroke={strokeColor}
          strokeWidth="1"
          className="pointer-events-none"
        />
      </svg>
    </div>
  );
}
