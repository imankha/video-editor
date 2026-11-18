import { RectangleVertical, RectangleHorizontal } from 'lucide-react';
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
 * created portrait, so Portrait shows pre-selected). T17230: it disappears
 * once the first position is placed; from then on the shape is changed in
 * Settings ("Shape"), which asks first (ShapeSwitchConfirm).
 *
 * `onChosen` fires once, the first time the parent picks a shape this
 * session (even re-picking the already-selected one) — it is the guide's
 * step-1 completion signal (`focus.progress.shareWhere` / `.cockpit.shareWhere`),
 * independent of whether the ratio itself actually changed.
 */
export default function FrameShapeChoice({ aspectRatio, hasPositions, onChange, onChosen }) {
  const pulseClass = useGuidePulse(GUIDE_PULSE.FRAME_SHAPE_CHOICE);

  // T17230: first-run step only. Once a position is placed the lasting control is the
  // Settings "Shape" row (FocusSettingsPanel), which asks before a switch; no chip here.
  if (hasPositions) return null;

  const choose = (ratio) => {
    onChosen?.();
    if (ratio !== aspectRatio) onChange?.(ratio);
  };

  return (
    <div
      data-testid="focus-shape-choice"
      role="group"
      aria-label={ANNOTATE.SHARE_WHERE_TITLE}
      // T16640: one row on desktop (lg) -- title beside the options, each option a single
      // line -- so the chooser takes ~50px instead of ~130px of a 1280x800 laptop's height.
      className={`rounded-xl border border-white/10 bg-slate-950/55 p-3 lg:flex lg:items-center lg:gap-3 lg:py-2 ${pulseClass}`}
    >
      <p className="text-sm font-bold text-white mb-2 lg:mb-0 lg:shrink-0">{ANNOTATE.SHARE_WHERE_TITLE}</p>
      <div className="flex gap-2 lg:flex-1">
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
              className={`flex-1 flex flex-col items-center gap-1 rounded-lg p-2.5 lg:flex-row lg:justify-center lg:gap-2 lg:py-1.5 transition-colors ${selected ? 'bg-cyan-600 ring-2 ring-cyan-300' : 'bg-slate-800 hover:bg-slate-700 border border-white/10'}`}
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
