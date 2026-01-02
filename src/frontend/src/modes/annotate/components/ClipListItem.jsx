import React from 'react';
import { getRatingDisplay } from '../../../components/shared/clipConstants';
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

/**
 * ClipListItem - Individual clip item in the side panel list
 * Compact single-line display showing rating badge and title only.
 * Background tint reflects the clip's star rating when selected.
 */
export function ClipListItem({ region, index, isSelected, onClick }) {
  const rating = region.rating || 3;
  const { notation, badgeColor, backgroundColor } = getRatingDisplay(rating);

  // Derive display name from stored name or auto-generate from rating+tags
  const displayName = region.name || generateClipName(rating, region.tags || []) || '';

  // Tooltip shows end timestamp before clip name
  const tooltipText = `${formatTime(region.endTime)} | ${displayName}`;

  return (
    <div
      onClick={onClick}
      className={`
        cursor-pointer border-b border-gray-800 transition-all
        ${isSelected
          ? 'border-l-2'
          : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
        }
      `}
      style={{
        backgroundColor: isSelected ? backgroundColor : undefined,
        borderLeftColor: isSelected ? badgeColor : undefined,
      }}
    >
      <div className="flex items-center px-2 py-1.5">
        {/* Rating notation badge */}
        <div
          className="px-1 py-0.5 mr-2 rounded font-bold text-xs flex-shrink-0"
          style={{
            backgroundColor: badgeColor,
            color: '#ffffff',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            fontSize: '10px',
          }}
          title={`Rating: ${rating}/5`}
        >
          {notation}
        </div>

        {/* Clip title only - single line */}
        <div className="flex-1 min-w-0 text-sm text-white truncate" title={tooltipText}>
          <span className="text-gray-500 mr-1">{index + 1}.</span>
          {displayName}
        </div>
      </div>
    </div>
  );
}

export default ClipListItem;
