import { ChevronDown, ChevronUp, Play } from 'lucide-react';
import { EDITOR_PANELS } from '../../config/displayNames';

/**
 * FramingInstructions (T9610) — a visible three-step sequence that teaches a
 * first-time parent to frame their player, plus a prompt to PREVIEW the result by
 * pressing play before paying for a render.
 *
 * Why it exists: the framing screen used to say "Set crop keyframes so the focus
 * follows your athlete" — "keyframe" assumes video-editing knowledge. This replaces
 * that with a plain-language sequence (move the box → step forward → move it again)
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
  const noun = EDITOR_PANELS.FOCUS_POINT.toLowerCase();
  const hasFramingSuccess = focusPointCount >= 2;

  const steps = [
    `Move the box over your player.`,
    `Step forward in the video.`,
    `Move the box again to follow them.`,
  ];

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
        <span className="flex items-center gap-2 min-w-0">
          {!expanded && <Play size={14} className="shrink-0 text-blue-300" aria-hidden="true" />}
          <span className="truncate text-sm font-semibold text-white">
            {expanded ? 'Frame your player' : 'Press play to preview your framing before exporting'}
          </span>
        </span>
        {expanded
          ? <ChevronUp size={16} className="shrink-0 text-gray-400" aria-hidden="true" />
          : <ChevronDown size={16} className="shrink-0 text-gray-400" aria-hidden="true" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3">
          <ol className="flex flex-col gap-1.5">
            {steps.map((text, i) => (
              <li key={i} className="flex items-center gap-2.5 text-sm text-gray-200">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
                  {i + 1}
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ol>

          {/* Distinguish the MANUAL focus points from the mode's automatic reframing,
              so the capability is neither over- nor under-claimed. */}
          <p className="mt-2 text-xs text-gray-400">
            Each spot you set is a {noun}. Your reel moves smoothly between the {noun}s
            you place by hand.
          </p>

          {/* The preview prompt — emphasized once two focus points exist (the box now
              has a path to animate along). Points at ordinary playback, not a render. */}
          <p
            data-testid="framing-preview-prompt"
            className={`mt-2 flex items-center gap-2 text-sm ${
              hasFramingSuccess ? 'font-medium text-blue-200' : 'text-gray-400'
            }`}
          >
            <Play size={14} className="shrink-0" aria-hidden="true" />
            <span>Press play to preview how your reel follows your player — before you export.</span>
          </p>
        </div>
      )}
    </div>
  );
}
