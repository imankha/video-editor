import { TagSelector } from '../../../components/shared/TagSelector';
import { NoSportTagWarning } from '../../../components/shared/NoSportTagWarning';
import { NO_SPORT } from '../constants/tagRegistry';

/**
 * DetailsFields (T9830) — the shared body of the "Optional details" disclosure:
 * Sport (when unset), Tags and Notes. Rendered in THREE places so the
 * disclosure carries the same fields on every layout (3rd duplication -> extract):
 *   1. the desktop strip's expand-in-place panel,
 *   2. the desktop formBody's expand-in-place panel,
 *   3. the mobile full-screen AddDetailsPopup.
 *
 * T10520: Rating moved OUT of here — the `PlayProgressBadges` rated badge is
 * now the ONLY way to set a rating (a popup star picker anchored to the
 * badge itself), replacing the duplicate horizontal star row this component
 * used to carry. The one exception is the landscape-inline layout, which has
 * no badges at all (height-starved) and keeps its own bespoke `StarRating`
 * row — that one lives directly in `AnnotateFullscreenOverlay.jsx`, not here.
 *
 * The no_sport prompt is the DE-AMBERED NoSportTagWarning (a neutral
 * "pick your sport for tags" nudge, not a warning). Notes uses the stable
 * `clip-notes` id/label; only one DetailsFields ever mounts at a time (the three
 * host surfaces are mutually exclusive by layout/viewport), so the id is unique.
 */
export function DetailsFields({
  tagSet,
  sport,
  positions,
  selectedTags,
  onTagToggle,
  onSetSport,
  notes,
  onNotesChange,
  notesRows = 2,
}) {
  return (
    <>
      {tagSet ? (
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
      ) : sport === NO_SPORT ? (
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Tags</label>
          <NoSportTagWarning onChange={onSetSport} />
        </div>
      ) : null}

      <div>
        <label htmlFor="clip-notes" className="block text-gray-400 text-sm mb-2">Notes (optional)</label>
        <textarea
          id="clip-notes"
          value={notes}
          onChange={onNotesChange}
          placeholder="Add a note about this clip..."
          className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 resize-none"
          rows={notesRows}
        />
      </div>
    </>
  );
}

export default DetailsFields;
