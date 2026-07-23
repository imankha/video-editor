import React from 'react';
import { RefreshCw } from 'lucide-react';
import { getClipDisplayName } from '../../utils/clipDisplayName';

/**
 * SegmentedProgressStrip - Visual progress indicator with segments
 *
 * Shows one segment per clip + one for overlay/final export.
 * Scales from 1 to 100+ clips by adjusting segment widths.
 *
 * Colors:
 * - Green (✓): Done/Complete (solid fill is reserved for done)
 * - Yellow/Amber: Exporting (actively rendering)
 * - Blue half-fill over gray: Started (has edits, not exported)
 * - Light Blue: Ready (for overlay - working video exists)
 * - Gray (○): Not started
 *
 * Click handlers:
 * - onClipClick(clipIndex) - Called when a clip segment is clicked
 * - onOverlayClick() - Called when the overlay segment is clicked
 *
 * @param {Object} project - Project data
 * @param {string} isExporting - 'framing' | 'overlay' | null - Which stage is currently exporting
 * @param {'full'|'slim'} variant - 'full' (default): labels row + h-3 strip for the
 *   list card. 'slim': just the segment strip (no labels, h-1.5, square) pinned to a
 *   poster tile's base (T5672). Segments stay clickable in both — the strip remains the
 *   granular deep-link into Framing/Overlay.
 */
export function SegmentedProgressStrip({ project, onClipClick, onOverlayClick, isExporting = null, isOffline = false, failedExportType = null, variant = 'full' }) {
  const {
    clip_count,
    clips_exported,
    clips_in_progress,
    clips = [], // Clip details from backend
    has_working_video,
    has_overlay_edits,
    has_final_video
  } = project;

  // Once framing is complete (has_working_video), show a single "Framing" segment
  // instead of per-clip segments. Framing exports ALL clips into ONE working video,
  // so per-clip progress is only meaningful BEFORE framing is done.
  const framingComplete = has_working_video || has_final_video;

  // Build segment data
  const clipSegments = [];

  if (framingComplete) {
    // Framing done - show single "Framing" segment as complete
    clipSegments.push({ status: 'done', label: 'Framing', tags: [] });
  } else if (isExporting === 'framing') {
    // Currently exporting - show single "Framing" segment as exporting (or disconnected)
    clipSegments.push({ status: isOffline ? 'disconnected' : 'exporting', label: 'Framing', tags: [] });
  } else if (failedExportType === 'framing') {
    // Framing export failed - show single "Framing" segment as failed
    clipSegments.push({ status: 'export_failed', label: 'Framing', tags: [] });
  } else {
    // Framing not done - show per-clip editing status
    for (let i = 0; i < clip_count; i++) {
      const clipInfo = clips[i];
      const clipName = getClipDisplayName(clipInfo, `Clip ${i + 1}`);
      const clipTags = clipInfo?.tags || [];

      if (clips_in_progress > 0 && i < clips_in_progress) {
        clipSegments.push({ status: 'in_progress', label: clipName, tags: clipTags });
      } else {
        clipSegments.push({ status: 'pending', label: clipName, tags: clipTags });
      }
    }
  }

  // Overlay segment status:
  // - green: final video exported
  // - yellow: exporting final video
  // - blue: overlay edits in progress
  // - light blue: working video exists but no overlay edits yet (ready)
  // - gray: no working video
  let overlayStatus = 'pending';
  if (has_final_video) {
    overlayStatus = 'done';
  } else if (isExporting === 'overlay') {
    overlayStatus = isOffline ? 'disconnected' : 'exporting';
  } else if (failedExportType === 'overlay') {
    overlayStatus = 'export_failed';
  } else if (has_overlay_edits) {
    overlayStatus = 'in_progress';
  } else if (has_working_video) {
    overlayStatus = 'ready';
  }
  const overlaySegment = { status: overlayStatus, label: 'Overlay' };

  const allSegments = [...clipSegments, overlaySegment];

  // Total segments for compact view calculation
  const totalSegments = allSegments.length;

  // Calculate segment width - minimum 4px, flex to fill space
  const minWidth = 4;
  const gapWidth = 2;

  // Status to color mapping
  // in_progress gets a gray track with a blue bottom half-fill (rendered below) so
  // "started" reads as unfinished by shape, not just hue - solid fill means done (T3540)
  const statusColors = {
    done: 'bg-green-500',
    exporting: 'bg-amber-500',
    export_failed: 'bg-orange-500',
    disconnected: 'bg-gray-400',
    in_progress: 'bg-gray-600',
    ready: 'bg-blue-300',
    pending: 'bg-gray-600'
  };

  // For many clips, use a compact view
  const isCompact = totalSegments > 10;

  return (
    <div className={variant === 'slim' ? '' : 'mt-3'}>
      {/* Labels row (hidden in the slim tile variant) */}
      {variant !== 'slim' && (
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        {has_final_video ? (
          <span className="text-green-400 w-full text-center">Done</span>
        ) : (
          <>
            <span className="flex items-center gap-2">
              {isExporting === 'framing' && isOffline ? (
                <span className="text-red-400">Not Connected</span>
              ) : isExporting === 'framing' ? (
                <span className="text-amber-400 flex items-center gap-1">
                  <RefreshCw size={10} className="animate-spin" />
                  Framing...
                </span>
              ) : framingComplete ? (
                <span className="text-green-400">Framing</span>
              ) : (
                <span>Framing</span>
              )}
            </span>
            {isExporting === 'overlay' && isOffline ? (
              <span className="text-red-400">Not Connected</span>
            ) : isExporting === 'overlay' ? (
              <span className="text-amber-400 flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin" />
                Exporting...
              </span>
            ) : (
              <span>Overlay</span>
            )}
          </>
        )}
      </div>
      )}

      {/* Segments strip */}
      <div
        className={`flex ${variant === 'slim' ? 'h-1.5' : 'h-3 rounded'} bg-gray-700 overflow-hidden`}
        style={{ gap: `${gapWidth}px` }}
      >
        {allSegments.map((segment, index) => {
          const isLast = index === allSegments.length - 1;
          const isOverlay = isLast;
          const clipIndex = isOverlay ? -1 : index;

          const handleClick = (e) => {
            e.stopPropagation(); // Don't trigger card's onClick
            if (isOverlay && onOverlayClick) {
              onOverlayClick();
            } else if (!isOverlay && onClipClick) {
              onClipClick(clipIndex);
            }
          };

          const isInProgress = segment.status === 'in_progress';

          return (
            <div
              key={index}
              onClick={handleClick}
              className={`${statusColors[segment.status]} ${isInProgress ? 'relative overflow-hidden' : ''} transition-all cursor-pointer hover:brightness-110 ${
                isLast ? 'rounded-r' : ''
              } ${index === 0 ? 'rounded-l' : ''}`}
              style={{
                flex: isLast ? '0 0 20%' : '1 1 0',
                minWidth: `${minWidth}px`
              }}
              title={`${segment.label}${segment.tags?.length ? ` [${segment.tags.join(', ')}]` : ''}: ${
                segment.status === 'done' ? 'Complete' :
                segment.status === 'disconnected' ? 'Not Connected' :
                segment.status === 'exporting' ? 'Exporting...' :
                segment.status === 'in_progress' ? (isOverlay ? 'Started - export to complete' : 'Started - export framing to complete') :
                segment.status === 'ready' ? 'Ready' :
                'Not Started'
              } (click to open)`}
            >
              {isInProgress && (
                <div className="absolute bottom-0 inset-x-0 h-1/2 bg-blue-500 pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

export default SegmentedProgressStrip;
