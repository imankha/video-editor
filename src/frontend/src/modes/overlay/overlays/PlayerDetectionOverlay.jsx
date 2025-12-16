import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * PlayerDetectionOverlay - Renders clickable bounding boxes around detected players
 *
 * When a user clicks on a player box, it calls onPlayerSelect with the player's
 * bounding box, which can then be used to set the highlight position.
 */
export default function PlayerDetectionOverlay({
  videoRef,
  videoMetadata,
  detections = [],
  isLoading = false,
  onPlayerSelect,
  zoom = 1,
  panOffset = { x: 0, y: 0 }
}) {
  const [videoDisplayRect, setVideoDisplayRect] = useState(null);
  const [hoveredIndex, setHoveredIndex] = useState(null);

  /**
   * Update video display dimensions when video size changes
   */
  useEffect(() => {
    if (!videoRef?.current || !videoMetadata) return;

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
   * Handle click on a player detection box
   */
  const handlePlayerClick = (detection, e) => {
    e.preventDefault();
    e.stopPropagation();

    if (onPlayerSelect) {
      // Convert bounding box to highlight format (center + radii)
      // The detection bbox is already center-based from the backend
      const { bbox, confidence } = detection;

      // Convert to ellipse radii (use half of width/height)
      const radiusX = bbox.width / 2;
      const radiusY = bbox.height / 2;

      onPlayerSelect({
        x: bbox.x,
        y: bbox.y,
        radiusX: radiusX,
        radiusY: radiusY,
        confidence: confidence
      });
    }
  };

  if (!videoDisplayRect || detections.length === 0) {
    // Show loading indicator if loading
    if (isLoading && videoDisplayRect) {
      return (
        <div
          className="absolute inset-0 pointer-events-none flex items-start justify-end p-4"
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
        >
          <div className="bg-black/60 text-white px-3 py-1.5 rounded text-sm flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Detecting players...
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%'
      }}
    >
      {/* SVG layer for detection boxes */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {detections.map((detection, index) => {
          const { bbox, confidence } = detection;

          // Convert center-based bbox to corner-based for drawing
          const screenBox = videoToScreen(
            bbox.x - bbox.width / 2,  // Convert center to top-left
            bbox.y - bbox.height / 2,
            bbox.width,
            bbox.height
          );

          const isHovered = hoveredIndex === index;

          return (
            <g key={index}>
              {/* Detection box - clickable */}
              <rect
                x={screenBox.x}
                y={screenBox.y}
                width={screenBox.width}
                height={screenBox.height}
                fill={isHovered ? 'rgba(59, 130, 246, 0.2)' : 'transparent'}
                stroke={isHovered ? '#3b82f6' : '#22c55e'}
                strokeWidth={isHovered ? 3 : 2}
                strokeDasharray={isHovered ? 'none' : '5,3'}
                className="pointer-events-auto cursor-pointer transition-all"
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={(e) => handlePlayerClick(detection, e)}
              />

              {/* Confidence label */}
              <rect
                x={screenBox.x}
                y={screenBox.y - 20}
                width={50}
                height={18}
                fill={isHovered ? '#3b82f6' : '#22c55e'}
                rx={3}
                className="pointer-events-none"
              />
              <text
                x={screenBox.x + 25}
                y={screenBox.y - 7}
                textAnchor="middle"
                fill="white"
                fontSize="11"
                fontWeight="500"
                className="pointer-events-none"
              >
                {Math.round(confidence * 100)}%
              </text>

              {/* Click hint on hover */}
              {isHovered && (
                <>
                  <rect
                    x={screenBox.x + screenBox.width / 2 - 50}
                    y={screenBox.y + screenBox.height / 2 - 12}
                    width={100}
                    height={24}
                    fill="rgba(0, 0, 0, 0.8)"
                    rx={4}
                    className="pointer-events-none"
                  />
                  <text
                    x={screenBox.x + screenBox.width / 2}
                    y={screenBox.y + screenBox.height / 2 + 4}
                    textAnchor="middle"
                    fill="white"
                    fontSize="12"
                    fontWeight="500"
                    className="pointer-events-none"
                  >
                    Click to track
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {/* Detection count badge */}
      <div className="absolute top-4 right-4 bg-black/60 text-white px-3 py-1.5 rounded text-sm pointer-events-none">
        {isLoading ? (
          <span className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
            Updating...
          </span>
        ) : (
          <span>{detections.length} player{detections.length !== 1 ? 's' : ''} detected</span>
        )}
      </div>
    </div>
  );
}
