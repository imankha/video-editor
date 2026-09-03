import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { NO_SPORT } from '../constants/tagRegistry';
import { TagSelector } from '../../../components/shared/TagSelector';
import { Z } from '../../../constants/zLayers';

/**
 * AddDetailsPopup (T8600 C1) — mobile-only full-screen takeover for Tags +
 * Notes, opened from the "Add details" disclosure inside AnnotateFullscreenOverlay's
 * mobile (`layout="inline"`, isMobile) form body. Not the mobile version of the
 * desktop expand-in-place panel (that one is inline JSX inside the strip) — this
 * is its own standalone component, portaled to `document.body` so it can escape
 * the T8140 bottom sheet's own stacking context (a z-index cannot escape an
 * ancestor's stacking context, the T5700 clip-marker-tooltip landmine).
 *
 * No backdrop-close — dismissal is Done or X only (project's standing rule).
 * Does NOT save; the sheet's pinned Save footer stays the only save gesture.
 *
 * The no_sport amber warning is deliberately NOT rendered here (T8140: mobile
 * stays clean, the full-screen sport question fires at first save instead) —
 * a sport-less mobile clip simply shows no Tags block until a sport is picked.
 */
export function AddDetailsPopup({
  isEditMode,
  tagSet,
  sport,
  positions,
  selectedTags,
  onTagToggle,
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
        {tagSet && sport !== NO_SPORT && (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Tags</label>
            <TagSelector
              positions={positions}
              tagsByPosition={tagSet.tags}
              selectedTags={selectedTags}
              onTagToggle={onTagToggle}
              size="lg"
            />
          </div>
        )}

        <div>
          <label className="block text-gray-400 text-sm mb-2">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={onNotesChange}
            placeholder="Add a note about this clip..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 resize-none"
            rows={4}
          />
        </div>
      </div>
    </div>,
    document.body
  );
}

export default AddDetailsPopup;
