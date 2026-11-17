import { Sparkles, Pencil, Loader } from 'lucide-react';
import { FINISHED_REDO } from '../config/displayNames';

/**
 * FinishedRedoActions (T16530) - the Finished screen's two redo choices, side by
 * side under Share: Add (or Redo) spotlight, free, and Edit zoom, which sharpens
 * again and uses credits. Presentational: DraftReelPreview owns the gestures.
 *
 * @param {boolean} hasSpotlight   - Redo spotlight instead of Add spotlight
 * @param {Function} onSpotlight   - opens Spotlight for this highlight
 * @param {Function} onEditZoom    - opens the Edit zoom confirmation
 * @param {boolean=} spotlightBusy - spins the spotlight choice
 * @param {boolean=} editZoomBusy  - spins the Edit zoom choice
 */
export function FinishedRedoActions({ hasSpotlight, onSpotlight, onEditZoom, spotlightBusy = false, editZoomBusy = false }) {
  const choices = [
    {
      testId: 'finished-redo-spotlight',
      icon: spotlightBusy ? Loader : Sparkles,
      busy: spotlightBusy,
      label: hasSpotlight ? FINISHED_REDO.REDO_SPOTLIGHT_LABEL : FINISHED_REDO.ADD_SPOTLIGHT_LABEL,
      caption: hasSpotlight ? FINISHED_REDO.REDO_SPOTLIGHT_CAPTION : FINISHED_REDO.ADD_SPOTLIGHT_CAPTION,
      onClick: onSpotlight,
    },
    {
      testId: 'finished-edit-zoom',
      icon: editZoomBusy ? Loader : Pencil,
      busy: editZoomBusy,
      label: FINISHED_REDO.EDIT_ZOOM_LABEL,
      caption: FINISHED_REDO.EDIT_ZOOM_CAPTION,
      onClick: onEditZoom,
    },
  ];
  return (
    <div data-testid="finished-redo-actions" className="grid grid-cols-2 gap-2 px-3 py-2">
      {choices.map(({ testId, icon: Icon, busy, label, caption, onClick }) => (
        <button
          key={testId}
          type="button"
          data-testid={testId}
          onClick={onClick}
          disabled={spotlightBusy || editZoomBusy}
          aria-busy={busy}
          className="flex min-w-0 items-start gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-left hover:bg-gray-700 disabled:opacity-60"
        >
          <Icon size={16} className={`mt-0.5 shrink-0 text-cyan-300 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-white">{label}</span>
            <span className="block text-[11px] leading-snug text-gray-400">{caption}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default FinishedRedoActions;
