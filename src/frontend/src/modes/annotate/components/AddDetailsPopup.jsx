import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DetailsFields } from './DetailsFields';
import { LayerSegmentedControl } from './LayerSegmentedControl';
import { TeammateTagInput } from '../../../components/shared/TeammateTagInput';
import { DeletePlayButton } from './DeletePlayButton';
import { Z } from '../../../constants/zLayers';
import { ANNOTATE } from '../../../config/displayNames';

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
 * No backdrop-close (project's standing rule) — dismissal is the X button
 * only; Done was removed since it was a second button doing the exact same
 * thing (commit notes, close). Does NOT save beyond that notes commit; the
 * sheet's pinned rated badge / Delete play footer stays where every other
 * field is set.
 *
 * T9830: carries the (de-ambered) Sport prompt alongside Tags + Notes via the
 * shared DetailsFields. The old T8140 "mobile stays clean, no in-form sport
 * picker" rule is superseded: the picker is de-ambered and one tap behind the
 * disclosure, not an amber wall on the first-clip path. T10520: Rating no
 * longer lives here — it moved to the `PlayProgressBadges` rated badge in the
 * pinned footer underneath this popup (close this popup, or the strip header,
 * to reach it — the badge is the one place rating is set now, on every layout).
 */
export function AddDetailsPopup({
  tagSet,
  sport,
  positions,
  selectedTags,
  onTagToggle,
  onSetSport,
  notes,
  onNotesChange,
  onNotesCommit,
  storedNotes = '',
  onDone,
  // T10620: the mobile PORTRAIT strip (layout="portrait-strip") has no room for
  // category / teammates / Delete play on its two-row strip at 360px, so it
  // passes them here to live behind the disclosure. ALL OPTIONAL — the
  // inline/mobileFs hosts omit them (those keep category+teammates in the form
  // body and Delete in the pinned footer), so their popup stays byte-identical.
  myAthlete,
  onLayerChange,
  layerDisabled = false,
  layerDisabledReason = '',
  taggedTeammates = [],
  onTeammatesChange,
  teammateSuggestions = [],
  hasProject = false,
  onDelete,
}) {
  // T10610 § B.2: the textarea unmounts without blurring when this popup
  // closes, so closing must commit explicitly (same reasoning as
  // closeWithCommit). Done and X used to both call this and did the exact
  // same thing (there is no separate save step here — notes are the only
  // thing that needs a commit-on-close), so Done was removed; X alone is the
  // single dismissal, matching the "Done or X only, never both" rule below.
  const handleClose = () => {
    onNotesCommit?.();
    onDone();
  };
  return createPortal(
    <div
      className={`fixed inset-0 ${Z.MODAL} flex flex-col bg-gray-950/95`}
      role="dialog"
      aria-modal="true"
      aria-label={ANNOTATE.DETAILS}
    >
      {/* T10610: always the edit-mode accent now — there is no create mode. */}
      <div className="h-0.5 shrink-0 bg-yellow-500" />

      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <h2 className="text-base font-semibold text-white">{ANNOTATE.DETAILS}</h2>
        <button onClick={handleClose} title="Close" className="p-1.5 hover:bg-gray-800 rounded transition-colors">
          <X size={20} className="text-gray-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {/* T10620 (portrait strip only): category first, then teammates when on
            the Team layer — same per-gesture writes the form body uses. */}
        {onLayerChange && (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">{ANNOTATE.LAYER_LABEL}</label>
            <LayerSegmentedControl
              size="md"
              value={myAthlete}
              disabled={layerDisabled}
              disabledReason={layerDisabledReason}
              onChange={onLayerChange}
              className="w-full"
            />
          </div>
        )}
        {onLayerChange && !myAthlete && onTeammatesChange && (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Teammates</label>
            <TeammateTagInput
              teammates={taggedTeammates}
              onChange={onTeammatesChange}
              suggestions={teammateSuggestions}
            />
          </div>
        )}

        <DetailsFields
          tagSet={tagSet}
          sport={sport}
          positions={positions}
          selectedTags={selectedTags}
          onTagToggle={onTagToggle}
          onSetSport={onSetSport}
          notes={notes}
          onNotesChange={onNotesChange}
          onNotesCommit={onNotesCommit}
          storedNotes={storedNotes}
          notesRows={4}
        />

        {/* T10620 (portrait strip only): Delete play, moved off the strip. */}
        {onDelete && (
          <div className="mt-4 border-t border-gray-700 pt-4">
            <DeletePlayButton hasProject={hasProject} onDelete={onDelete} />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

export default AddDetailsPopup;
