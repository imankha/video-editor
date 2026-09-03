import React, { useState, useEffect, useCallback } from 'react';
import { Trash2, Star, Check, Plus, Crop, Sparkles } from 'lucide-react';
import { getPositions, getTagSet, NO_SPORT } from '../constants/tagRegistry';
import { generateClipName } from '../../../utils/clipDisplayName';
import { TagSelector } from '../../../components/shared/TagSelector';
import { NoSportTagWarning } from '../../../components/shared/NoSportTagWarning';
import { TeammateTagInput } from '../../../components/shared/TeammateTagInput';
import { useCurrentProfile, useProfileStore, useProjectsList } from '../../../stores';
import { maybeRecordRatedAndTagged } from '../../../utils/questAchievements';
import { useIsMobile } from '../../../hooks/useIsMobile';
import ClipScrubRegion from './ClipScrubRegion';
import { Button } from '../../../components/shared/Button';
import { LayerSegmentedControl } from './LayerSegmentedControl';

// Rating-based background colors (used for tinting the details panel)
const RATING_COLORS = {
  5: 'rgba(234, 179, 8, 0.15)',   // gold/yellow
  4: 'rgba(34, 197, 94, 0.15)',   // green
  3: 'rgba(59, 130, 246, 0.15)',  // blue
  2: 'rgba(249, 115, 22, 0.15)',  // orange
  1: 'rgba(239, 68, 68, 0.15)',   // red
};

// Rating-based border colors
const RATING_BORDER_COLORS = {
  5: '#eab308', // gold/yellow
  4: '#22c55e', // green
  3: '#3b82f6', // blue
  2: '#f97316', // orange
  1: '#ef4444', // red
};

/**
 * StarRating - 5-star rating selector
 */
