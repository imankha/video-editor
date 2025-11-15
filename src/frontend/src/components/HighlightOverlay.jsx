import { useState, useRef, useEffect, useCallback } from 'react';

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
  zoom = 1,
  panOffset = { x: 0, y: 0 }
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null); // 'horizontal' or 'vertical'
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [highlightStart, setHighlightStart] = useState(null);
  const overlayRef = useRef(null);

  const [videoDisplayRect, setVideoDisplayRect] = useState(null);

  /**
   * Update video display dimensions when video size changes
   */
  useEffect(() => {
    if (!videoRef?.current) return;

    const updateVideoRect = () => {
      const video = videoRef.current;
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

    return () => window.removeEventListener('resize', updateVideoRect);
  }, [videoRef, videoMetadata, zoom, panOffset]);

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
      opacity: constrained.opacity,
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

    if (isDragging) {
      const newHighlight = {
        ...highlightStart,
        x: highlightStart.x + deltaX,
        y: highlightStart.y + deltaY
      };

      const constrained = constrainHighlight(newHighlight);
      onHighlightChange(constrained);
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

      const constrained = constrainHighlight(newHighlight);
      onHighlightChange(constrained);
    }
  }, [isDragging, isResizing, resizeHandle, highlightStart, dragStart, videoDisplayRect, constrainHighlight, onHighlightChange]);

  /**
   * Handle mouse up
   */
  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      onHighlightComplete({
        x: round3(currentHighlight.x),
        y: round3(currentHighlight.y),
        radiusX: round3(currentHighlight.radiusX),
        radiusY: round3(currentHighlight.radiusY),
        opacity: currentHighlight.opacity,
        color: currentHighlight.color
      });
    }

    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setHighlightStart(null);
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

  // Convert highlight to screen coordinates
  const screenHighlight = videoToScreen(
    currentHighlight.x,
    currentHighlight.y,
    currentHighlight.radiusX,
    currentHighlight.radiusY
  );

  // Parse color for fill and stroke
  const fillColor = currentHighlight.color || '#FFFF00';
  const strokeColor = fillColor;

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
        {/* Main highlight ellipse */}
        <ellipse
          cx={screenHighlight.x}
          cy={screenHighlight.y}
          rx={screenHighlight.radiusX}
          ry={screenHighlight.radiusY}
          fill={fillColor}
          fillOpacity={currentHighlight.opacity}
          stroke={strokeColor}
          strokeWidth="3"
          strokeOpacity="0.6"
          className="pointer-events-auto cursor-move"
          onMouseDown={handleEllipseMouseDown}
        />

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
