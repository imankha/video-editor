import ActionCard from '../../components/shared/ActionCard';
import { GUIDE_PULSE } from '../../components/instructions/guideTargets';
import { Eye, EyeOff, Scissors } from 'lucide-react';
import { EDITOR_PANELS, FRAMING_GUIDE } from '../../config/displayNames';

/**
 * FramingActionRow - [Trim and SlowMo] + [Preview highlight].
 * Pure presentational: props in, callbacks out, no store reads.
 *
 * Rendered inline in the ActionBand BEFORE Sharpen my highlight (T17910: working
 * order Trim, Preview, Sharpen): on a phone the two tiles share a row with Sharpen
 * full width beneath; from `sm` up all three sit in one row.
 *
 * T14830 (owner ruling 2026-11-07, "Confirm once"): never locked by drag or
 * Play. Trim and SlowMo toggles the timeline's segment/speed/trim track
 * (`trimOpen`).
 *
 * T17860 (owner ruling 2026-11-19): open, Trim gets the pressed look (ActionCard `pressed`);
 * Preview gets the same look while previewing. T17910: the open labels are "Close trimming"
 * (scissors kept) and "Close preview". The T9950 preview disclosure moved out of this row
 * (it added a band row and moved Sharpen): ExportButtonView's status cell from `sm` up, a
 * caption on the video on phones. Both labels change with state,
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
          aria-label={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_CLOSE : FRAMING_GUIDE.TRIM_BUTTON}
          icon={Scissors}
          title={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_CLOSE : FRAMING_GUIDE.TRIM_BUTTON}
          tooltip={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_CLOSE_HINT : EDITOR_PANELS.TRIM_AND_SLOWMO_HINT}
          description={trimOpen ? FRAMING_GUIDE.TRIM_BUTTON_CLOSE_DESC : FRAMING_GUIDE.TRIM_BUTTON_DESC}
          pressed={trimOpen}
        />
      )}

      {onTogglePreview && (
        <ActionCard compact phoneRow reserveTwoTitleLines
          type="button"
          data-testid="framing-preview-toggle"
          onClick={onTogglePreview}
          pressed={previewing}
          aria-label={previewing ? EDITOR_PANELS.PREVIEW_CLOSE : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
          icon={previewing ? EyeOff : Eye}
          title={previewing ? EDITOR_PANELS.PREVIEW_CLOSE : EDITOR_PANELS.PREVIEW_HIGHLIGHT}
          tooltip={EDITOR_PANELS.PREVIEW_DISCLOSURE}
          description={previewing ? EDITOR_PANELS.PREVIEW_CAPTION_RETURN : EDITOR_PANELS.PREVIEW_CAPTION_FRAMING}
          guideTarget={GUIDE_PULSE.PREVIEW}
          guideSuppress={previewing}
        />
      )}
    </div>
  );
}
