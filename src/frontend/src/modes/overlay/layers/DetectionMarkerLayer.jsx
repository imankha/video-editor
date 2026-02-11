import React from 'react';
import { Crosshair } from 'lucide-react';
import { frameToTime } from '../../../utils/videoUtils';

/**
 * DetectionMarkerLayer - Dedicated timeline row for player detection markers
 *
 * Shows clickable markers at timestamps where player detection data exists.
 * Clicking a marker seeks the playhead to that exact frame, allowing the user
 * to see detection boxes and click them to create keyframes.
 *
 * Uses frame numbers (when available) for precise seeking, avoiding floating-point
 * rounding issues with timestamps.
 */
export default function DetectionMarkerLayer({
  regions = [],
  duration,
  visualDuration,
  onSeek,
  onDetectionMarkerClick,  // (regionId, frame, detection) => void - called when marker is clicked
  sourceTimeToVisualTime = (t) => t,
  edgePadding = 20,
}) {
  const timelineDuration = visualDuration || duration;

  // Collect all detection timestamps from all regions
  const detectionMarkers = React.useMemo(() => {
    const markers = [];

    regions.forEach((region) => {
      if (!region.detections?.length) return;

      // Log warning if fps is missing - indicates data issue that needs re-export
      if (!region.fps) {
        console.warn(`[DetectionMarkerLayer] Region ${region.id} missing fps - detection marker navigation may be inaccurate. Re-export framing to fix.`);
      }

      region.detections.forEach((detection) => {
        if (!detection.boxes?.length) return;

        // Convert source time to visual position
        const visualTime = sourceTimeToVisualTime(detection.timestamp);
        const positionPercent = (visualTime / timelineDuration) * 100;

        if (positionPercent >= 0 && positionPercent <= 100) {
          markers.push({
            timestamp: detection.timestamp,
            frame: detection.frame,  // Frame number for precise seeking
            fps: region.fps,  // May be null if data is from old export
            positionPercent,
            boxCount: detection.boxes.length,
            boxes: detection.boxes,  // Include boxes for guaranteed display after click
            regionId: region.id,
            videoWidth: region.videoWidth,
            videoHeight: region.videoHeight,
          });
        }
      });
    });

    return markers;
  }, [regions, timelineDuration, sourceTimeToVisualTime]);

  // Don't render if no detection markers
  if (detectionMarkers.length === 0) {
    return null;
  }

  return (
    <div className="relative h-8 bg-gray-800/80 border-t border-gray-700/50 rounded-r-lg">
      {/* Track area with edge padding */}
      <div
        className="absolute inset-0"
        style={{
          paddingLeft: `${edgePadding}px`,
          paddingRight: `${edgePadding}px`,
        }}
      >
        {/* Detection markers */}
        {detectionMarkers.map((marker, index) => (
          <button
            key={`${marker.regionId}-${marker.timestamp}-${index}`}
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 group cursor-pointer transition-transform hover:scale-110"
            style={{ left: `${marker.positionPercent}%` }}
            onClick={(e) => {
              e.stopPropagation();

              // Tell OverlayContainer which detection to display (guarantees boxes show)
              if (onDetectionMarkerClick) {
                onDetectionMarkerClick({
                  regionId: marker.regionId,
                  frame: marker.frame,
                  boxes: marker.boxes,
                  videoWidth: marker.videoWidth,
                  videoHeight: marker.videoHeight,
                });
              }

              // Seek to the detection's timestamp
              if (onSeek) {
                if (marker.frame !== undefined && marker.fps) {
                  const preciseTime = frameToTime(marker.frame, marker.fps);
                  onSeek(preciseTime);
                } else {
                  console.warn(`[DetectionMarkerLayer] Missing frame/fps data for marker at ${marker.timestamp}s - using timestamp. Re-export framing to fix.`);
                  onSeek(marker.timestamp);
                }
              }
            }}
            title={`${marker.boxCount} player${marker.boxCount > 1 ? 's' : ''} detected at frame ${marker.frame ?? Math.round(marker.timestamp * 30)} - Click to jump`}
          >
            {/* Green marker with icon */}
            <div className="w-6 h-6 rounded bg-green-600 group-hover:bg-green-500 flex items-center justify-center shadow-lg border border-green-400">
              <Crosshair size={14} className="text-white" />
            </div>
            {/* Player count badge */}
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-green-500 text-white text-[10px] font-bold flex items-center justify-center border border-green-300">
              {marker.boxCount}
            </div>
          </button>
        ))}
      </div>

      {/* Label hint */}
      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
        Detection
      </div>
    </div>
  );
}
