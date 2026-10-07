import { FRAMING_GUIDE } from '../../config/displayNames';
import { InstructionCoach } from '../../components/instructions';

/**
 * FramingGuide - the Focus screen's single-instruction coach.
 *
 * Shows exactly ONE instruction at a time (drag the box, play, keep the box on
 * your player, or one of the two trim instructions). Pure presentational: the
 * screen derives `text` and `step`; this only renders them. Replaces the old
 * collapsible multi-paragraph instructions panel.
 *
 * @param {string} text - the one instruction to show
 * @param {number|null} step - 1..total for the numbered steps, null for trim help
 * @param {number} total - number of numbered steps (drag, play, keep, preview, generate)
 */
export default function FramingGuide({ text, step = null, total = 5 }) {
  return (
    <InstructionCoach
      data-testid="framing-guide"
      className="flex items-center gap-3"
      phase={step != null ? `step-${step}` : 'contextual'}
    >
      {step != null && (
        <span
          data-testid="framing-guide-step"
          className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-semibold text-amber-200"
        >
          {FRAMING_GUIDE.STEP_LABEL(step, total)}
        </span>
      )}
      <p data-testid="framing-guide-text" aria-live="polite" className="text-sm font-medium text-white">
        {text}
      </p>
    </InstructionCoach>
  );
}
