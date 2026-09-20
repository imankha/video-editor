import React, { useState, useEffect, useCallback } from 'react';
import { Star, Crop, Sparkles } from 'lucide-react';
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
import { DeletePlayButton } from './DeletePlayButton';
import { getEditRatingCaption, getRatingLabel, UNRATED_BADGE_COLOR, UNRATED_BACKGROUND_COLOR } from '../../../components/shared/clipConstants';
import { getClipStage, CLIP_STAGE } from '../clipStage';
import { isDefaultPlayName } from '../playProgress';
import { onTextFieldKeyDown } from '../textFieldCommit';
import { ANNOTATE } from '../../../config/displayNames';

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
    <div
      className="flex items-center gap-0.5"
      // T9630 N35: this sidebar had its own StarRating with no tie to the
      // canonical getRatingLabel mapping (per-star title said only "N stars",
      // never the adjective the list/editor/timeline all show) — bring it in
      // line without duplicating the visible caption already rendered below.
      title={getRatingLabel(rating)}
      aria-label={getRatingLabel(rating)}
    >
      {[1, 2, 3, 4, 5].map((starNum) => (
        <button
          key={starNum}
          onClick={() => onRatingChange(starNum)}
          className="p-0.5 coarse-pointer:min-w-[44px] coarse-pointer:min-h-[44px] coarse-pointer:flex coarse-pointer:items-center coarse-pointer:justify-center hover:scale-110 transition-transform"
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
  onAwaitWrites,
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

  // Local scrub state — same pattern as AnnotateFullscreenOverlay.
  // Dragging updates local state instantly; persisted to parent on change.
  const [scrubStartTime, setScrubStartTime] = useState(region.startTime);
  const [scrubEndTime, setScrubEndTime] = useState(region.endTime);
  // T10610 § B.3: name/notes local-echo, the SAME per-keystroke-free pattern
  // trim already uses here — extends this EXISTING effect, not a new one.
  const [nameDraft, setNameDraft] = useState(region.name || '');
  const [notesDraft, setNotesDraft] = useState(region.notes || '');

  // Sync local state only when switching to a different clip.
  // Do NOT sync on region.startTime/endTime changes — during drag, local state
  // is authoritative and the parent round-trip would fight with it.
  useEffect(() => {
    setScrubStartTime(region.startTime);
    setScrubEndTime(region.endTime);
    setNameDraft(region.name || '');
    setNotesDraft(region.notes || '');
  }, [region.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasReel = !!region.autoProjectId;
  const notesLength = notesDraft.length;

  // T8060/T9330: once the clip has its own project, the stage control tracks it
  // through Focus -> Spotlight -> Final/Published, using the same
  // has_working_video/has_final_video/is_published fields DraftTile reads for the
  // Clips list. T9330 extracted this into the shared getClipStage helper so this
  // sidebar and the desktop strip (AnnotateFullscreenOverlay) compute ONE stage,
  // one vocabulary. T8070 staleness (exact-equality snapshot) and T8470 Part D
  // (fresh draft = live link) both live inside the helper now. Display-level only
  // — region.autoProjectId is never mutated by it.
  const projects = useProjectsList();
  const linkedProject = hasReel ? projects.find(p => p.id === region.autoProjectId) : null;
  const clipStage = getClipStage(region, linkedProject);

  // T5725: teammate tagging is a Team-layer-only affordance. Legacy-NULL rule
  // (`my_athlete ?? true` => My Athlete) — never read region.my_athlete bare.
  const isTeamLayer = (region.my_athlete ?? true) === false;

  // Derive display name from region.name or auto-generate from rating+tags
  const displayName = region.name || generateClipName(region.rating ?? null, region.tags || [], region.notes || '') || '';
  // T10610 § A.5 (v2 finding 7): reads the SAME recognizer the "named" badge
  // uses. Every play now carries a real name ("Play N") from the moment it's
  // created, so the old has_custom_name-style flag would never show "(auto)"
  // again — isDefaultPlayName is what keeps a fresh "Play 3" honestly auto.
  const isAutoGenerated = isDefaultPlayName(region.name);

  // T10610 § B.3: local-echo commit-on-blur/Enter — no write per keystroke.
  // Reads `e.target.value` (the live DOM value) when a blur event is
  // available, falling back to the draft state for a call with no event —
  // see AnnotateFullscreenOverlay.jsx's commitName for why: onTextFieldKeyDown's
  // Escape branch mutates the DOM synchronously and this handler can run (via
  // the nested blur it triggers) before React flushes the revert, so reading
  // component state here would see the stale pre-revert value.
  const commitName = useCallback((e) => {
    const value = e?.target?.value ?? nameDraft;
    if (value !== (region.name || '')) onUpdate({ name: value });
  }, [nameDraft, region.name, onUpdate]);

  const commitNotes = useCallback((e) => {
    const value = e?.target?.value ?? notesDraft;
    if (value !== (region.notes || '')) onUpdate({ notes: value });
  }, [notesDraft, region.notes, onUpdate]);

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

  const handleTeammatesChange = (newTeammates) => {
    onUpdate({ tagged_teammates: newTeammates });
  };

  // T10610 § C.4: the sidebar's own "open existing project" stage button is
  // the same Frame-ordering hazard the overlay has — await the region's write
  // chain before navigating so a trim released just before this click can't
  // lose the race into Framing/Spotlight.
  const handleOpenStage = useCallback(async () => {
    const ok = onAwaitWrites ? await onAwaitWrites(region.id) : true;
    if (!ok) return;
    if (clipStage.action === 'overlay') {
      onOpenInOverlay(region.autoProjectId);
    } else {
      onOpenInFocus(region.autoProjectId);
    }
  }, [onAwaitWrites, region.id, region.autoProjectId, clipStage.action, onOpenInOverlay, onOpenInFocus]);

  const rating = region.rating ?? null;
  // T10690: an unrated clip's panel tint is neutral, not a borrowed "3" color
  // — a NULL rating is a real state, never a value to substitute.
  const ratingColor = rating == null ? UNRATED_BACKGROUND_COLOR : RATING_COLORS[rating];
  const ratingBorderColor = rating == null ? UNRATED_BADGE_COLOR : RATING_BORDER_COLORS[rating];

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
            rating={rating}
            onRatingChange={handleRatingChange}
          />
        </div>
        {/* T8490 / T9820: edit-mode caption — reads off hasReel (creation here is
            a manual control, never rating-gated) so it states whether a clip
            exists, never a star threshold. */}
        <p className="text-xs text-gray-400 -mt-1.5 ml-[4.5rem]">
          {getEditRatingCaption(rating, !isTeamLayer, hasReel)}
        </p>

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

        {/* Name Input — T10610 § B.3: local-echo draft, commit on blur/Enter only */}
        <div className="flex items-center gap-2">
          <label className="text-gray-400 text-xs w-16 shrink-0">
            Name
            {isAutoGenerated && <span className="text-gray-500 ml-1">(auto)</span>}
          </label>
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setNameDraft, storedValue: region.name, allowEnterCommit: true })}
            className="flex-1 px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-blue-500"
            placeholder={displayName || ANNOTATE.CLIP_NAME}
          />
        </div>

        {/* Notes Textarea — desktop only. T10610 § B.3: local-echo draft, commit on blur only. */}
        {!isMobile && (
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-gray-400 text-xs">Notes</label>
              <span className={`text-xs ${notesLength >= maxNotesLength ? 'text-red-400' : 'text-gray-500'}`}>
                {notesLength}/{maxNotesLength}
              </span>
            </div>
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value.slice(0, maxNotesLength))}
              onBlur={commitNotes}
              onKeyDown={(e) => onTextFieldKeyDown(e, { draftSetter: setNotesDraft, storedValue: region.notes, allowEnterCommit: false })}
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
          <label className="text-gray-400 text-xs w-16 shrink-0">{ANNOTATE.LAYER_LABEL}</label>
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

        {/* Stage control — driven by the shared getClipStage helper (same stage +
            label as the desktop strip CTA). T8070 staleness + T8470 fresh-draft
            both live inside getClipStage.
            - NO_PROJECT: no create affordance in this panel (removed 2026-09-20
              per user request); a clip's project is created elsewhere.
            - every OTHER stage: DESKTOP ONLY — a button that OPENS the clip's
              existing project (Apply Framing / Apply Spotlight / View Final / View
              Published), routing action 'overlay' -> Spotlight, else Framing.
              Drifted and below-migration projects land on "Apply Framing" (open
              it), never back on create — a project that EXISTS should open. */}
        {clipStage.stage === CLIP_STAGE.NO_PROJECT ? null : !isMobile ? (
          <div className="flex items-center justify-between">
            <label className="text-gray-400 text-xs">Clip</label>
            <Button
              variant="cyan"
              size="sm"
              icon={clipStage.action === 'overlay' ? Sparkles : Crop}
              // 2026-09-18 (user request): FOCUS-stage rollover, same
              // already-approved copy as the desktop strip's CTA.
              title={clipStage.stage === CLIP_STAGE.FOCUS ? ANNOTATE.FRAME_THIS_CLIP_HINT : undefined}
              onClick={handleOpenStage}
            >
              {clipStage.label}
            </Button>
          </div>
        ) : null}

        {/* Delete Button — T10610 § D.1: shared with every overlay layout */}
        <DeletePlayButton hasProject={!!region.autoProjectId} onDelete={onDelete} />
      </div>
    </div>
  );
}

export default ClipDetailsEditor;
