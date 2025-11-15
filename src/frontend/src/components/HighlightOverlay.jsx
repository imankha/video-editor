import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * HighlightOverlay component - renders a draggable/resizable highlight circle
 * over the video player to indicate the highlighted player
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
  const videoToScreen = useCallback((x, y, radius) => {
    if (!videoDisplayRect) return { x: 0, y: 0, radius: 0 };

    return {
      x: x * videoDisplayRect.scaleX + videoDisplayRect.offsetX,
      y: y * videoDisplayRect.scaleY + videoDisplayRect.offsetY,
      radius: radius * videoDisplayRect.scaleY // Use Y scale for radius to maintain circle
    };
  }, [videoDisplayRect]);

  const round3 = (value) => Math.round(value * 1000) / 1000;

  /**
   * Convert screen coordinates to video coordinates
   */
  const screenToVideo = useCallback((x, y, radius) => {
    if (!videoDisplayRect) return { x: 0, y: 0, radius: 0 };

    return {
      x: round3((x - videoDisplayRect.offsetX) / videoDisplayRect.scaleX),
      y: round3((y - videoDisplayRect.offsetY) / videoDisplayRect.scaleY),
      radius: round3(radius / videoDisplayRect.scaleY)
    };
  }, [videoDisplayRect]);

  /**
   * Constrain highlight circle to video bounds
   */
  const constrainHighlight = useCallback((highlight) => {
    const maxWidth = videoMetadata.width;
    const maxHeight = videoMetadata.height;

    let constrained = { ...highlight };

    // Ensure minimum radius
    constrained.radius = Math.max(10, constrained.radius);

    // Constrain center position to keep circle within video bounds
    const minX = constrained.radius;
    const maxX = maxWidth - constrained.radius;
    const minY = constrained.radius;
    const maxY = maxHeight - constrained.radius;

    constrained.x = Math.max(minX, Math.min(constrained.x, maxX));
    constrained.y = Math.max(minY, Math.min(constrained.y, maxY));

    // If radius is too large, reduce it
    if (constrained.radius > maxWidth / 2) {
      constrained.radius = maxWidth / 2;
    }
    if (constrained.radius > maxHeight / 2) {
      constrained.radius = maxHeight / 2;
    }

    return {
      x: round3(constrained.x),
      y: round3(constrained.y),
      radius: round3(constrained.radius),
      opacity: constrained.opacity,
      color: constrained.color
    };
  }, [videoMetadata]);

  /**
   * Handle mouse down on highlight circle (start drag)
   */
  const handleCircleMouseDown = (e) => {
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
  const handleResizeMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    setIsResizing(true);
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
      // Calculate new radius based on distance from center
      const centerScreenX = highlightStart.x * videoDisplayRect.scaleX + videoDisplayRect.offsetX;
      const centerScreenY = highlightStart.y * videoDisplayRect.scaleY + videoDisplayRect.offsetY;

      const distanceToMouse = Math.sqrt(
        Math.pow(e.clientX - centerScreenX, 2) +
        Math.pow(e.clientY - centerScreenY, 2)
      );

      const newRadius = distanceToMouse / videoDisplayRect.scaleY;

      const newHighlight = {
        ...highlightStart,
        radius: newRadius
      };

      const constrained = constrainHighlight(newHighlight);
      onHighlightChange(constrained);
    }
  }, [isDragging, isResizing, highlightStart, dragStart, videoDisplayRect, constrainHighlight, onHighlightChange]);

  /**
   * Handle mouse up
   */
  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      onHighlightComplete({
        x: round3(currentHighlight.x),
        y: round3(currentHighlight.y),
        radius: round3(currentHighlight.radius),
        opacity: currentHighlight.opacity,
        color: currentHighlight.color
      });
    }

    setIsDragging(false);
    setIsResizing(false);
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
  const screenHighlight = videoToScreen(currentHighlight.x, currentHighlight.y, currentHighlight.radius);

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
      {/* Highlight circle using SVG */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Main highlight circle */}
        <circle
          cx={screenHighlight.x}
          cy={screenHighlight.y}
          r={screenHighlight.radius}
          fill={fillColor}
          fillOpacity={currentHighlight.opacity}
          stroke={strokeColor}
          strokeWidth="3"
          strokeOpacity="0.8"
          className="pointer-events-auto cursor-move"
          onMouseDown={handleCircleMouseDown}
        />

        {/* Resize handle - small circle on the edge */}
        <circle
          cx={screenHighlight.x + screenHighlight.radius}
          cy={screenHighlight.y}
          r="8"
          fill="white"
          stroke={strokeColor}
          strokeWidth="2"
          className="resize-handle pointer-events-auto cursor-nwse-resize"
          onMouseDown={handleResizeMouseDown}
        />

        {/* Center indicator */}
        <circle
          cx={screenHighlight.x}
          cy={screenHighlight.y}
          r="4"
          fill="white"
          stroke={strokeColor}
          strokeWidth="2"
          className="pointer-events-none"
        />
      </svg>
    </div>
  );
}
