import React, { useRef, useState } from 'react';
import { generateClipName } from '../constants/soccerTags';

// Format seconds to MM:SS or HH:MM:SS
const formatTime = (seconds) => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Rating to notation map
const RATING_NOTATION = {
  1: '??',
  2: '?',
  3: '!?',
  4: '!',
  5: '!!'
};

// Rating to color map (color-blind safe palette)
// Brightness scales from darkest (1⭐) to brightest (5⭐)
const RATING_COLORS = {
  1: '#C62828', // Brick Red - Blunder
  2: '#F9A825', // Amber Yellow - Weak/Caution
  3: '#1565C0', // Strong Blue - Interesting
  4: '#2E7D32', // Teal-Green - Good
  5: '#66BB6A', // Light Green - Excellent (festive!)
};

/**
 * ClipRegionLayer - Timeline layer displaying clip markers with rating notation
 *
 * Interaction:
 * - Click marker to select it
 * - Delete clips via sidebar (not by clicking)
 * - Shows rating notation: ?? (1), ? (2), !? (3), ! (4), !! (5)
 *
 * Clips are added via:
 * - "Add Clip" button in controls bar (non-fullscreen)
 * - Pausing in fullscreen mode
 */
export default function ClipRegionLayer({
  regions = [],
  duration,
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
  edgePadding = 20
}) {
  const trackRef = useRef(null);
  const [hoveredRegionId, setHoveredRegionId] = useState(null);

  if (!duration) return null;

  // Convert time to percentage position
  const timeToPercent = (time) => (time / duration) * 100;

  // Handle marker click - select the marker
  const handleMarkerClick = (e, regionId) => {
    e.stopPropagation();

    // Select the marker (even if already selected, this is a no-op)
    if (onSelectRegion) {
      onSelectRegion(regionId);
    }
  };

  return (
    <div
      ref={trackRef}
      className="relative h-12 bg-gray-800 rounded"
      style={{
        paddingLeft: `${edgePadding}px`,
        paddingRight: `${edgePadding}px`,
      }}
    >
      {/* Inner track area */}
      <div className="relative h-full">
        {/* Clip markers */}
        {regions.map((region) => {
          const isSelected = region.id === selectedRegionId;
          const isHovered = region.id === hoveredRegionId;
          const left = timeToPercent(region.startTime);
          const rating = region.rating || 3;
          const notation = RATING_NOTATION[rating];
          const color = RATING_COLORS[rating];
          const showTooltip = isSelected || isHovered;
          // Use same fallback logic as ClipListItem
          const displayName = region.name || generateClipName(rating, region.tags || []) || '';

          return (
            <div
              key={region.id}
              className="clip-marker absolute top-1/2 cursor-pointer transition-all duration-150"
              style={{
                left: `${left}%`,
                transform: `translateX(-50%) translateY(-50%)`,
                zIndex: isSelected ? 20 : isHovered ? 15 : 10,
              }}
              onClick={(e) => handleMarkerClick(e, region.id)}
              onMouseEnter={() => setHoveredRegionId(region.id)}
              onMouseLeave={() => setHoveredRegionId(null)}
            >
              {/* Rating notation badge with outline for visibility */}
              <div
                className={`
                  px-1.5 py-0.5 rounded font-bold transition-all duration-150
                  ${isSelected
                    ? 'text-lg ring-2 ring-white shadow-lg'
                    : 'text-sm hover:scale-110'
                  }
                `}
                style={{
                  backgroundColor: color,
                  color: '#ffffff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  border: '1px solid rgba(0,0,0,0.3)', // Dark outline for visibility
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                {notation}
              </div>
              {/* Show tooltip on hover or select - end timestamp before clip name */}
              {showTooltip && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-white bg-gray-900 px-1.5 py-0.5 rounded shadow z-30">
                  <span className="text-blue-400">{formatTime(region.endTime)}</span>
                  <span className="text-gray-500 mx-1">|</span>
                  <span className="text-gray-400">{region.index + 1}.</span> {displayName}
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state message */}
        {regions.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
            Use "Add Clip" button or pause in fullscreen to add clips
          </div>
        )}
      </div>
    </div>
  );
}
