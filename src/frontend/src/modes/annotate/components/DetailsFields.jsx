import { StarRating } from '../../../components/shared/StarRating';
import { TagSelector } from '../../../components/shared/TagSelector';
import { NoSportTagWarning } from '../../../components/shared/NoSportTagWarning';
import { NO_SPORT } from '../constants/tagRegistry';

/**
 * DetailsFields (T9830) — the shared body of the "Optional details" disclosure:
 * Rating, Sport (when unset), Tags and Notes. Rendered in THREE places so the
 * disclosure carries the same fields on every layout (3rd duplication -> extract):
 *   1. the desktop strip's expand-in-place panel,
 *   2. the desktop formBody's expand-in-place panel,
 *   3. the mobile full-screen AddDetailsPopup.
 *
 * Rating moved in here because it no longer gates clip creation (T9830): the two
 * explicit Save outcomes ("Create an editable clip" / "Save play") replace the
 * rating-driven default, so rating is descriptive metadata, i.e. an optional
 * detail. The no_sport prompt is the DE-AMBERED NoSportTagWarning (a neutral
 * "pick your sport for tags" nudge, not a warning). Notes uses the stable
 * `clip-notes` id/label; only one DetailsFields ever mounts at a time (the three
 * host surfaces are mutually exclusive by layout/viewport), so the id is unique.
 */
export function DetailsFields({
  rating,
  onRatingChange,
  showKeyHint = false,
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
      {/* T10410: stable id so the "Rate this play" progress badge can focus the
          stars (same contract as the `clip-notes` id below: one mount at a time). */}
      <div id="clip-rating" className="mb-4">
        <label className="block text-gray-400 text-sm mb-2">
          Rating{showKeyHint ? ' (press 1-5)' : ''}
        </label>
        <StarRating rating={rating} onRatingChange={onRatingChange} size={24} showLabel />
      </div>

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
