import React, { useState, useRef, useCallback } from 'react';
import CropOverlay from './CropOverlay';

/**
 * VideoPlayer component - Displays the video element with zoom and pan support
 * @param {Object} props
 * @param {React.RefObject} props.videoRef - Ref to video element
 * @param {string} props.videoUrl - Video source URL
 * @param {Object} props.handlers - Video element event handlers
 * @param {Function} props.onFileSelect - Callback for file upload via drag-and-drop
 * @param {Object} props.videoMetadata - Video metadata (width, height, duration)
 * @param {boolean} props.showCropOverlay - Whether to show crop overlay
 * @param {Object} props.currentCrop - Current crop rectangle data
 * @param {string} props.aspectRatio - Aspect ratio for crop
 * @param {Function} props.onCropChange - Callback when crop changes
 * @param {Function} props.onCropComplete - Callback when crop change is complete
 * @param {number} props.zoom - Zoom level (1 = 100%)
 * @param {Object} props.panOffset - Pan offset {x, y}
 * @param {Function} props.onZoomChange - Callback when zoom changes (wheel)
 * @param {Function} props.onPanChange - Callback when pan changes (drag)
 */
export function VideoPlayer({
  videoRef,
  videoUrl,
  handlers,
  onFileSelect,
  videoMetadata,
  showCropOverlay = false,
  currentCrop,
  aspectRatio,
  onCropChange,
  onCropComplete,
  zoom = 1,
  panOffset = { x: 0, y: 0 },
  onZoomChange,
  onPanChange
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);

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
   * Handle mouse wheel for zoom
   */
  const handleWheel = useCallback((e) => {
    if (!videoUrl || !onZoomChange) return;

    e.preventDefault();

    // Get mouse position relative to container
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Calculate focal point in container space
    const focalPoint = {
      x: mouseX - rect.width / 2,
      y: mouseY - rect.height / 2
    };

    // Call zoom handler with delta and focal point
    onZoomChange(e.deltaY, focalPoint);
  }, [videoUrl, onZoomChange]);

  /**
   * Handle mouse down for panning
   */
  const handleMouseDown = useCallback((e) => {
    // Only pan if zoomed and not clicking on crop overlay
    if (zoom === 1 || showCropOverlay) return;

    // Check if clicking on video (not controls)
    if (e.target.tagName === 'VIDEO' || e.target.closest('.video-container')) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY });
    }
  }, [zoom, showCropOverlay]);

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
      className="video-player-container bg-black rounded-lg overflow-hidden min-h-[60vh] relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      style={{ cursor: isPanning ? 'grabbing' : (zoom > 1 && !showCropOverlay ? 'grab' : 'default') }}
    >
      {videoUrl ? (
        <div className="relative video-container h-[60vh] overflow-hidden">
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
              className="max-w-full max-h-full object-contain"
              onTimeUpdate={handlers.onTimeUpdate}
              onPlay={handlers.onPlay}
              onPause={handlers.onPause}
              onSeeking={handlers.onSeeking}
              onSeeked={handlers.onSeeked}
              onLoadedMetadata={handlers.onLoadedMetadata}
              preload="metadata"
              style={{ pointerEvents: 'none' }}
            />
          </div>

          {/* Crop Overlay */}
          {showCropOverlay && currentCrop && videoMetadata && (
            <CropOverlay
              videoRef={videoRef}
              videoMetadata={videoMetadata}
              currentCrop={currentCrop}
              aspectRatio={aspectRatio}
              onCropChange={onCropChange}
              onCropComplete={onCropComplete}
              zoom={zoom}
              panOffset={panOffset}
            />
          )}
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
