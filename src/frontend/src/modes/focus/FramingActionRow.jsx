import { Eye, EyeOff, Scissors } from 'lucide-react';
import { EDITOR_PANELS, FRAMING_GUIDE } from '../../config/displayNames';

/**
 * FramingActionRow - [Trim and SlowMo] + [Preview highlight].
 * Pure presentational: props in, callbacks out, no store reads.
 *
 * Rendered in the ActionBand directly above Generate Highlight: two equal
 * 48px tiles side by side, the CTA beneath (same row-above-CTA shape as
 * Annotate's Edit play / Make Highlight buttons).
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
  pulsePreview = false,
}) {
  const lockedTitle = locked ? FRAMING_GUIDE.LOCKED_TITLE : undefined;
  const base = 'w-full min-h-[48px] px-3 py-2 rounded-lg border text-sm font-semibold leading-tight text-center flex items-center justify-center gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';
  const idle = 'border-white/10 bg-white/5 text-white hover:bg-white/10 active:bg-white/15';
  const pressed = 'border-blue-500 bg-blue-600/90 text-white shadow-lg shadow-blue-900/40 hover:bg-blue-500';

  return (
    <div className="mx-auto w-full max-w-md grid grid-cols-2 gap-2">
      {onToggleTrim && (
        <button
          type="button"
          data-testid="trim-slowmo-button"
          onClick={onToggleTrim}
          disabled={locked}
          aria-pressed={trimOpen}
          title={lockedTitle ?? EDITOR_PANELS.TRIM_AND_SLOWMO_HINT}
          className={`${base} ${trimOpen ? pressed : idle}`}
        >
          <Scissors size={16} className="shrink-0" aria-hidden="true" />
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
          className={`${base} ${previewing ? pressed : idle}${pulsePreview && !previewing ? ' ring-2 ring-amber-400 animate-pulse motion-reduce:animate-none' : ''}`}
        >
          {previewing
            ? <EyeOff size={16} className="shrink-0" aria-hidden="true" />
            : <Eye size={16} className="shrink-0" aria-hidden="true" />}
          {previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
        </button>
      )}

      {/* T9950 Slice 3 -- approximation disclosure. Exact for crop/timing/format/
          audio, approximate for image quality; shown only while previewing. */}
      {previewing && (
        <span className="col-span-2 text-center text-xs text-gray-500" data-testid="preview-disclosure">
          {EDITOR_PANELS.PREVIEW_DISCLOSURE}
        </span>
      )}
    </div>
  );
}
