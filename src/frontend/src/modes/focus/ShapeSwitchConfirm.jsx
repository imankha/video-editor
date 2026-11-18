import { createPortal } from 'react-dom';
import { ratioLabel } from '../../constants/aspectRatios';
import { ANNOTATE } from '../../config/displayNames';
import { Z } from '../../constants/zLayers';

/**
 * ShapeSwitchConfirm (T17230, lifted from FrameShapeChoice) -- "Switch to landscape?"
 * asked before a shape change once the highlight has box positions, since the switch
 * re-fits every box to the new ratio server-side. Shared by the first-run chooser and
 * the Settings "Shape" row so a switch asks first from wherever it is changed.
 *
 * T15400: portaled to document.body. Its Focus ancestor carries `backdrop-blur-lg`, and a
 * `backdrop-filter` on an ancestor becomes the containing block of a `position:fixed`
 * descendant, so an inline backdrop was clipped short of the sticky ActionBand and let taps
 * fall through to the band underneath.
 */
export default function ShapeSwitchConfirm({ fromRatio, toRatio, onConfirm, onKeep }) {
  return createPortal(
    <div className={`fixed inset-0 ${Z.MODAL} flex items-center justify-center bg-black/60 backdrop-blur-sm`}>
      <div data-testid="focus-shape-switch-confirm" className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-sm mx-4 p-6">
        <h3 className="text-base font-semibold text-white">{ANNOTATE.switchShapeTitle(ratioLabel(toRatio))}</h3>
        <p className="text-sm text-gray-400 mt-1">{ANNOTATE.SWITCH_SHAPE_BODY}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            data-testid="focus-shape-switch-confirm-button"
            onClick={onConfirm}
            className="w-full min-h-[44px] rounded-lg bg-cyan-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-400"
          >
            {ANNOTATE.SWITCH_SHAPE_CONFIRM}
          </button>
          <button
            type="button"
            data-testid="focus-shape-switch-keep"
            onClick={onKeep}
            className="w-full min-h-[44px] rounded-lg border border-gray-600 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700"
          >
            {ANNOTATE.keepShapeLabel(ratioLabel(fromRatio))}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
