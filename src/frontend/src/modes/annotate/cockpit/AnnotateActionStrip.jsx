import { Plus, Pencil, ListVideo } from 'lucide-react';
import { SpeedControl } from '../components/AnnotateControls';
import { ANNOTATE_COCKPIT } from '../../../config/displayNames';

const RAIL_BTN =
  'flex h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-lg text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-40';

/**
 * AnnotateActionStrip (T15370) -- the 72px right strip of the Annotate
 * landscape cockpit: Mark/Edit play, playback speed, the source chip
 * (2+ videos only) and the 1x/3x timeline zoom toggle.
 *
 * Mark/Edit play keeps the `annotate-mark-play-button` testid the windowed
 * primary CTA uses -- the guide (resolveGuide) and every e2e spec that points
 * at it target this ONE id regardless of which surface is mounted.
 */
export default function AnnotateActionStrip({
  isEditMode = false,
  onAddClip,
  disabled = false,
  playbackSpeed = 1,
  onSpeedChange,
  sourceLabel = null,
  onOpenVideos,
  zoomedIn = false,
  onZoomToggle,
  hideZoomToggle = false,
  className = '',
}) {
  return (
    <div
      data-testid="annotate-cockpit-right-strip"
      data-cockpit-strip=""
      className={`relative z-30 flex w-[72px] flex-none flex-col items-center justify-between border-l border-gray-700 bg-gray-900 px-1 py-1.5 ${className}`}
    >
      <button
        type="button"
        data-testid="annotate-mark-play-button"
        onClick={onAddClip}
        disabled={disabled}
        title={isEditMode ? 'Edit selected play (A)' : 'Mark play ending at current time (A)'}
        className={`flex h-14 w-16 flex-col items-center justify-center gap-0.5 rounded-lg text-white transition-colors disabled:opacity-40 ${
          isEditMode ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-green-600 hover:bg-green-500'
        }`}
      >
        {isEditMode ? <Pencil size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
        <span className="text-[10px] leading-none">{isEditMode ? 'Edit' : 'Mark'}</span>
      </button>

      <div className="flex flex-col items-center gap-1.5">
        <SpeedControl speed={playbackSpeed} onSpeedChange={onSpeedChange} menuPlacement="left" />
        {sourceLabel && (
          <button
            type="button"
            data-testid="annotate-cockpit-source-chip"
            onClick={onOpenVideos}
            title="Switch video"
            className={RAIL_BTN}
          >
            <ListVideo size={16} aria-hidden="true" />
            <span className="text-[10px] leading-none font-mono">{sourceLabel}</span>
          </button>
        )}
      </div>

      {!hideZoomToggle && (
        <button
          type="button"
          data-testid="annotate-cockpit-zoom-toggle"
          onClick={onZoomToggle}
          title="Toggle timeline zoom"
          className={RAIL_BTN}
        >
          <span className="text-xs font-mono">
            {zoomedIn ? ANNOTATE_COCKPIT.ZOOM_3X : ANNOTATE_COCKPIT.ZOOM_1X}
          </span>
        </button>
      )}
    </div>
  );
}
