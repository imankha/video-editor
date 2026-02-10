import React, { useState, useRef, useCallback } from 'react';

/**
 * VideoPlayer component - Displays the video element with zoom and pan support
 *
 * This component is overlay-agnostic - modes pass their own overlays as children.
 *
 * Video loading state is managed by useVideoStore (via useVideo hook).
 * This component receives loading state as props for display.
 *
 * @param {Object} props
 * @param {React.RefObject} props.videoRef - Ref to video element
 * @param {string} props.videoUrl - Video source URL
 * @param {Object} props.handlers - Video element event handlers (from useVideo)
 * @param {Function} props.onFileSelect - Callback for file upload via drag-and-drop
 * @param {React.ReactNode[]} props.overlays - Array of overlay components to render over video
 * @param {number} props.zoom - Zoom level (1 = 100%)
 * @param {Object} props.panOffset - Pan offset {x, y}
 * @param {Function} props.onZoomChange - Callback when zoom changes (wheel)
 * @param {Function} props.onPanChange - Callback when pan changes (drag)
 * @param {boolean} props.isFullscreen - Whether the player is in fullscreen mode
 * @param {number|null} props.clipRating - Rating (1-5) of clip at current time, null if not in clip
 * @param {boolean} props.isLoading - Whether hook is loading video URL (pre-element)
 * @param {boolean} props.isVideoElementLoading - Whether video element is buffering
 * @param {number|null} props.loadingProgress - Buffering progress 0-100, null when not loading
 * @param {string|null} props.error - Video load error message
 * @param {string} props.loadingMessage - Optional loading message to display
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
  clipRating = null,
  isLoading = false,
  isVideoElementLoading = false,
  loadingProgress = null,
  error = null,
  isUrlExpiredError = () => false,
  onRetryVideo,
  loadingMessage = 'Loading video...'
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

  // Render loading overlay with progress bar
  const renderLoadingOverlay = () => {
    // Determine progress state:
    // - loadingProgress > 0: We have buffer info, show percentage
    // - loadingProgress === 0: Just started or still fetching metadata
    // - loadingProgress === null: Indeterminate state
    const hasProgress = loadingProgress !== null && loadingProgress > 0 && loadingProgress < 100;
    const isIndeterminate = loadingProgress === null || loadingProgress === 0;

    return (
      <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-40">
        <div className="text-center w-64">
          <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-600 border-t-purple-500"></div>
          <p className="mt-4 text-sm text-gray-300">{loadingMessage}</p>
          <div className="mt-3">
            <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
              {hasProgress ? (
                <div
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${loadingProgress}%` }}
                />
              ) : (
                // Indeterminate progress - sliding bar animation
                <div
                  className="h-full w-1/3 bg-gradient-to-r from-purple-600 via-purple-400 to-purple-600 rounded-full"
                  style={{
                    animation: 'slide 1.2s ease-in-out infinite',
                    transformOrigin: 'left center'
                  }}
                />
              )}
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {hasProgress ? `Buffering ${loadingProgress}%` : 'Connecting to server...'}
            </p>
          </div>
        </div>
      </div>
    );
  };

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
              onLoadStart={handlers.onLoadStart}
              onTimeUpdate={handlers.onTimeUpdate}
              onPlay={handlers.onPlay}
              onPause={handlers.onPause}
              onSeeking={handlers.onSeeking}
              onSeeked={handlers.onSeeked}
              onLoadedMetadata={handlers.onLoadedMetadata}
              onLoadedData={handlers.onLoadedData}
              onProgress={handlers.onProgress}
              onWaiting={handlers.onWaiting}
              onPlaying={handlers.onPlaying}
              onCanPlay={handlers.onCanPlay}
              onError={handlers.onError}
              preload="auto"
              style={{ pointerEvents: 'none' }}
            />
          </div>

          {/* Video loading overlay - shown while video element is buffering */}
          {isVideoElementLoading && !error && renderLoadingOverlay()}

          {/* Render any overlays passed by the mode */}
          {overlays}

          {/* Video error overlay */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-50">
              <div className="text-center max-w-md px-4">
                <div className="text-red-500 text-4xl mb-4">⚠️</div>
                <p className="text-red-400 font-semibold mb-2">Video failed to load</p>
                <p className="text-gray-400 text-sm mb-4">{error}</p>
                {isUrlExpiredError() && onRetryVideo && (
                  <button
                    onClick={onRetryVideo}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                  >
                    Retry Loading Video
                  </button>
                )}
              </div>
            </div>
          )}

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
      ) : isLoading ? (
        <div className="flex items-center justify-center h-[60vh] text-gray-400">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-600 border-t-purple-500"></div>
            <p className="mt-4 text-sm text-gray-300">{loadingMessage}</p>
          </div>
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
