import React from 'react';
import { formatTimeSimple } from '../../../utils/timeFormat';

// Rating-based background colors (used for tinting the clip item)
const RATING_COLORS = {
  5: 'rgba(234, 179, 8, 0.15)',   // gold/yellow
  4: 'rgba(34, 197, 94, 0.15)',   // green
  3: 'rgba(59, 130, 246, 0.15)',  // blue
  2: 'rgba(249, 115, 22, 0.15)',  // orange
  1: 'rgba(239, 68, 68, 0.15)',   // red
};

// Rating-based border colors for selected state
const RATING_BORDER_COLORS = {
  5: '#eab308', // gold/yellow
  4: '#22c55e', // green
  3: '#3b82f6', // blue
  2: '#f97316', // orange
  1: '#ef4444', // red
};

/**
 * ClipListItem - Individual clip item in the side panel list
 * Matches ClipSelectorSidebar item styling for consistency.
 * Background tint reflects the clip's star rating.
 */
export function ClipListItem({ region, index, isSelected, onClick }) {
  const duration = region.endTime - region.startTime;
  const rating = region.rating || 3;
  const notesPreview = region.notes
    ? region.notes.length > 20
      ? region.notes.slice(0, 20) + '...'
      : region.notes
    : null;

  const ratingColor = RATING_COLORS[rating] || RATING_COLORS[3];
  const ratingBorderColor = RATING_BORDER_COLORS[rating] || RATING_BORDER_COLORS[3];

  return (
    <div
      onClick={onClick}
      className={`
        relative group cursor-pointer border-b border-gray-800 transition-all
        ${isSelected
          ? 'border-l-2'
          : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
        }
      `}
      style={{
        backgroundColor: isSelected ? ratingColor : undefined,
        borderLeftColor: isSelected ? ratingBorderColor : undefined,
      }}
    >
      <div className="flex items-center px-2 py-3">
        {/* Color indicator */}
        <div
          className="w-3 h-3 rounded-full mr-2 flex-shrink-0"
          style={{ backgroundColor: region.color }}
        />

        {/* Clip info */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-white truncate" title={region.name}>
            {region.name}
          </div>
          <div className="text-xs text-gray-500">
            {formatTimeSimple(region.startTime)} - {formatTimeSimple(region.endTime)}
            <span className="ml-1 text-gray-600">({duration.toFixed(1)}s)</span>
          </div>
          {notesPreview && (
            <div className="text-xs text-gray-400 truncate mt-0.5" title={region.notes}>
              {notesPreview}
            </div>
          )}
        </div>
      </div>

      {/* Clip number indicator */}
      <div className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center pointer-events-none">
        <span className="text-[10px] text-gray-600 font-mono">
          {index + 1}
        </span>
      </div>
    </div>
  );
}

export default ClipListItem;
