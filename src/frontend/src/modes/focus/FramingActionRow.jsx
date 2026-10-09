import ActionCard from '../../components/shared/ActionCard';
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
  inline = false,
}) {
  const lockedTitle = locked ? FRAMING_GUIDE.LOCKED_TITLE : undefined;

  return (
    <div className={inline ? 'contents' : 'mx-auto w-full max-w-2xl grid grid-cols-2 gap-2'}>
      {onToggleTrim && (
        <ActionCard compact
          type="button"
          data-testid="trim-slowmo-button"
          onClick={onToggleTrim}
          disabled={locked}
          aria-pressed={trimOpen}
          aria-label={FRAMING_GUIDE.TRIM_BUTTON}
          icon={Scissors}
          title={FRAMING_GUIDE.TRIM_BUTTON}
          tooltip={lockedTitle ?? EDITOR_PANELS.TRIM_AND_SLOWMO_HINT}
          description="Adjust timing and playback speed."
        />
      )}

      {onTogglePreview && (
        <ActionCard compact
          type="button"
          data-testid="framing-preview-toggle"
          onClick={onTogglePreview}
          disabled={locked}
          aria-pressed={previewing}
          aria-label={previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
          icon={previewing ? EyeOff : Eye}
          title={previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
          tooltip={lockedTitle ?? EDITOR_PANELS.PREVIEW_DISCLOSURE}
          description={lockedTitle ?? 'Check the framing before generating.'}
          className={pulsePreview && !previewing && !locked ? 'coach-target-pulse motion-reduce:animate-none' : ''}
        />
      )}

      {/* T9950 Slice 3 -- approximation disclosure. Exact for crop/timing/format/
          audio, approximate for image quality; shown only while previewing.
          Full-width row LAST: inline, this row is `display: contents` inside
          ActionBand's grid, and a col-span-2 cell here pushed Generate onto a
          second row (2026-10-09). */}
      {previewing && (
        <span className="col-span-full order-last text-center text-xs text-gray-500" data-testid="preview-disclosure">
          {EDITOR_PANELS.PREVIEW_DISCLOSURE}
        </span>
      )}
    </div>
  );
}
