import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DetailsFields } from './DetailsFields';
import { Z } from '../../../constants/zLayers';

/**
 * AddDetailsPopup (T8600 C1) — mobile-only full-screen takeover for the
 * "Optional details" disclosure, opened from the "Add details" button inside
 * AnnotateFullscreenOverlay's mobile (`layout="inline"`, isMobile) form body.
 * Not the mobile version of the desktop expand-in-place panel (that one is inline
 * JSX inside the strip / formBody) — this is its own standalone component,
 * portaled to `document.body` so it can escape the T8140 bottom sheet's own
 * stacking context (a z-index cannot escape an ancestor's stacking context, the
 * T5700 clip-marker-tooltip landmine).
 *
 * No backdrop-close — dismissal is Done or X only (project's standing rule).
 * Does NOT save; the sheet's pinned Save footer stays the only save gesture.
 *
 * T9830: now carries Rating + the (de-ambered) Sport prompt alongside Tags +
 * Notes via the shared DetailsFields — rating is an OPTIONAL detail now, so it
 * lives behind the disclosure on mobile too. The old T8140 "mobile stays clean,
 * no in-form sport picker" rule is superseded: the picker is de-ambered and one
 * tap behind the disclosure, not an amber wall on the first-clip path.
 */
export function AddDetailsPopup({
  isEditMode,
  rating,
  onRatingChange,
  tagSet,
  sport,
  positions,
  selectedTags,
  onTagToggle,
  onSetSport,
  notes,
  onNotesChange,
  onDone,
}) {
  return createPortal(
    <div
      className={`fixed inset-0 ${Z.MODAL} flex flex-col bg-gray-950/95`}
      role="dialog"
      aria-modal="true"
      aria-label="Add details"
    >
      <div className={`h-0.5 shrink-0 ${isEditMode ? 'bg-yellow-500' : 'bg-green-500'}`} />

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <h2 className="text-base font-semibold text-white">Add details</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onDone}
            className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Done
          </button>
          <button onClick={onDone} title="Close" className="p-1.5 hover:bg-gray-800 rounded transition-colors">
            <X size={20} className="text-gray-400" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <DetailsFields
          rating={rating}
          onRatingChange={onRatingChange}
          tagSet={tagSet}
          sport={sport}
          positions={positions}
          selectedTags={selectedTags}
          onTagToggle={onTagToggle}
          onSetSport={onSetSport}
          notes={notes}
          onNotesChange={onNotesChange}
          notesRows={4}
        />
      </div>
    </div>,
    document.body
  );
}

export default AddDetailsPopup;
