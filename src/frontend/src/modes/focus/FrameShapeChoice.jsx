import { useState } from 'react';
import { RectangleVertical, RectangleHorizontal, ArrowLeftRight } from 'lucide-react';
import { RATIO, RATIO_ORDER, ratioLabel } from '../../constants/aspectRatios';
import { ANNOTATE } from '../../config/displayNames';
import { useGuidePulse } from '../../components/instructions/GuideScope';
import { GUIDE_PULSE } from '../../components/instructions/guideTargets';

const OPTION_HINT = {
  [RATIO.PORTRAIT]: ANNOTATE.SHARE_WHERE_PORTRAIT_HINT,
  [RATIO.LANDSCAPE]: ANNOTATE.SHARE_WHERE_LANDSCAPE_HINT,
};
const OPTION_ICON = {
  [RATIO.PORTRAIT]: RectangleVertical,
  [RATIO.LANDSCAPE]: RectangleHorizontal,
};

/**
 * FrameShapeChoice (T14770 decision 1, Option C) — "Where will you share it?"
 * Prominent while the highlight has no box positions yet (the highlight is
 * created portrait, so Portrait shows pre-selected); collapses to a small
 * chip once the first position is placed. Switching shape with positions
 * already placed asks first (in-app dialog, no native confirm) since the
 * switch re-fits every box to the new ratio server-side.
 *
 * `onChosen` fires once, the first time the parent picks a shape this
 * session (even re-picking the already-selected one) — it is the guide's
 * step-1 completion signal (`focus.progress.shareWhere` / `.cockpit.shareWhere`),
 * independent of whether the ratio itself actually changed.
 */
export default function FrameShapeChoice({ aspectRatio, hasPositions, onChange, onChosen, compact = false }) {
  const [pendingRatio, setPendingRatio] = useState(null);
  const pulseClass = useGuidePulse(GUIDE_PULSE.FRAME_SHAPE_CHOICE);

  const choose = (ratio) => {
    onChosen?.();
    if (ratio === aspectRatio) return;
    if (hasPositions) {
      setPendingRatio(ratio);
      return;
    }
    onChange?.(ratio);
  };

  const confirmSwitch = () => {
    const ratio = pendingRatio;
    setPendingRatio(null);
    if (ratio) onChange?.(ratio);
  };

  if (hasPositions) {
    const otherRatio = aspectRatio === RATIO.PORTRAIT ? RATIO.LANDSCAPE : RATIO.PORTRAIT;
    return (
      <div data-testid="focus-shape-choice" className={pulseClass}>
        <button
          type="button"
          data-testid="focus-shape-chip"
          onClick={() => choose(otherRatio)}
          aria-label={`${ratioLabel(aspectRatio)}, tap to switch shape`}
          className={`inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-slate-900/80 px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-cyan-300/40 hover:text-white transition-colors ${compact ? '' : ''}`}
        >
          {ratioLabel(aspectRatio)}
          <ArrowLeftRight size={13} aria-hidden="true" />
        </button>
        {pendingRatio && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div data-testid="focus-shape-switch-confirm" className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-sm mx-4 p-6">
              <h3 className="text-base font-semibold text-white">{ANNOTATE.switchShapeTitle(ratioLabel(pendingRatio))}</h3>
              <p className="text-sm text-gray-400 mt-1">{ANNOTATE.SWITCH_SHAPE_BODY}</p>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  type="button"
                  data-testid="focus-shape-switch-confirm-button"
                  onClick={confirmSwitch}
                  className="w-full min-h-[44px] rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400"
                >
                  {ANNOTATE.SWITCH_SHAPE_CONFIRM}
                </button>
                <button
                  type="button"
                  data-testid="focus-shape-switch-keep"
                  onClick={() => setPendingRatio(null)}
                  className="w-full min-h-[44px] rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700"
                >
                  {ANNOTATE.keepShapeLabel(ratioLabel(aspectRatio))}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="focus-shape-choice"
      role="group"
      aria-label={ANNOTATE.SHARE_WHERE_TITLE}
      className={`rounded-xl border border-white/10 bg-slate-950/55 p-3 ${pulseClass}`}
    >
      <p className="text-sm font-bold text-white mb-2">{ANNOTATE.SHARE_WHERE_TITLE}</p>
      <div className="flex gap-2">
        {RATIO_ORDER.map((ratio) => {
          const Icon = OPTION_ICON[ratio];
          const selected = ratio === aspectRatio;
          return (
            <button
              key={ratio}
              type="button"
              data-testid={`focus-shape-option-${ratio === RATIO.PORTRAIT ? 'portrait' : 'landscape'}`}
              onClick={() => choose(ratio)}
              aria-pressed={selected}
              className={`flex-1 flex flex-col items-center gap-1 rounded-lg p-2.5 transition-colors ${selected ? 'bg-cyan-600 ring-2 ring-cyan-300' : 'bg-slate-800 hover:bg-slate-700 border border-white/10'}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span className="text-xs font-semibold text-white">{ratioLabel(ratio)}</span>
              <span className="text-[10px] leading-tight text-white/70 text-center">{OPTION_HINT[ratio]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
