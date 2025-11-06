import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * CropOverlay component - renders a draggable/resizable crop rectangle
 * over the video player with 8 resize handles
 */
export default function CropOverlay({
  videoRef,
  videoMetadata,
  currentCrop,
  aspectRatio,
  onCropChange,
  onCropComplete,
  zoom = 1,
  panOffset = { x: 0, y: 0 }
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropStart, setCropStart] = useState(null);
  const overlayRef = useRef(null);

  // Video element dimensions on screen (scaled)
  const [videoDisplayRect, setVideoDisplayRect] = useState(null);

  /**
   * Update video display dimensions when video size changes or zoom/pan changes
   */
  useEffect(() => {
    if (!videoRef?.current) return;

    const updateVideoRect = () => {
      const video = videoRef.current;
      const rect = video.getBoundingClientRect();

      // The video element's natural dimensions
      const videoAspect = videoMetadata.width / videoMetadata.height;

      // Get the container (parent of video)
      const container = video.closest('.video-container');
      if (!container) return;

      const containerRect = container.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const containerHeight = containerRect.height;
      const containerAspect = containerWidth / containerHeight;

      let baseDisplayWidth, baseDisplayHeight;

      if (containerAspect > videoAspect) {
        // Container is wider - video is constrained by height
        baseDisplayHeight = containerHeight;
        baseDisplayWidth = baseDisplayHeight * videoAspect;
      } else {
        // Container is taller - video is constrained by width
        baseDisplayWidth = containerWidth;
        baseDisplayHeight = baseDisplayWidth / videoAspect;
      }

      // Apply zoom to dimensions
      const displayWidth = baseDisplayWidth * zoom;
      const displayHeight = baseDisplayHeight * zoom;

      // Calculate center position of container
      const containerCenterX = containerRect.left + containerWidth / 2;
      const containerCenterY = containerRect.top + containerHeight / 2;

      // Calculate video position accounting for zoom and pan
      const videoLeft = containerCenterX - (displayWidth / 2) + panOffset.x;
      const videoTop = containerCenterY - (displayHeight / 2) + panOffset.y;

      // Calculate video position relative to container (not screen)
      const videoOffsetX = (containerWidth - displayWidth) / 2 + panOffset.x;
      const videoOffsetY = (containerHeight - displayHeight) / 2 + panOffset.y;

      console.log('[CropOverlay] Video display rect:', {
        containerWidth,
        containerHeight,
        displayWidth,
        displayHeight,
        videoOffsetX,
        videoOffsetY,
        zoom,
        panOffset
      });

      setVideoDisplayRect({
        left: videoLeft,
        top: videoTop,
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
   * Convert video coordinates to screen coordinates (relative to container)
   */
  const videoToScreen = useCallback((x, y, width, height) => {
    if (!videoDisplayRect) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: x * videoDisplayRect.scaleX + videoDisplayRect.offsetX,
      y: y * videoDisplayRect.scaleY + videoDisplayRect.offsetY,
      width: width * videoDisplayRect.scaleX,
      height: height * videoDisplayRect.scaleY
    };
  }, [videoDisplayRect]);

  /**
   * Round to 3 decimal places for precision
   */
  const round3 = (value) => Math.round(value * 1000) / 1000;

  /**
   * Convert screen coordinates (relative to container) to video coordinates
   */
  const screenToVideo = useCallback((x, y, width, height) => {
    if (!videoDisplayRect) return { x: 0, y: 0, width: 0, height: 0 };

    return {
      x: round3((x - videoDisplayRect.offsetX) / videoDisplayRect.scaleX),
      y: round3((y - videoDisplayRect.offsetY) / videoDisplayRect.scaleY),
      width: round3(width / videoDisplayRect.scaleX),
      height: round3(height / videoDisplayRect.scaleY)
    };
  }, [videoDisplayRect]);

  /**
   * Constrain crop rectangle to video bounds
   */
  const constrainCrop = useCallback((crop) => {
    const maxWidth = videoMetadata.width;
    const maxHeight = videoMetadata.height;

    return {
      x: round3(Math.max(0, Math.min(crop.x, maxWidth - crop.width))),
      y: round3(Math.max(0, Math.min(crop.y, maxHeight - crop.height))),
      width: round3(Math.max(10, Math.min(crop.width, maxWidth))),
      height: round3(Math.max(10, Math.min(crop.height, maxHeight)))
    };
  }, [videoMetadata]);

  /**
   * Apply aspect ratio constraint to dimensions
   */
  const applyAspectRatio = useCallback((width, height, handle) => {
    if (aspectRatio === 'free') {
      return { width: round3(width), height: round3(height) };
    }

    const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
    const ratio = ratioW / ratioH;

    // Determine which dimension to constrain based on resize handle
    if (handle && (handle.includes('e') || handle.includes('w'))) {
      // Horizontal resize - adjust height
      height = width / ratio;
    } else if (handle && (handle.includes('n') || handle.includes('s'))) {
      // Vertical resize - adjust width
      width = height * ratio;
    } else {
      // Corner resize - maintain ratio, use smaller dimension
      const currentRatio = width / height;
      if (currentRatio > ratio) {
        width = height * ratio;
      } else {
        height = width / ratio;
      }
    }

    return { width: round3(width), height: round3(height) };
  }, [aspectRatio]);

  /**
   * Handle mouse down on crop rectangle (start drag)
   */
  const handleCropMouseDown = (e) => {
    if (e.target.classList.contains('crop-handle')) return;

    e.preventDefault();
    e.stopPropagation();

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setCropStart(currentCrop);
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
    setCropStart(currentCrop);
  };

  /**
   * Handle mouse move (drag or resize)
   */
  const handleMouseMove = useCallback((e) => {
    if (!isDragging && !isResizing) return;
    if (!cropStart || !videoDisplayRect) return;

    const deltaX = (e.clientX - dragStart.x) / videoDisplayRect.scaleX;
    const deltaY = (e.clientY - dragStart.y) / videoDisplayRect.scaleY;

    if (isDragging) {
      // Move crop rectangle
      const newCrop = {
        x: cropStart.x + deltaX,
        y: cropStart.y + deltaY,
        width: cropStart.width,
        height: cropStart.height
      };

      const constrained = constrainCrop(newCrop);
      onCropChange(constrained);
    } else if (isResizing) {
      // Resize crop rectangle
      let newCrop = { ...cropStart };

      if (resizeHandle.includes('n')) {
        newCrop.y = cropStart.y + deltaY;
        newCrop.height = cropStart.height - deltaY;
      }
      if (resizeHandle.includes('s')) {
        newCrop.height = cropStart.height + deltaY;
      }
      if (resizeHandle.includes('w')) {
        newCrop.x = cropStart.x + deltaX;
        newCrop.width = cropStart.width - deltaX;
      }
      if (resizeHandle.includes('e')) {
        newCrop.width = cropStart.width + deltaX;
      }

      // Apply aspect ratio constraint
      const sized = applyAspectRatio(newCrop.width, newCrop.height, resizeHandle);
      newCrop.width = sized.width;
      newCrop.height = sized.height;

      // Adjust position for top/left resizes to maintain opposite corner
      if (resizeHandle.includes('n')) {
        newCrop.y = cropStart.y + cropStart.height - newCrop.height;
      }
      if (resizeHandle.includes('w')) {
        newCrop.x = cropStart.x + cropStart.width - newCrop.width;
      }

      const constrained = constrainCrop(newCrop);
      onCropChange(constrained);
    }
  }, [isDragging, isResizing, cropStart, dragStart, resizeHandle, videoDisplayRect, constrainCrop, applyAspectRatio, onCropChange]);

  /**
   * Handle mouse up (end drag or resize)
   */
  const handleMouseUp = useCallback(() => {
    if (isDragging || isResizing) {
      // Notify parent that crop change is complete (create keyframe)
      // IMPORTANT: Only emit spatial properties (x, y, width, height)
      // Do NOT include 'time' - that's managed at the App level
      // Round to 3 decimal places to ensure sync with backend
      onCropComplete({
        x: round3(currentCrop.x),
        y: round3(currentCrop.y),
        width: round3(currentCrop.width),
        height: round3(currentCrop.height)
      });
    }

    setIsDragging(false);
    setIsResizing(false);
    setResizeHandle(null);
    setCropStart(null);
  }, [isDragging, isResizing, currentCrop, onCropComplete]);

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

  if (!currentCrop || !videoDisplayRect) {
    return null;
  }

  // Convert crop to screen coordinates
  const screenCrop = videoToScreen(currentCrop.x, currentCrop.y, currentCrop.width, currentCrop.height);

  const handles = [
    { name: 'nw', cursor: 'nw-resize', x: 0, y: 0 },
    { name: 'n', cursor: 'n-resize', x: 0.5, y: 0 },
    { name: 'ne', cursor: 'ne-resize', x: 1, y: 0 },
    { name: 'e', cursor: 'e-resize', x: 1, y: 0.5 },
    { name: 'se', cursor: 'se-resize', x: 1, y: 1 },
    { name: 's', cursor: 's-resize', x: 0.5, y: 1 },
    { name: 'sw', cursor: 'sw-resize', x: 0, y: 1 },
    { name: 'w', cursor: 'w-resize', x: 0, y: 0.5 }
  ];

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
      {/* Dimmed overlay outside crop area */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <defs>
          <mask id="cropMask">
            <rect width="100%" height="100%" fill="white" />
            <rect
              x={screenCrop.x}
              y={screenCrop.y}
              width={screenCrop.width}
              height={screenCrop.height}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.5)"
          mask="url(#cropMask)"
        />
      </svg>

      {/* Crop rectangle */}
      <div
        className="absolute border-2 border-white cursor-move pointer-events-auto"
        style={{
          left: `${screenCrop.x}px`,
          top: `${screenCrop.y}px`,
          width: `${screenCrop.width}px`,
          height: `${screenCrop.height}px`,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)'
        }}
        onMouseDown={handleCropMouseDown}
      >
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line x1="33.33%" y1="0" x2="33.33%" y2="100%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="66.66%" y1="0" x2="66.66%" y2="100%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="0" y1="33.33%" x2="100%" y2="33.33%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="0" y1="66.66%" x2="100%" y2="66.66%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
        </svg>

        {/* Resize handles */}
        {handles.map(handle => (
          <div
            key={handle.name}
            className="crop-handle absolute bg-white border-2 border-blue-500 pointer-events-auto"
            style={{
              width: '12px',
              height: '12px',
              left: `${handle.x * 100}%`,
              top: `${handle.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              cursor: handle.cursor,
              zIndex: 10
            }}
            onMouseDown={(e) => handleResizeMouseDown(e, handle.name)}
          />
        ))}
      </div>
    </div>
  );
}
