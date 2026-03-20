import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import versionInfo from '../../../version.json';

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
  panOffset = { x: 0, y: 0 },
  selectedKeyframeIndex = null,
  isFullscreen = false
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
  // useLayoutEffect ensures videoDisplayRect is calculated before paint,
  // so the crop rectangle is visible on first render (not delayed by useEffect).
  useLayoutEffect(() => {
    if (!videoRef?.current) return;

    const updateVideoRect = () => {
      const video = videoRef.current;
      if (!video) return;

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

    // When fullscreen changes, recalculate after layout settles
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(updateVideoRect);
    });

    return () => {
      window.removeEventListener('resize', updateVideoRect);
      cancelAnimationFrame(rafId);
    };
  }, [videoRef, videoMetadata, zoom, panOffset, isFullscreen]);

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
   * Constrain crop rectangle to video bounds while maintaining aspect ratio
   */
  const constrainCrop = useCallback((crop) => {
    const maxWidth = videoMetadata.width;
    const maxHeight = videoMetadata.height;

    let constrainedCrop = { ...crop };

    // First, ensure dimensions don't exceed video bounds
    if (aspectRatio !== 'free') {
      // Parse aspect ratio
      const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
      const ratio = ratioW / ratioH;

      // If crop exceeds bounds, scale it down while maintaining aspect ratio
      if (constrainedCrop.width > maxWidth || constrainedCrop.height > maxHeight) {
        // Calculate scale factor needed to fit within bounds
        const scaleX = maxWidth / constrainedCrop.width;
        const scaleY = maxHeight / constrainedCrop.height;
        const scale = Math.min(scaleX, scaleY);

        // Scale down proportionally
        constrainedCrop.width = constrainedCrop.width * scale;
        constrainedCrop.height = constrainedCrop.height * scale;

        // Ensure aspect ratio is maintained (due to rounding)
        constrainedCrop.height = constrainedCrop.width / ratio;
      }
    } else {
      // Free aspect ratio - constrain dimensions independently
      constrainedCrop.width = Math.max(10, Math.min(constrainedCrop.width, maxWidth));
      constrainedCrop.height = Math.max(10, Math.min(constrainedCrop.height, maxHeight));
    }

    // Ensure minimum size
    constrainedCrop.width = Math.max(10, constrainedCrop.width);
    constrainedCrop.height = Math.max(10, constrainedCrop.height);

    // Constrain position to keep crop within video bounds
    constrainedCrop.x = Math.max(0, Math.min(constrainedCrop.x, maxWidth - constrainedCrop.width));
    constrainedCrop.y = Math.max(0, Math.min(constrainedCrop.y, maxHeight - constrainedCrop.height));

    return {
      x: round3(constrainedCrop.x),
      y: round3(constrainedCrop.y),
      width: round3(constrainedCrop.width),
      height: round3(constrainedCrop.height)
    };
  }, [videoMetadata, aspectRatio]);

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
   * Get clientX/clientY from a pointer or touch event
   */
  const getEventPosition = (e) => {
    if (e.touches && e.touches.length > 0) {
      return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
    }
    return { clientX: e.clientX, clientY: e.clientY };
  };

  /**
   * Handle pointer/touch down on crop rectangle (start drag)
   */
  const handleCropPointerDown = (e) => {
    if (e.target.classList.contains('crop-handle')) return;

    e.preventDefault();
    e.stopPropagation();

    const pos = getEventPosition(e);
    setIsDragging(true);
    setDragStart({ x: pos.clientX, y: pos.clientY });
    setCropStart(currentCrop);
  };

  /**
   * Handle pointer/touch down on resize handle
   */
  const handleResizePointerDown = (e, handle) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = getEventPosition(e);
    setIsResizing(true);
    setResizeHandle(handle);
    setDragStart({ x: pos.clientX, y: pos.clientY });
    setCropStart(currentCrop);
  };

  /**
   * Handle pointer/touch move (drag or resize)
   */
  const handlePointerMove = useCallback((e) => {
    if (!isDragging && !isResizing) return;
    if (!cropStart || !videoDisplayRect) return;

    const pos = getEventPosition(e);
    const deltaX = (pos.clientX - dragStart.x) / videoDisplayRect.scaleX;
    const deltaY = (pos.clientY - dragStart.y) / videoDisplayRect.scaleY;

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
   * Handle pointer/touch up (end drag or resize)
   */
  const handlePointerUp = useCallback(() => {
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

  // Attach global pointer+touch handlers
  useEffect(() => {
    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handlePointerMove);
      window.addEventListener('mouseup', handlePointerUp);
      window.addEventListener('touchmove', handlePointerMove, { passive: false });
      window.addEventListener('touchend', handlePointerUp);

      return () => {
        window.removeEventListener('mousemove', handlePointerMove);
        window.removeEventListener('mouseup', handlePointerUp);
        window.removeEventListener('touchmove', handlePointerMove);
        window.removeEventListener('touchend', handlePointerUp);
      };
    }
  }, [isDragging, isResizing, handlePointerMove, handlePointerUp]);

  if (!currentCrop || !videoDisplayRect) {
    return null;
  }

  // Convert crop to screen coordinates
  const screenCrop = videoToScreen(currentCrop.x, currentCrop.y, currentCrop.width, currentCrop.height);

  /**
   * Check if crop size requires maximum 4x AI upscaling
   * Warns when crop is small enough that it would hit the 1440p limit with 4x upscaling.
   * This means we're using the full upscaling power - any smaller would be clamped.
   *
   * Backend clamps target to 1440p (2560x1440), so crops smaller than 640x360
   * will be upscaled at exactly 4x to reach the limit.
   */
  const isCropTooSmall = () => {
    const cropW = currentCrop.width;
    const cropH = currentCrop.height;

    // Backend clamps to 1440p max (2560x1440)
    // Crops smaller than 1440p/4 will use full 4x upscaling
    const maxW = 2560;
    const maxH = 1440;
    const minCropW = maxW / 4; // 640
    const minCropH = maxH / 4; // 360

    // Warn if BOTH dimensions are smaller than threshold (requires full 4x to reach 1440p)
    // Using AND because if one dimension is large, it won't need full 4x upscaling
    return cropW < minCropW && cropH < minCropH;
  };

  const cropTooSmall = isCropTooSmall();

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
          fill="rgba(0, 0, 0, 0.2)"
          mask="url(#cropMask)"
        />
      </svg>

      {/* Crop rectangle */}
      <div
        className={`absolute border-2 cursor-move pointer-events-auto ${cropTooSmall ? 'border-red-500' : 'border-white'}`}
        style={{
          left: `${screenCrop.x}px`,
          top: `${screenCrop.y}px`,
          width: `${screenCrop.width}px`,
          height: `${screenCrop.height}px`,
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.2)',
          touchAction: 'none'
        }}
        onMouseDown={handleCropPointerDown}
        onTouchStart={handleCropPointerDown}
      >
        {/* Grid lines */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line x1="33.33%" y1="0" x2="33.33%" y2="100%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="66.66%" y1="0" x2="66.66%" y2="100%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="0" y1="33.33%" x2="100%" y2="33.33%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
          <line x1="0" y1="66.66%" x2="100%" y2="66.66%" stroke="white" strokeOpacity="0.5" strokeWidth="1" />
        </svg>

        {/* Debug: Show crop size and position when keyframe is selected (only in development mode) */}
        {versionInfo.environment !== 'production' && selectedKeyframeIndex !== null && (
          <div
            className={`absolute left-1/2 transform -translate-x-1/2 bg-black/75 px-2 py-1 rounded text-sm font-mono pointer-events-none whitespace-nowrap ${cropTooSmall ? 'text-red-400' : 'text-yellow-300'}`}
            style={{ top: '-28px' }}
            title={`Crop: ${Math.round(currentCrop.width)}x${Math.round(currentCrop.height)} at position (${Math.round(currentCrop.x)}, ${Math.round(currentCrop.y)})${cropTooSmall ? ' (Too small for optimal 4x upscale)' : ''}`}
          >
            {Math.round(currentCrop.width)}x{Math.round(currentCrop.height)} @ ({Math.round(currentCrop.x)}, {Math.round(currentCrop.y)})
            {cropTooSmall && ' ⚠️'}
          </div>
        )}

        {/* Warning: Show when crop is too small for optimal 4x upscale */}
        {cropTooSmall && (
          <div
            className="absolute left-1/2 transform -translate-x-1/2 bg-red-900/90 text-red-100 px-3 py-1.5 rounded text-xs font-medium pointer-events-none whitespace-nowrap"
            style={{ bottom: '-32px' }}
            title="AI upscaler works best with 4x scaling. Current crop will require more than 4x upscale."
          >
            ⚠️ sub-optimal upscale
          </div>
        )}

        {/* Resize handles — 12px visual, 44px touch target on mobile via ::after */}
        {handles.map(handle => (
          <div
            key={handle.name}
            className={`crop-handle absolute bg-white border-2 pointer-events-auto ${cropTooSmall ? 'border-red-500' : 'border-blue-500'} after:content-[''] after:absolute after:-inset-4 after:block sm:after:inset-0`}
            style={{
              width: '12px',
              height: '12px',
              left: `${handle.x * 100}%`,
              top: `${handle.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              cursor: handle.cursor,
              zIndex: 10,
              touchAction: 'none'
            }}
            onMouseDown={(e) => handleResizePointerDown(e, handle.name)}
            onTouchStart={(e) => handleResizePointerDown(e, handle.name)}
          />
        ))}
      </div>
    </div>
  );
}