function StarRating({ rating, onRatingChange }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((starNum) => (
        <button
          key={starNum}
          onClick={() => onRatingChange(starNum)}
          className="p-0.5 hover:scale-110 transition-transform"
          title={`${starNum} star${starNum > 1 ? 's' : ''}`}
        >
          <Star
            size={18}
            fill={starNum <= rating ? '#fbbf24' : 'transparent'}
            color={starNum <= rating ? '#fbbf24' : '#6b7280'}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}

/**
 * ClipDetailsEditor - Edit panel for selected clip details
 *
 * Editable fields:
 * - Star rating (1-5)
 * - Name
 * - End time (editable - this is where playhead was when clip was created)
 * - Duration (slider)
 * - Notes
 *
 * Read-only:
 * - Start time (calculated from end - duration)
 */
export function ClipDetailsEditor({
  region,
  onUpdate,
  onDelete,
  maxNotesLength = 280,
  videoDuration,
  onSeek,
  videoController,
  onScrubLock,
  onScrubUnlock,
  teammateSuggestions = [],
  onOpenInFocus,
  onOpenInOverlay,
}) {
  const isMobile = useIsMobile();
  const currentProfile = useCurrentProfile();
  const updateProfile = useProfileStore(state => state.updateProfile);
  const sport = currentProfile?.sport || NO_SPORT;
  const tagSet = getTagSet(sport);

  // T7922: picking a sport from the inline no_sport Tag picker. Optimistic +
  // rolled back in the store; swallow the rejection here (store logs + reverts).
  const handleSetSport = useCallback((nextSport) => {
    if (!currentProfile?.id) return;
    updateProfile(currentProfile.id, { sport: nextSport }).catch(() => {});
  }, [updateProfile, currentProfile?.id]);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [reelRequested, setReelRequested] = useState(false);

  // Local scrub state — same pattern as AnnotateFullscreenOverlay.
  // Dragging updates local state instantly; persisted to parent on change.
  const [scrubStartTime, setScrubStartTime] = useState(region.startTime);
  const [scrubEndTime, setScrubEndTime] = useState(region.endTime);

  // Sync local state only when switching to a different clip.
  // Do NOT sync on region.startTime/endTime changes — during drag, local state
  // is authoritative and the parent round-trip would fight with it.
  useEffect(() => {
    setScrubStartTime(region.startTime);
    setScrubEndTime(region.endTime);
    setReelRequested(false);
  }, [region.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasReel = !!region.autoProjectId;
  const notesLength = region.notes?.length || 0;

  // T8060: once a reel exists, the Reel control tracks it through Focus ->
  // Overlay -> Completed/Published, using the same has_working_video/
  // has_final_video/is_published fields DraftTile already reads for the
  // Clips list — no separate stage computation to keep in sync.
  const projects = useProjectsList();
  const linkedProject = hasReel ? projects.find(p => p.id === region.autoProjectId) : null;

  // T8070: the reel's produced working_video/final_video were rendered from a
  // specific start/end window, snapshotted onto the raw_clip
  // (reelSourceStartTime/EndTime) at export completion. Only surface the produced
  // stage while the clip's CURRENT boundaries still match that window EXACTLY
  // (exact equality, no epsilon — a genuine nudge is a real drift). Editing the
  // clip's start/end after producing the reel drops the control back to
  // "Create Reel"; reverting to the exact producing values restores the produced
  // status (the snapshot is frozen until the NEXT export, so this is a pure value
  // comparison). Display-level only — region.autoProjectId is never mutated by it.
  const reelReflectsClip =
    hasReel &&
    region.reelSourceStartTime != null &&
    region.reelSourceEndTime != null &&
    region.startTime === region.reelSourceStartTime &&
    region.endTime === region.reelSourceEndTime;

  // T8470 (Part D): a reel EXISTS the moment project_created lands (autoProjectId
  // is set), but a fresh draft has no reel-source snapshot yet (only set at export
  // completion) and no produced video - so reelReflectsClip is false and the
  // control used to fall through to an ACTIONABLE "Create Reel", a dead-end that
  // offers to create a reel that already exists. Detect that state and turn it
  // into a live "Open reel (Draft)" link instead. Deliberately narrow: a
  // below-migration reel with a produced video but a null snapshot (has_working_
  // video / has_final_video) still shows "Create Reel" so it can be re-produced,
  // and a DRIFTED reel (non-null snapshot) is untouched.
  const reelIsFreshDraft =
    hasReel &&
    region.reelSourceStartTime == null &&
    region.reelSourceEndTime == null &&
    !linkedProject?.has_working_video &&
    !linkedProject?.has_final_video;

  // T5725: teammate tagging is a Team-layer-only affordance. Legacy-NULL rule
  // (`my_athlete ?? true` => My Athlete) — never read region.my_athlete bare.
  const isTeamLayer = (region.my_athlete ?? true) === false;

  // Derive display name from region.name or auto-generate from rating+tags
  const displayName = region.name || generateClipName(region.rating || 3, region.tags || [], region.notes || '') || '';
  const isAutoGenerated = !region.name && (region.tags?.length > 0 || region.notes?.trim());

  const handleNameChange = (e) => {
    // Store whatever the user types - empty string means "use auto-generated"
    onUpdate({ name: e.target.value });
  };

  const handleRatingChange = (newRating) => {
    // Only update rating, don't touch the name
    onUpdate({ rating: newRating });
    // Fire only if the clip will now have both a rating and a tag.
    maybeRecordRatedAndTagged(newRating, region.tags);
  };

  const handleTagToggle = (tagName) => {
    const currentTags = region.tags || [];
    const newTags = currentTags.includes(tagName)
      ? currentTags.filter((t) => t !== tagName)
      : [...currentTags, tagName];

    // Only update tags, don't touch the name
    onUpdate({ tags: newTags });
    // Fire only if the clip now has both a rating and a tag.
    maybeRecordRatedAndTagged(region.rating, newTags);
  };

  // During drag: only update local state (instant, no parent re-render)
  const handleStartTimeChange = useCallback((newStart) => {
    setScrubStartTime(newStart);
  }, []);

  const handleEndTimeChange = useCallback((newEnd) => {
    setScrubEndTime(newEnd);
  }, []);

  // Lock auto-deselect while scrubbing so onSeek doesn't close the sidebar
  const handleDragStart = useCallback(() => {
    onScrubLock?.();
  }, [onScrubLock]);

  // On drag end: persist, unlock auto-deselect, seek to new start so
  // currentTime is within the updated clip range
  const handleDragEnd = useCallback((finalStart, finalEnd) => {
    onScrubUnlock?.();
    onUpdate({ startTime: finalStart, endTime: finalEnd });
    onSeek?.(finalStart);
  }, [onScrubUnlock, onUpdate, onSeek]);

  const handleNotesChange = (e) => {
    const newNotes = e.target.value.slice(0, maxNotesLength);
    onUpdate({ notes: newNotes });
  };

  const handleTeammatesChange = (newTeammates) => {
    onUpdate({ tagged_teammates: newTeammates });
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowDeleteConfirm(false);
    onDelete();
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const rating = region.rating || 3;
  const ratingColor = RATING_COLORS[rating] || RATING_COLORS[3];
  const ratingBorderColor = RATING_BORDER_COLORS[rating] || RATING_BORDER_COLORS[3];

  return (
    <div
      data-clip-details
      className="border-t-2"
      style={{
        backgroundColor: ratingColor,
        borderTopColor: ratingBorderColor,
      }}
    >
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="text-gray-400 text-xs uppercase tracking-wider">
          Clip Details
        </div>

        {region.shared_by && (
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-purple-900/30 border border-purple-700/40">
            <span className="text-gray-400 text-xs">Shared by</span>
            <span className="text-white text-xs font-medium">{region.shared_by}</span>
          </div>
        )}

        {/* Clip scrub region — same visual timeline used in the Add/Edit overlay.
            onScrubLock/onScrubUnlock suppress auto-deselect during drag so that
            onSeek can preview frames without closing the sidebar. */}
        <ClipScrubRegion
          currentTime={region.startTime + (region.endTime - region.startTime) / 2}
          videoDuration={videoDuration}
          existingClip={region}
          startTime={scrubStartTime}
          endTime={scrubEndTime}
          onStartTimeChange={handleStartTimeChange}
          onEndTimeChange={handleEndTimeChange}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onSeek={onSeek}
          videoController={videoController}
        />

        {/* Star Rating */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs w-16 shrink-0">Rating</label>
          <StarRating
            rating={region.rating || 3}
            onRatingChange={handleRatingChange}
          />
        </div>

        {/* Tags Selection */}
        {tagSet ? (
          <div>
            <label className="block text-gray-400 text-xs mb-1">Tags</label>
            <TagSelector
              positions={getPositions(sport)}
              tagsByPosition={tagSet.tags}
              selectedTags={region.tags || []}
              onTagToggle={handleTagToggle}
            />
          </div>
        ) : sport === NO_SPORT ? (
          <div>
            <label className="block text-gray-400 text-xs mb-1">Tags</label>
            <NoSportTagWarning onChange={handleSetSport} />
          </div>
        ) : null}

        {/* Name Input */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs w-16 shrink-0">
            Name
            {isAutoGenerated && <span className="text-gray-500 ml-1">(auto)</span>}
          </label>
          <input
            type="text"
            value={displayName}
            onChange={handleNameChange}
            className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
            placeholder="Clip name"
          />
        </div>

        {/* Notes Textarea — desktop only */}
        {!isMobile && (
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-gray-400 text-xs">Notes</label>
              <span className={`text-xs ${notesLength >= maxNotesLength ? 'text-red-400' : 'text-gray-500'}`}>
                {notesLength}/{maxNotesLength}
              </span>
            </div>
            <textarea
              value={region.notes || ''}
              onChange={handleNotesChange}
              className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Add notes (shown as overlay during playback)"
              rows={3}
            />
          </div>
        )}

        {/* Layer — replaces the old My Athlete on/off toggle. Rendered on BOTH
            mobile-takeover and desktop now (drop the old !isMobile guard): the
            mobile detail view uses this same editor (ClipsSidePanel.jsx). Locked
            to Team, read-only, for imported clips (shared_by set) — the My
            Athlete layer feeds reels/rankings/collections, and promoting
            someone else's annotation into it would misattribute content and
            regress T5330 quest-blindness (T5700, epic decision 2). */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs w-16 shrink-0">Layer</label>
          <LayerSegmentedControl
            size="sm"
            value={region.my_athlete ?? true}
            disabled={!!region.shared_by}
            disabledReason={region.shared_by ? `Shared by ${region.shared_by} — imported clips stay on the Team layer` : ''}
            onChange={(mine) => onUpdate(
              // T5725: switching TO My Athlete clears teammate tags in the SAME
              // gesture — teammates are Team-layer-only, so a My Athlete clip
              // must never carry them. A legitimate gesture-scoped write, and it
              // is VISIBLE: the Teammates block (with its chips) disappears as
              // the control hides. Chosen over leave-and-hide, which would leave
              // an invisible contradiction the migration would later reverse.
              mine ? { my_athlete: true, tagged_teammates: [] } : { my_athlete: false }
            )}
            className="flex-1"
          />
        </div>

        {/* Teammates — Team-layer only (T5725). Shown on BOTH desktop and mobile
            now (dropped the old !isMobile gate): teammate tagging is the sole
            affordance that reveals only on the Team layer, per the epic's
            teammates-imply-Team model. Hidden entirely on a My Athlete clip. */}
        {isTeamLayer && (
          <div>
            <label className="block text-gray-400 text-xs mb-1">Teammates</label>
            <TeammateTagInput
              teammates={region.tagged_teammates || []}
              onChange={handleTeammatesChange}
              suggestions={teammateSuggestions}
            />
          </div>
        )}

        {/* Create Reel Button — desktop only. Once a reel exists
            (region.autoProjectId), this tracks the reel's own progress
            (T8040/T8060): Focus, then Overlay, then a plain status once
            there's nothing left to open from here. While the create-reel
            request is in flight (reelRequested but no autoProjectId yet),
            it stays disabled/"Reel Created" as before.
            T8070: the produced-stage branches are gated on reelReflectsClip —
            if the clip's start/end changed since the reel was produced, the
            stage is hidden and the control drops to "Create Reel" until the
            boundaries are reverted to the exact producing window (or the reel
            is re-exported). */}
        {!isMobile && (
          <div className="flex items-center justify-between">
            <label className="text-gray-400 text-xs">Reel</label>
            {reelReflectsClip && linkedProject?.has_final_video ? (
              <span className="text-xs text-green-400 flex items-center gap-1.5">
                <Check size={14} />
                {linkedProject.is_published ? 'Published' : 'Completed'}
              </span>
            ) : reelReflectsClip && linkedProject?.has_working_video ? (
              <Button
                variant="cyan"
                size="sm"
                icon={Sparkles}
                onClick={() => onOpenInOverlay(region.autoProjectId)}
              >
                Overlay
              </Button>
            ) : reelReflectsClip ? (
              <Button
                variant="cyan"
                size="sm"
                icon={Crop}
                onClick={() => onOpenInFocus(region.autoProjectId)}
              >
                Focus
              </Button>
            ) : reelIsFreshDraft ? (
              // T8470 (Part D): existing draft reel, not yet produced -> a live
              // link into Focus (same select+navigate the T8480 toast performs),
              // never an actionable "Create Reel".
              <Button
                variant="cyan"
                size="sm"
                icon={Crop}
                onClick={() => onOpenInFocus(region.autoProjectId)}
              >
                Open reel (Draft)
              </Button>
            ) : (
              <Button
                variant={reelRequested ? 'success' : 'cyan'}
                size="sm"
                icon={reelRequested ? Check : Plus}
                disabled={reelRequested}
                onClick={() => {
                  setReelRequested(true);
                  onUpdate({ createProject: true });
                }}
              >
                {reelRequested ? 'Reel Created' : 'Create Reel'}
              </Button>
            )}
          </div>
        )}

        {/* Delete Button */}
        {showDeleteConfirm ? (
          <div className="flex gap-2">
            <button
              onClick={handleConfirmDelete}
              className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm transition-colors"
            >
              Confirm Delete
            </button>
            <button
              onClick={handleCancelDelete}
              className="flex-1 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={handleDeleteClick}
            className="w-full px-3 py-1.5 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded text-sm flex items-center justify-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            <span>Delete Clip</span>
          </button>
        )}
      </div>
    </div>
  );
}

export default ClipDetailsEditor;
