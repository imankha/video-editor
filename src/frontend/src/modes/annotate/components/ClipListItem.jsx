import React from 'react';
import { formatTimeSimple } from '../../../utils/timeFormat';

// Rating notation symbols (matches timeline ClipRegionLayer)
const RATING_NOTATION = {
  1: '??',   // Blunder
  2: '?',    // Weak
  3: '!?',   // Interesting
  4: '!',    // Good
  5: '!!',   // Excellent
};

// Rating colors (matches timeline - color-blind safe palette)
const RATING_BADGE_COLORS = {
  1: '#C62828', // Brick Red - Blunder
  2: '#F9A825', // Amber Yellow - Weak
  3: '#1565C0', // Strong Blue - Interesting
  4: '#2E7D32', // Teal-Green - Good
  5: '#66BB6A', // Light Green - Excellent
};

// Background tint colors for selected items (derived from badge colors)
const RATING_COLORS = {
  5: 'rgba(102, 187, 106, 0.15)', // Light Green
  4: 'rgba(46, 125, 50, 0.15)',   // Teal-Green
  3: 'rgba(21, 101, 192, 0.15)',  // Strong Blue
  2: 'rgba(249, 168, 37, 0.15)',  // Amber Yellow
  1: 'rgba(198, 40, 40, 0.15)',   // Brick Red
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
  const badgeColor = RATING_BADGE_COLORS[rating] || RATING_BADGE_COLORS[3];
  const notation = RATING_NOTATION[rating] || RATING_NOTATION[3];

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
        borderLeftColor: isSelected ? badgeColor : undefined,
      }}
    >
      <div className="flex items-center px-2 py-3">
        {/* Rating notation badge - matches timeline markers */}
        <div
          className="px-1.5 py-0.5 mr-2 rounded font-bold text-xs flex-shrink-0"
          style={{
            backgroundColor: badgeColor,
            color: '#ffffff',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            border: '1px solid rgba(0,0,0,0.3)',
          }}
          title={`Rating: ${rating}/5`}
        >
          {notation}
        </div>

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
