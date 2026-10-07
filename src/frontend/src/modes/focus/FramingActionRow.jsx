import { Eye, EyeOff, Scissors } from 'lucide-react';
import { EDITOR_PANELS, FRAMING_GUIDE } from '../../config/displayNames';

/**
 * FramingActionRow - [Trim and SlowMo] + [Preview highlight].
 * Pure presentational: props in, callbacks out, no store reads.
 *
 * Both buttons are locked together with Generate Highlight until the guided
 * steps (drag the box, press play) are done; `locked` carries that. Trim and
 * SlowMo toggles the timeline's segment/speed/trim track (`trimOpen`).
 */
export default function FramingActionRow({
  previewing = false,
  onTogglePreview,
  onToggleTrim,
  trimOpen = false,
  locked = false,
}) {
  const lockedTitle = locked ? FRAMING_GUIDE.LOCKED_TITLE : undefined;
  const base = 'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors coarse-pointer:min-h-11 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {onToggleTrim && (
        <button
          type="button"
          data-testid="trim-slowmo-button"
          onClick={onToggleTrim}
          disabled={locked}
          aria-pressed={trimOpen}
          title={lockedTitle ?? EDITOR_PANELS.TRIM_AND_SLOWMO_HINT}
          className={`${base} ${
            trimOpen
              ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500'
              : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          <Scissors size={14} aria-hidden="true" />
          {FRAMING_GUIDE.TRIM_BUTTON}
        </button>
      )}

      {onTogglePreview && (
        <button
          type="button"
          data-testid="framing-preview-toggle"
          onClick={onTogglePreview}
          disabled={locked}
          aria-pressed={previewing}
          title={lockedTitle ?? EDITOR_PANELS.PREVIEW_DISCLOSURE}
          className={`${base} ${
            previewing
              ? 'border-blue-500 bg-blue-600 text-white hover:bg-blue-500'
              : 'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          {previewing ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
          {previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
        </button>
      )}

      {/* T9950 Slice 3 -- approximation disclosure. Exact for crop/timing/format/
          audio, approximate for image quality; shown only while previewing. */}
      {previewing && (
        <span className="w-full text-xs text-gray-500" data-testid="preview-disclosure">
          {EDITOR_PANELS.PREVIEW_DISCLOSURE}
        </span>
      )}
    </div>
  );
}
