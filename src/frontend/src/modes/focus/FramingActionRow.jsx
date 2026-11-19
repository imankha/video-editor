import ActionCard from '../../components/shared/ActionCard';
import { GUIDE_PULSE } from '../../components/instructions/guideTargets';
import { Check, Eye, EyeOff, Scissors } from 'lucide-react';
import { EDITOR_PANELS, FRAMING_GUIDE } from '../../config/displayNames';

/**
 * FramingActionRow - [Trim and SlowMo] + [Preview highlight].
 * Pure presentational: props in, callbacks out, no store reads.
 *
 * Rendered in the ActionBand directly above Generate Highlight: two equal
 * 48px tiles side by side, the CTA beneath (same row-above-CTA shape as
 * Annotate's Edit play / Make Highlight buttons).
 *
 * T14830 (owner ruling 2026-11-07, "Confirm once"): never locked by drag or
 * Play. Trim and SlowMo toggles the timeline's segment/speed/trim track
 * (`trimOpen`).
 *
 * T17860 (owner ruling 2026-11-19): open, Trim reads "Done trimming" with a check and the
 * pressed look (ActionCard `pressed`); Preview gets the same look while previewing. Both labels change with state,
 * so neither carries aria-pressed (state would be announced twice).
 */

export default function FramingActionRow({
  previewing = false,
  onTogglePreview,
  onToggleTrim,
  trimOpen = false,
  inline = false,
}) {
  return (
    <div className={inline ? 'contents' : 'mx-auto w-full max-w-2xl grid grid-cols-2 gap-2'}>
      {onToggleTrim && (
        <ActionCard compact phoneRow reserveTwoTitleLines
          type="button"
          data-testid="trim-slowmo-button"
          onClick={onToggleTrim}
          aria-expanded={trimOpen}
          aria-controls="frame-trim-track"
          aria-label={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_DONE : FRAMING_GUIDE.TRIM_BUTTON}
          icon={trimOpen ? Check : Scissors}
          title={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_DONE : FRAMING_GUIDE.TRIM_BUTTON}
          tooltip={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_DONE_HINT : EDITOR_PANELS.TRIM_AND_SLOWMO_HINT}
          description={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_DONE_DESC : FRAMING_GUIDE.TRIM_BUTTON_DESC}
          pressed={trimOpen}
        />
      )}

      {onTogglePreview && (
        <ActionCard compact phoneRow reserveTwoTitleLines
          type="button"
          data-testid="framing-preview-toggle"
          onClick={onTogglePreview}
          pressed={previewing}
          aria-label={previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
          icon={previewing ? EyeOff : Eye}
          title={previewing ? EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
          tooltip={EDITOR_PANELS.PREVIEW_DISCLOSURE}
          description={previewing ? EDITOR_PANELS.PREVIEW_CAPTION_RETURN : EDITOR_PANELS.PREVIEW_CAPTION_FRAMING}
          guideTarget={GUIDE_PULSE.PREVIEW}
          guideSuppress={previewing}
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
