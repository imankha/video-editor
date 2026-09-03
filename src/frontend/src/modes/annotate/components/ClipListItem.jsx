import React, { useEffect, useRef } from 'react';
import { Info, Play, Users, Share2 } from 'lucide-react';
import { getRatingDisplay, RATING_ADJECTIVES } from '../../../components/shared/clipConstants';
import { generateClipName } from '../../../utils/clipDisplayName';

/**
 * LayerChip - icon-only amber "Team" marker for a clip-list row (T5700 follow-up).
 * ONLY the Team layer is marked: My Athlete is the default layer, so marking it
 * too was pure noise on almost every row (user decision after testing). An
 * unmarked row therefore means My Athlete.
 *
 * T6400: deliberately NO `title` — the layer is signalled by color/icon alone on
 * hover (user decision: the "Team" rollover tooltip was unwanted clutter). The
 * `aria-label` is RETAINED (invisible, zero space) so the layer still has an
 * accessible name for assistive tech and isn't conveyed by color alone
 * (WCAG 1.4.1). Do not re-add a title or drop the aria-label.
 */
function LayerChip({ isMine }) {
  if (isMine) return null;
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full
                 bg-amber-500 text-amber-950"
      aria-label="Team layer"
    >
      <Users size={12} />
    </span>
  );
}

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
      // Stable hook for asserting on row SETS. Needed since only Team rows carry
      // a layer marker now — "count the My Athlete rows" has no marker to count.
      data-testid="clip-row"
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
          title={`${RATING_ADJECTIVES[rating]} (${rating}/5)`}
          aria-label={`${RATING_ADJECTIVES[rating]} (${rating}/5)`}
        >
          {notation}
        </div>

        {/* Layer chip (T5700): fixed left cluster, always visible */}
        <div className="mr-2 flex-shrink-0">
          <LayerChip isMine={region.my_athlete ?? true} />
        </div>

        {/* Clip title + end time (+ "Shared by" attribution on imported clips,
            desktop only — chip and pill are both shrink-0 so the NAME truncates
            first, keeping layer identity and provenance visible). */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-sm text-white" title={tooltipText}>
            <span className="text-gray-500 mr-1">{index + 1}.</span>
            {displayName}
          </span>
          {!isMobile && region.shared_by && (
            <span
              className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                         text-[10px] bg-purple-900/40 border border-purple-700/40 text-purple-200"
              title={`Shared by ${region.shared_by}`}
            >
              <Share2 size={9} /> {region.shared_by}
            </span>
          )}
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

      {/* Mobile: "Shared by" drops to a second line (no room inline at 390px);
          provenance stays visible without crowding the name (T5700). */}
      {isMobile && region.shared_by && (
        <div className="px-2 pb-1.5 -mt-1">
          <span className="text-[10px] text-purple-300 truncate block" title={`Shared by ${region.shared_by}`}>
            Shared by {region.shared_by}
          </span>
        </div>
      )}
    </div>
  );
}

export default ClipListItem;
