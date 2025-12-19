import React from 'react';
import { formatTimeSimple } from '../../../utils/timeFormat';

/**
 * ClipListItem - Individual clip item in the side panel list
 * Matches ClipSelectorSidebar item styling for consistency.
 */
export function ClipListItem({ region, index, isSelected, onClick }) {
  const duration = region.endTime - region.startTime;
  const notesPreview = region.notes
    ? region.notes.length > 20
      ? region.notes.slice(0, 20) + '...'
      : region.notes
    : null;

  return (
    <div
      onClick={onClick}
      className={`
        relative group cursor-pointer border-b border-gray-800 transition-all
        ${isSelected
          ? 'bg-green-900/40 border-l-2 border-l-green-500'
          : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
        }
      `}
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
