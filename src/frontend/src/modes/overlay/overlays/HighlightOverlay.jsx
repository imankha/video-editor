import { useState, useRef, useEffect, useCallback } from 'react';
import { HighlightEffect } from '../../../constants/highlightEffects';

/**
 * HighlightOverlay component - renders a draggable/resizable highlight ellipse
 * over the video player to indicate the highlighted player
 * Uses a vertical ellipse (taller than wide) for upright players
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
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null); // 'horizontal' or 'vertical'
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [highlightStart, setHighlightStart] = useState(null);
  const overlayRef = useRef(null);

  // Ref to track the latest highlight during drag/resize
  // This ensures handleMouseUp always has the most recent position,
  // even if React hasn't re-rendered yet after the last mouse move
  const latestHighlightRef = useRef(null);

  const [videoDisplayRect, setVideoDisplayRect] = useState(null);

  /**
   * Update video display dimensions when video size changes
   */
  useEffect(() => {
    if (!videoRef?.current) return;

    const video = videoRef.current;

    const updateVideoRect = () => {
      const videoAspect = videoMetadata.width / videoMetadata.height;

      const container = video.closest('.video-container');
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      const containerAspect = containerWidth / containerHeight;

      let baseDisplayWidth, baseDisplayHeight;

      if (containerAspect > videoAspect) {
        baseDisplayHeight = containerHeight;
        baseDisplayWidth = baseDisplayHeight * videoAspect;
      } else {
        baseDisplayWidth = containerWidth;
        baseDisplayHeight = baseDisplayWidth / videoAspect;
      }

      const displayWidth = baseDisplayWidth * zoom;
      const displayHeight = baseDisplayHeight * zoom;

      const videoOffsetX = (containerWidth - displayWidth) / 2 + panOffset.x;
      const videoOffsetY = (containerHeight - displayHeight) / 2 + panOffset.y;

      setVideoDisplayRect({
        offsetX: videoOffsetX,
        offsetY: videoOffsetY,
        width: displayWidth,
        height: displayHeight,
        scaleX: displayWidth / videoMetadata.width,
        scaleY: displayHeight / videoMetadata.height,
        zoom: zoom,
        panOffset: panOffset
      });
    };

    updateVideoRect();
    window.addEventListener('resize', updateVideoRect);

    // Double RAF ensures layout settles after fullscreen toggle.
    // Track both frame IDs so cleanup cancels the inner one too.
    let innerRafId;
    const outerRafId = requestAnimationFrame(() => {
      innerRafId = requestAnimationFrame(updateVideoRect);
    });

    return () => {
      window.removeEventListener('resize', updateVideoRect);
      cancelAnimationFrame(outerRafId);
      cancelAnimationFrame(innerRafId);
    };
  }, [videoRef, videoMetadata, zoom, panOffset, isFullscreen]);

  /**
   * Convert video coordinates to screen coordinates
   */
  const videoToScreen = useCallback((x, y, radiusX, radiusY) => {
    if (!videoDisplayRect) return { x: 0, y: 0, radiusX: 0, radiusY: 0 };

    return {
      x: x * videoDisplayRect.scaleX + videoDisplayRect.offsetX,
      y: y * videoDisplayRect.scaleY + videoDisplayRect.offsetY,
      radiusX: radiusX * videoDisplayRect.scaleX,
      radiusY: radiusY * videoDisplayRect.scaleY
    };
  }, [videoDisplayRect]);

  const round3 = (value) => Math.round(value * 1000) / 1000;

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
   * Handle mouse down on highlight ellipse (start drag)
   */
  const handleEllipseMouseDown = (e) => {
    if (e.target.classList.contains('resize-handle')) return;

    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setHighlightStart(currentHighlight);
  };

  /**
   * Handle mouse down on resize handle
   */
  const handleResizeMouseDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
    setResizeHandle(handle);
    setDragStart({ x: e.clientX, y: e.clientY });
    setHighlightStart(currentHighlight);
  };

  /**
   * Handle mouse move (drag or resize)
   */
  const handleMouseMove = useCallback((e) => {
    if (!isDragging && !isResizing) return;
    if (!highlightStart || !videoDisplayRect) return;

    const deltaX = (e.clientX - dragStart.x) / videoDisplayRect.scaleX;
    const deltaY = (e.clientY - dragStart.y) / videoDisplayRect.scaleY;

    let constrained;

    if (isDragging) {
      const newHighlight = {
        ...highlightStart,
        x: highlightStart.x + deltaX,
        y: highlightStart.y + deltaY
      };

      constrained = constrainHighlight(newHighlight);
    } else if (isResizing) {
      // Delta-based resizing - much more intuitive
      let newRadiusX = highlightStart.radiusX;
      let newRadiusY = highlightStart.radiusY;

      if (resizeHandle === 'horizontal') {
        // Horizontal handle - adjust radiusX
        newRadiusX = highlightStart.radiusX + deltaX;
      } else if (resizeHandle === 'vertical') {
        // Vertical handle - adjust radiusY
        newRadiusY = highlightStart.radiusY + deltaY;
      }

      const newHighlight = {
        ...highlightStart,
        radiusX: newRadiusX,
        radiusY: newRadiusY
      };

      constrained = constrainHighlight(newHighlight);
    }

    if (constrained) {
      // Store in ref for handleMouseUp to use (avoids stale closure issues)
      latestHighlightRef.current = constrained;
      onHighlightChange(constrained);
    }
  }, [isDragging, isResizing, resizeHandle, highlightStart, dragStart, videoDisplayRect, constrainHighlight, onHighlightChange]);

  /**
   * Handle mouse up
   */
  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      // Use the ref which has the most recent highlight position
      // This avoids stale closure issues where currentHighlight prop
      // hasn't updated yet from the last mouse move
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

    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setHighlightStart(null);
    latestHighlightRef.current = null;  // Clear the ref
  }, [isDragging, isResizing, currentHighlight, onHighlightComplete]);

  // Attach global mouse handlers
  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, isResizing, handleMouseMove, handleMouseUp]);

  if (!isEnabled || !currentHighlight || !videoDisplayRect) {
    return null;
  }

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

  // Convert highlight to screen coordinates
  const screenHighlight = videoToScreen(
    displayX,
    displayY,
    displayRadiusX,
    displayRadiusY
  );

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
    const startDeg = -60;
    const endDeg = 240;
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
            onMouseDown={handleEllipseMouseDown}
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
            onMouseDown={handleEllipseMouseDown}
          />
        )}

        {/* Horizontal resize handle (right edge) */}
        <circle
          cx={screenHighlight.x + screenHighlight.radiusX}
          cy={screenHighlight.y}
          r="7"
          fill="white"
          stroke={strokeColor}
          strokeWidth="2"
          className="resize-handle pointer-events-auto cursor-ew-resize"
          onMouseDown={(e) => handleResizeMouseDown(e, 'horizontal')}
        />

        {/* Vertical resize handle (bottom edge) */}
        <circle
          cx={screenHighlight.x}
          cy={screenHighlight.y + screenHighlight.radiusY}
          r="7"
          fill="white"
          stroke={strokeColor}
          strokeWidth="2"
          className="resize-handle pointer-events-auto cursor-ns-resize"
          onMouseDown={(e) => handleResizeMouseDown(e, 'vertical')}
        />

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
