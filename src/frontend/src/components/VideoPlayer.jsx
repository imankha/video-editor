import React, { useState, useRef, useCallback } from 'react';

/**
 * VideoPlayer component - Displays the video element with zoom and pan support
 *
 * This component is overlay-agnostic - modes pass their own overlays as children.
 *
 * @param {Object} props
 * @param {React.RefObject} props.videoRef - Ref to video element
 * @param {string} props.videoUrl - Video source URL
 * @param {Object} props.handlers - Video element event handlers
 * @param {Function} props.onFileSelect - Callback for file upload via drag-and-drop
 * @param {React.ReactNode[]} props.overlays - Array of overlay components to render over video
 * @param {number} props.zoom - Zoom level (1 = 100%)
 * @param {Object} props.panOffset - Pan offset {x, y}
 * @param {Function} props.onZoomChange - Callback when zoom changes (wheel)
 * @param {Function} props.onPanChange - Callback when pan changes (drag)
 * @param {boolean} props.isFullscreen - Whether the player is in fullscreen mode
 * @param {number|null} props.clipRating - Rating (1-5) of clip at current time, null if not in clip
 */
export function VideoPlayer({
  videoRef,
  videoUrl,
  handlers,
  onFileSelect,
  overlays = [],
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  onZoomChange,
  onPanChange,
  isFullscreen = false,
  clipRating = null
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

  // Setup wheel event listener with passive: false to allow preventDefault
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const wheelHandler = (e) => {
      // Only zoom if video is loaded and mouse is over the container
      if (!videoUrl || !onZoomChange) {
        return;
      }

      // Prevent default scrolling behavior
      e.preventDefault();
      e.stopPropagation();

      // Call zoom handler with NEGATIVE delta (reversed direction)
      // Scroll up (negative deltaY) = zoom in
      onZoomChange(-e.deltaY);
    };

    // Add listener with passive: false to allow preventDefault
    container.addEventListener('wheel', wheelHandler, { passive: false });

    return () => {
      container.removeEventListener('wheel', wheelHandler);
    };
  }, [videoUrl, onZoomChange]);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Validate file type
      if (file.type.startsWith('video/')) {
        onFileSelect?.(file);
      }
    }
  };

  /**
   * Handle mouse down for panning
   */
  const handleMouseDown = useCallback((e) => {
    // Only pan if zoomed
    if (zoom === 1) return;

    // Check if clicking on video (not controls or crop handles)
    if (e.target.tagName === 'VIDEO' || e.target.closest('.video-container')) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  }, [zoom]);

  /**
   * Handle mouse move for panning
   */
  const handleMouseMove = useCallback((e) => {
    if (!isPanning || !onPanChange) return;

    const deltaX = e.clientX - panStart.x;
    const deltaY = e.clientY - panStart.y;

    onPanChange(deltaX, deltaY);
    setPanStart({ x: e.clientX, y: e.clientY });
  }, [isPanning, panStart, onPanChange]);

  /**
   * Handle mouse up for panning
   */
  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Attach global mouse handlers for panning
  React.useEffect(() => {
    if (isPanning) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isPanning, handleMouseMove, handleMouseUp]);

  return (
    <div
      ref={containerRef}
      className={`video-player-container rounded-t-lg overflow-hidden relative outline-none ${
        isFullscreen ? 'w-full h-full' : 'min-h-[60vh]'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onMouseDown={handleMouseDown}
      style={{ cursor: isPanning ? 'grabbing' : (zoom > 1 ? 'grab' : 'default') }}
    >
      {videoUrl ? (
        <div className={`relative video-container overflow-hidden ${
          isFullscreen ? 'w-full h-full' : 'h-[60vh]'
        }`}>
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.1s ease-out'
            }}
          >
            <video
              ref={videoRef}
              src={videoUrl}
              className={`object-contain ${
                isFullscreen ? 'w-full h-full' : 'max-w-full max-h-full'
              }`}
              onTimeUpdate={handlers.onTimeUpdate}
              onPlay={handlers.onPlay}
              onPause={handlers.onPause}
              onSeeking={handlers.onSeeking}
              onSeeked={handlers.onSeeked}
              onLoadedMetadata={handlers.onLoadedMetadata}
              preload="auto"
              style={{ pointerEvents: 'none' }}
            />
          </div>

          {/* Render any overlays passed by the mode */}
          {overlays}

          {/* Rating-based border overlay when inside a clip region */}
          {clipRating !== null && (() => {
            // Rating-based border colors:
            // 1 star = red, 2 star = yellow, 3 star = blue, 4 star = dark green, 5 star = light green
            const ratingBorderColors = {
              1: 'border-red-500',
              2: 'border-yellow-500',
              3: 'border-blue-500',
              4: 'border-green-600',
              5: 'border-green-400'
            };
            const borderColor = ratingBorderColors[clipRating] || 'border-orange-500';
            return (
              <div
                className={`absolute inset-0 pointer-events-none z-40 ${borderColor} ${
                  isFullscreen ? 'border-8' : 'border-4 rounded-lg'
                }`}
              />
            );
          })()}
        </div>
      ) : (
        <div
          className={`flex items-center justify-center h-[60vh] text-gray-400 transition-colors ${
            isDragging ? 'bg-blue-600/20 border-2 border-blue-500 border-dashed' : ''
          }`}
        >
          <div className="text-center">
            <svg
              className={`mx-auto h-12 w-12 ${isDragging ? 'text-blue-400' : 'text-gray-400'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p className="mt-2 text-sm">
              {isDragging ? 'Drop video here' : 'No video loaded'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {isDragging ? 'Release to upload' : 'Drag and drop a video or upload to get started'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
