import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { STAGE_REASONS, FRAMING_INSTRUCTIONS } from '../../config/displayNames';

/**
 * FramingInstructions (T9610) — a visible instructional sequence that teaches a
 * first-time parent to frame their player, plus a prompt to PREVIEW the result by
 * pressing play before paying for a render.
 *
 * Why it exists: the framing screen used to say "Set crop keyframes so the focus
 * follows your athlete" — "keyframe" assumes video-editing knowledge. This replaces
 * that with plain-language instructions (move the box, replay, re-adjust, use slo-mo)
 * and names the primitive with the ONE shared noun, `EDITOR_PANELS.FOCUS_POINT`
 * ("Focus point", owned by T9550) — never "keyframe" in this parent-facing copy.
 *
 * The movement PREVIEW is not new machinery: pressing play already animates the crop
 * box along the interpolated path between focus points (FocusScreen `currentCropState`
 * = `interpolateCrop(currentTime)`, driven by useVideo's rAF loop). This component's
 * job is only to make that preview OBVIOUS — hence the "press play to preview" prompt,
 * emphasized once the parent has placed two focus points.
 *
 * Collapse behaviour: shown expanded until the first framing success (two focus
 * points), then it collapses to a compact preview prompt for experienced users. The
 * expand/collapse state is EPHEMERAL view state (no-persisted-view-state rule,
 * precedent T5641 straightenVisible) — a gesture override on top of the derived
 * default, never a useEffect that syncs to it.
 *
 * @param {number} focusPointCount - how many focus points the parent has placed
 * @param {boolean} expanded - resolved expanded/collapsed state (derived + override)
 * @param {() => void} onToggle - flip the expand/collapse (gesture)
 */
export default function FramingInstructions({ focusPointCount = 0, expanded, onToggle }) {
  const hasFramingSuccess = focusPointCount >= 2;

  return (
    <div
      data-testid="framing-instructions"
      className="rounded-lg border border-white/15 bg-white/5"
    >
      <button
        type="button"
        data-testid="framing-instructions-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span className="truncate text-sm font-semibold text-white">
          {expanded ? FRAMING_INSTRUCTIONS.HEADER : FRAMING_INSTRUCTIONS.COLLAPSED_HEADER}
        </span>
        {expanded
          ? <ChevronUp size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronDown size={16} className="shrink-0 text-gray-400" aria-hidden="true" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          {/* T9860 3.5: one reason per stage, stated before the mechanics — sized up
              (2026-09-18 user request) so it reads as the headline, not a footnote. */}
          <p className="mt-2 text-sm font-medium text-gray-200">{STAGE_REASONS.FRAMING}</p>

          {/* T11710: plain instructional copy that NAMES the drag gesture and the
              Set focus point button — the thing the previous copy never did. Copy
              single-sourced in displayNames (FRAMING_INSTRUCTIONS). text-sm/gray-300
              for contrast against the translucent panel (2026-09-20 legibility fix). */}
          <p data-testid="framing-instructions-steps" className="mt-2 text-sm text-gray-300">
            {FRAMING_INSTRUCTIONS.STEPS}
          </p>

          {/* The only allowed motion claim ("moves smoothly between the focus points
              you set") lives here — no track/follow/center claim. */}
          <p className="mt-2 text-sm text-gray-300">
            {FRAMING_INSTRUCTIONS.SECOND}
          </p>

          <p className="mt-2 text-sm text-gray-300">
            {FRAMING_INSTRUCTIONS.THIRD}
          </p>

          {/* The preview prompt — emphasized once two focus points exist (the box now
              has a path to animate along). Points at ordinary playback, not a render. */}
          <p
            data-testid="framing-preview-prompt"
            className={`mt-2 flex items-center gap-2 text-sm ${
              hasFramingSuccess ? 'font-medium text-blue-200' : 'text-gray-300'
            }`}
          >
            <Play size={14} className="shrink-0" aria-hidden="true" />
            <span>{FRAMING_INSTRUCTIONS.PREVIEW_PROMPT}</span>
          </p>
        </div>
      )}
    </div>
  );
}
