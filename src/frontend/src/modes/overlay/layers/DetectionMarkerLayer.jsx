import React from 'react';
import { Crosshair, Check } from 'lucide-react';
import { frameToTime } from '../../../utils/videoUtils';
import { isDetectionAssigned } from '../utils/detectionAssignment';

// Module-level Set to track warned regions - persists across React StrictMode remounts
const warnedRegions = new Set();

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
  isDisabled = false,
}) {
  const timelineDuration = visualDuration || duration;

  // Collect all detection timestamps from all regions
  const detectionMarkers = React.useMemo(() => {
    const markers = [];

    regions.forEach((region) => {
      if (!region.detections?.length) return;

      // Log warning if fps is missing - indicates data issue that needs re-export
      // Only warn once per region (module-level tracking persists across StrictMode remounts)
      if (!region.fps && !warnedRegions.has(region.id)) {
        console.warn(`[DetectionMarkerLayer] Region ${region.id} missing fps - detection marker navigation may be inaccurate. Re-export framing to fix.`);
        warnedRegions.add(region.id);
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
            assigned: isDetectionAssigned(region, detection),  // player picked at this frame?
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
            className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 group transition-transform ${
              isDisabled ? 'cursor-default opacity-30' : 'cursor-pointer hover:scale-110'
            }`}
            style={{ left: `${marker.positionPercent}%` }}
            onClick={(e) => {
              e.stopPropagation();
              if (isDisabled) return;

              // Tell OverlayContainer which detection to display (guarantees boxes show)
              if (onDetectionMarkerClick) {
                onDetectionMarkerClick({
                  regionId: marker.regionId,
                  frame: marker.frame,
                  timestamp: marker.timestamp,  // exact detection time — used to snap the assignment keyframe (immune to seek imprecision)
                  boxes: marker.boxes,
                  videoWidth: marker.videoWidth,
                  videoHeight: marker.videoHeight,
                });
              }

              // Seek to the exact frame time (no offset)
              // The backend already uses math.ceil() for first-frame detection
              // to avoid clip-boundary ambiguity, so no offset is needed here.
              if (onSeek) {
                if (marker.frame !== undefined && marker.fps) {
                  const seekTarget = frameToTime(marker.frame, marker.fps);
                  console.log(`[DetectionSeek] CLICK marker frame=${marker.frame} fps=${marker.fps} seekTarget=${seekTarget.toFixed(6)}s boxes=${marker.boxCount}`);
                  onSeek(seekTarget);
                } else {
                  console.warn(`[DetectionMarkerLayer] Missing frame/fps data for marker at ${marker.timestamp}s - using timestamp. Re-export framing to fix.`);
                  onSeek(marker.timestamp);
                }
              }
            }}
            title={isDisabled
              ? 'Player tracking disabled'
              : marker.assigned
                ? `Player assigned at frame ${marker.frame ?? Math.round(marker.timestamp * 30)} - Click to revisit`
                : `${marker.boxCount} player${marker.boxCount > 1 ? 's' : ''} detected at frame ${marker.frame ?? Math.round(marker.timestamp * 30)} - Click to assign`}
          >
            {/* Marker with icon - gray when disabled, checked once a player is assigned */}
            <div className={`w-6 h-6 rounded flex items-center justify-center shadow-lg border ${
              isDisabled
                ? 'bg-gray-600 border-gray-500'
                : marker.assigned
                  ? 'bg-green-500 border-green-300'
                  : 'bg-green-600 group-hover:bg-green-500 border-green-400'
            }`}>
              {marker.assigned
                ? <Check size={15} className="text-white" strokeWidth={3} />
                : <Crosshair size={14} className="text-white" />}
            </div>
            {/* Bottom-right badge: detected-player count until assigned, then a check */}
            <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full text-white text-[10px] font-bold flex items-center justify-center border ${
              isDisabled
                ? 'bg-gray-500 border-gray-400'
                : marker.assigned
                  ? 'bg-emerald-400 border-emerald-200'
                  : 'bg-green-500 border-green-300'
            }`}>
              {marker.assigned ? <Check size={10} className="text-white" strokeWidth={4} /> : marker.boxCount}
            </div>
          </button>
        ))}
      </div>

    </div>
  );
}
