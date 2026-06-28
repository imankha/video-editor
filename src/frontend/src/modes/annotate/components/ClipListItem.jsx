import React, { useEffect, useRef } from 'react';
import { Info, Play } from 'lucide-react';
import { getRatingDisplay } from '../../../components/shared/clipConstants';
import { generateClipName } from '../../../utils/clipDisplayName';

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
 *
 * On mobile: two action buttons — "details" and "jump to clip".
 * On desktop: entire row is clickable to select.
 *
 * T4080: when `gameClock` (soccer notation, e.g. "34'12\"") is provided, it renders
 * right-aligned on the row. Callers that lack an in-match start (e.g. recap mode)
 * omit it and the row renders without a time.
 */
export function ClipListItem({ region, index, isSelected, isPlaybackActive = false, onClick, isMobile = false, onViewDetails, onJumpToClip, gameClock = null }) {
  const rating = region.rating || 3;
  const { notation, badgeColor, backgroundColor } = getRatingDisplay(rating);

  // T3960: scroll the selected row into view so an auto-selection (e.g. the
  // reel's source clip when arriving from Framing) is visible even when it sits
  // below the fold. `block: 'nearest'` is a no-op when the row is already
  // visible, so clicking a visible item never causes a jump. No behavior arg =
  // instant scroll within the ClipsSidePanel overflow container.
  const rowRef = useRef(null);
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isSelected]);

  // Derive display name from stored name or auto-generate from rating+tags
  const displayName = region.name || generateClipName(rating, region.tags || [], region.notes || '') || `Clip ${index + 1}`;

  // Tooltip shows end timestamp before clip name
  const tooltipText = `${formatTime(region.endTime)} | ${displayName}`;

  return (
    <div
      ref={rowRef}
      onClick={isMobile ? undefined : onClick}
      className={`
        ${isMobile ? '' : 'cursor-pointer'} transition-all
        ${isPlaybackActive
          ? 'border-l-3 border-b border-gray-800 animate-pulse'
          : isSelected
            ? 'border-l-3 border border-white/30 rounded-sm'
            : 'border-b border-gray-800 hover:bg-gray-800/50 border-l-2 border-l-transparent'
        }
      `}
      style={{
        backgroundColor: isPlaybackActive
          ? `${badgeColor}33`  // 20% opacity tint of rating color
          : isSelected ? `${badgeColor}50` : undefined,  // 31% opacity
        borderLeftColor: isPlaybackActive ? badgeColor : isSelected ? badgeColor : undefined,
      }}
    >
      <div className={`flex items-center px-2 ${isMobile ? 'py-3' : 'py-1.5'}`}>
        {/* Rating notation badge */}
        <div
          className={`${isMobile ? 'px-1.5 py-1 mr-2.5' : 'px-1 py-0.5 mr-2'} rounded font-bold text-xs flex-shrink-0`}
          style={{
            backgroundColor: badgeColor,
            color: '#ffffff',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            fontSize: isMobile ? '11px' : '10px',
          }}
          title={`Rating: ${rating}/5`}
        >
          {notation}
        </div>

        {/* Clip title + end time */}
        <div className="flex-1 min-w-0 text-sm text-white truncate" title={tooltipText}>
          <span className="text-gray-500 mr-1">{index + 1}.</span>
          {displayName}
        </div>

        {/* Desktop: in-match soccer-notation time, right-aligned (T4080) */}
        {!isMobile && gameClock && (
          <span
            className="ml-2 flex-shrink-0 text-xs text-gray-400 tabular-nums"
            title="Game time"
          >
            {gameClock}
          </span>
        )}

        {/* Mobile: two action buttons */}
        {isMobile ? (
          <div className="flex items-center gap-1 ml-2 flex-shrink-0">
            {/* T4080: prefer the in-match soccer clock; fall back to clip end time */}
            <span className="text-xs text-gray-500 mr-1 tabular-nums">{gameClock || formatTime(region.endTime)}</span>
            <button
              onClick={onViewDetails}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white transition-colors"
              title="View details"
            >
              <Info size={16} />
            </button>
            <button
              onClick={onJumpToClip}
              className="p-2 rounded-lg bg-green-700 hover:bg-green-600 text-white transition-colors"
              title="Jump to clip"
            >
              <Play size={16} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ClipListItem;
