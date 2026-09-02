import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Star, X, Plus } from 'lucide-react';
import { getPositions, getTagSet, NO_SPORT } from '../constants/tagRegistry';
import { generateClipName } from '../../../utils/clipDisplayName';
import { maybeRecordRatedAndTagged } from '../../../utils/questAchievements';
import { TagSelector } from '../../../components/shared/TagSelector';
import { NoSportTagWarning } from '../../../components/shared/NoSportTagWarning';
import { TeammateTagInput, commitPendingTeammateText } from '../../../components/shared/TeammateTagInput';
import { useCurrentProfile, useProfileStore } from '../../../stores';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { recordUiImpression } from '../../../utils/uiTelemetry';
import { ClipScrubRegion } from './ClipScrubRegion';
import { Toggle, Button } from '../../../components/shared/Button';
import { LayerSegmentedControl } from './LayerSegmentedControl';

// Persists across mounts within the same page session
let savedDockPosition = 'left';

function DockPositionSelector({ position, onPositionChange }) {
  return (
    <div className="flex gap-1 flex-shrink-0" title="Dock position">
      {['left', 'right'].map(side => (
        <button
          key={side}
          onClick={() => onPositionChange(side)}
          className={`relative w-[28px] h-[22px] rounded border transition-colors ${
            position === side
              ? 'border-green-500 bg-gray-700'
              : 'border-gray-600 bg-gray-800 hover:border-gray-400'
          }`}
        >
          <span className={`absolute ${side === 'left' ? 'left-[3px]' : 'right-[3px]'} top-[3px] bottom-[3px] w-[5px] rounded-sm transition-colors ${
            position === side ? 'bg-green-400' : 'bg-gray-500'
          }`} />
        </button>
      ))}
    </div>
  );
}

// Rating notation map
const RATING_NOTATION = {
  1: '??',
  2: '?',
  3: '!?',
  4: '!',
  5: '!!'
};

const DEFAULT_CLIP_BEFORE = 9;  // seconds before playhead
const DEFAULT_CLIP_AFTER = 3;   // seconds after playhead
const DEFAULT_RATING = 4; // "Good"

/**
 * StarRating - Clickable star rating
 */
function StarRating({ rating, onRatingChange, size = 24 }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((starNum) => (
        <button
          key={starNum}
          onClick={() => onRatingChange(starNum)}
          className="p-0.5 hover:scale-110 transition-transform"
          title={`${starNum} star${starNum > 1 ? 's' : ''}`}
        >
          <Star
            size={size}
            fill={starNum <= rating ? '#fbbf24' : 'transparent'}
            color={starNum <= rating ? '#fbbf24' : '#6b7280'}
            strokeWidth={1.5}
          />
        </button>
      ))}
      <span className="ml-2 text-lg font-bold text-white">
        {RATING_NOTATION[rating]}
      </span>
    </div>
  );
}

/**
 * AnnotateFullscreenOverlay - Overlay that appears when paused in fullscreen
 *
 * Features:
 * - Quick clip creation form (or edit existing clip if playhead is in a clip)
 * - Star rating (1-5)
 * - Position selection (attacker, midfielder, defender, goalie)
 * - Tag selection (based on position)
 * - Auto-generated clip name (editable)
 * - Duration slider
 * - Notes input
 * - Press Enter to save and continue playing
 * - Press Escape to cancel
 *
 * When existingClip is provided, we're editing that clip.
 * Otherwise, we're creating a new clip at currentTime.
 */
export function AnnotateFullscreenOverlay({
  isVisible,
  currentTime,
  videoDuration,
  existingClip = null,
  onCreateClip,
  onUpdateClip,
  onResume,
  onClose,
  onSeek,
  videoController,
  isFullscreen = false,
  layout = 'overlay',
  teammateSuggestions = [],
  onScrubDragChange,
  newClipLayerIsMine = true,
  nextClipNumber = 1,
}) {
  const isEditMode = !!existingClip;
  const isMobile = useIsMobile();
  // T8140: one-tap first clip — a nameless new clip defaults to "Play N" so the
  // user can save without typing a name. Display-and-persist default (memory-only
  // until the Save gesture); never applied in edit mode.
  const defaultClipName = isEditMode ? '' : `Play ${nextClipNumber}`;
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

  const [dockPosition, setDockPosition] = useState(savedDockPosition);
  const handleDockChange = useCallback((pos) => {
    savedDockPosition = pos;
    setDockPosition(pos);
  }, []);

  const [rating, setRating] = useState(DEFAULT_RATING);
  const [selectedTags, setSelectedTags] = useState([]);
  const [clipName, setClipName] = useState('');
  const [isNameManuallyEdited, setIsNameManuallyEdited] = useState(false);
  // Mirror currentTime in a ref so the reset effect below reads the playhead
  // at transition time without re-running on seek-driven updates during drag.
  // Must NOT be frozen at open time: the overlay can switch edit->create while
  // staying open (Add Clip pressed while editing), and a stale time would put
  // the scrub handles outside ClipScrubRegion's window, hiding them.
  const currentTimeRef = useRef(currentTime);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  // T5700: same pattern — read the mode toggle at transition time without
  // re-running the reset effect (and wiping an in-progress form) if the user
  // flips the toggle while the Add Clip form is already open.
  const newClipLayerIsMineRef = useRef(newClipLayerIsMine);
  useEffect(() => { newClipLayerIsMineRef.current = newClipLayerIsMine; }, [newClipLayerIsMine]);

  const [scrubStartTime, setScrubStartTime] = useState(
    Math.max(0, currentTime - DEFAULT_CLIP_BEFORE)
  );
  const [scrubEndTime, setScrubEndTime] = useState(
    Math.min(currentTime + DEFAULT_CLIP_AFTER, videoDuration || Infinity)
  );
  const [notes, setNotes] = useState('');
  const [taggedTeammates, setTaggedTeammates] = useState([]);
  const [myAthlete, setMyAthlete] = useState(true);
  const [createProject, setCreateProject] = useState(false);
  const [createProjectManuallySet, setCreateProjectManuallySet] = useState(false);
  const notesRef = useRef(null);
  const handleSaveRef = useRef(null);
  const handleRatingChangeRef = useRef(null);
  // T8140: fires the `add_clip_opened_no_save` impression exactly once per
  // create-mode open that ends without a save (see effect below). Set true by
  // handleSave so a saved open never beacons.
  const savedThisOpenRef = useRef(false);

  // Reset form when existingClip changes (switching between create/edit mode)
  useEffect(() => {
    const t = currentTimeRef.current;
    if (existingClip) {
      setRating(existingClip.rating || DEFAULT_RATING);
      setSelectedTags(existingClip.tags || []);
      setClipName(existingClip.name || '');
      setIsNameManuallyEdited(!!existingClip.name);
      setScrubStartTime(existingClip.startTime);
      setScrubEndTime(existingClip.endTime);
      setNotes(existingClip.notes || '');
      setTaggedTeammates(existingClip.tagged_teammates || []);
      setMyAthlete(existingClip.my_athlete ?? true);
      setCreateProject(!!existingClip.autoProjectId);
      setCreateProjectManuallySet(!!existingClip.autoProjectId);
    } else {
      setRating(DEFAULT_RATING);
      setSelectedTags([]);
      setClipName('');
      setIsNameManuallyEdited(false);
      setScrubStartTime(Math.max(0, t - DEFAULT_CLIP_BEFORE));
      setScrubEndTime(Math.min(t + DEFAULT_CLIP_AFTER, videoDuration || Infinity));
      setNotes('');
      setTaggedTeammates([]);
      setMyAthlete(newClipLayerIsMineRef.current);
      setCreateProject(DEFAULT_RATING === 5 && newClipLayerIsMineRef.current);
      setCreateProjectManuallySet(false);
    }
  }, [existingClip]);

  // Auto-generate clip name when rating, tags, or notes change (unless manually edited)
  // Guard: skip when existingClip has a name — the reset effect may not have run yet
  // due to React effect batching, so isNameManuallyEdited could still be stale (false)
  useEffect(() => {
    if (!isNameManuallyEdited && !existingClip?.name) {
      const generatedName = generateClipName(rating, selectedTags, notes);
      // T8140: fall back to the "Play N" default when nothing else derives a name
      // (create mode only — defaultClipName is '' when editing).
      setClipName(generatedName || defaultClipName);
    }
  }, [rating, selectedTags, notes, isNameManuallyEdited, existingClip?.name, defaultClipName]);

  // Focus notes input when overlay appears
  useEffect(() => {
    if (isVisible && notesRef.current) {
      notesRef.current.focus();
    }
  }, [isVisible]);

  // T8140: measure in-form abandonment. When the Add Clip form is opened in
  // CREATE mode, fire a single `add_clip_opened_no_save` dialog impression on
  // close/unmount if no save happened. Keyed on the open (isVisible/isEditMode),
  // NOT on renders or keystrokes, so it beacons at most once per open. Edit opens
  // never arm it. Uses the existing T7515 `dialog` vocabulary (no schema change).
  useEffect(() => {
    if (!isVisible || isEditMode) return;
    savedThisOpenRef.current = false;
    return () => {
      if (!savedThisOpenRef.current) {
        recordUiImpression('dialog', 'add_clip_opened_no_save');
      }
    };
  }, [isVisible, isEditMode]);

  // Handle keyboard shortcuts — uses handleSaveRef to avoid stale closures
  // (taggedTeammates, myAthlete, createProject would be stale without the ref)
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSaveRef.current();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key >= '1' && e.key <= '5') {
        handleRatingChangeRef.current(parseInt(e.key, 10));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onClose]);

  const handleRatingChange = (newRating) => {
    setRating(newRating);
    if (!createProjectManuallySet) {
      setCreateProject(newRating === 5 && myAthlete);
    }
    maybeRecordRatedAndTagged(newRating, selectedTags);
  };
  handleRatingChangeRef.current = handleRatingChange;

  const handleTagToggle = (tagName) => {
    const newTags = selectedTags.includes(tagName)
      ? selectedTags.filter((t) => t !== tagName)
      : [...selectedTags, tagName];
    setSelectedTags(newTags);
    maybeRecordRatedAndTagged(rating, newTags);
  };

  const handleNameChange = (e) => {
    setClipName(e.target.value);
    setIsNameManuallyEdited(true);
  };

  const handleSave = () => {
    // T8140: this open ended in a save — suppress the abandonment beacon.
    savedThisOpenRef.current = true;
    // T7540: auto-commit any teammate text typed but not Enter-committed (same
    // effect as pressing Enter) so a pending tag never dead-ends Save. Teammates
    // are Team-layer only, so only commit when the clip is on the Team layer.
    // commitPendingTeammateText returns the resulting array synchronously — use
    // it directly for the payload (setState wouldn't apply within this call).
    const finalTeammates = myAthlete
      ? taggedTeammates
      : commitPendingTeammateText(taggedTeammates);
    if (finalTeammates !== taggedTeammates) {
      setTaggedTeammates(finalTeammates);
    }
    // T8140: persist the typed name if edited; otherwise let the backend derive
    // from tags/notes (name '') — except a truly nameless new clip keeps the
    // "Play N" default so a one-tap save still lands a friendly name.
    const autoGenName = generateClipName(rating, selectedTags, notes);
    const nameToSave = isNameManuallyEdited ? clipName : (autoGenName ? '' : defaultClipName);
    const clipDuration = scrubEndTime - scrubStartTime;
    if (isEditMode) {
      onUpdateClip(existingClip.id, {
        startTime: scrubStartTime,
        endTime: scrubEndTime,
        rating,
        tags: selectedTags,
        name: nameToSave,
        notes,
        tagged_teammates: finalTeammates,
        my_athlete: myAthlete,
        createProject,
      });
    } else {
      const clipData = {
        startTime: scrubStartTime,
        duration: clipDuration,
        rating,
        tags: selectedTags,
        name: nameToSave,
        notes,
        tagged_teammates: finalTeammates,
        my_athlete: myAthlete,
        createProject,
      };
      onCreateClip(clipData);
    }
    setRating(DEFAULT_RATING);
    setSelectedTags([]);
    setClipName('');
    setIsNameManuallyEdited(false);
    setScrubStartTime(Math.max(0, currentTimeRef.current - DEFAULT_CLIP_BEFORE));
    setScrubEndTime(Math.min(currentTimeRef.current + DEFAULT_CLIP_AFTER, videoDuration || Infinity));
    setNotes('');
    setTaggedTeammates([]);
    setMyAthlete(newClipLayerIsMine);
    setCreateProject(DEFAULT_RATING === 5 && newClipLayerIsMine);
    setCreateProjectManuallySet(false);
    onResume();
  };
  handleSaveRef.current = handleSave;

  if (!isVisible) return null;

  const formBody = (
    <>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className={`${layout === 'inline' ? 'text-sm' : 'text-lg'} font-semibold text-white`}>
            {isEditMode ? 'Edit Play' : 'Add Play'}
          </h3>
          <div className="flex items-center gap-2">
            {layout === 'overlay' && (
              <DockPositionSelector position={dockPosition} onPositionChange={handleDockChange} />
            )}
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-700 rounded transition-colors"
              title="Cancel (Esc)"
            >
              <X size={20} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* T8140: reassurance so a first-time user knows the defaults aren't
            permanent — lowers the perceived cost of a one-tap save. Create only. */}
        {!isEditMode && (
          <p className="text-xs text-gray-400 mb-3 -mt-2">You can change all of this later.</p>
        )}

        {/* Clip scrub region - visual timeline for selecting start/end */}
        <ClipScrubRegion
          currentTime={currentTime}
          videoDuration={videoDuration}
          existingClip={existingClip}
          startTime={scrubStartTime}
          endTime={scrubEndTime}
          onStartTimeChange={setScrubStartTime}
          onEndTimeChange={setScrubEndTime}
          onSeek={onSeek}
          onDragStart={() => onScrubDragChange?.(true)}
          onDragEnd={() => onScrubDragChange?.(false)}
          videoController={videoController}
        />

        {/* Star Rating */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Rating{isMobile ? '' : ' (press 1-5)'}</label>
          <StarRating rating={rating} onRatingChange={handleRatingChange} size={28} />
        </div>

        {/* Tag Selection */}
        {tagSet ? (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Tags</label>
            <TagSelector
              positions={getPositions(sport)}
              tagsByPosition={tagSet.tags}
              selectedTags={selectedTags}
              onTagToggle={handleTagToggle}
              size="lg"
            />
          </div>
        ) : (!isMobile && sport === NO_SPORT) ? (
          // T8140: the amber no_sport prompt is kept ONLY on desktop (which also
          // has the top-bar sport control). On mobile the first-clip path is kept
          // clean — no amber wall in the form — and a full-screen "What sport is
          // this?" question fires at first save instead (AnnotateModeView),
          // replacing T7922's in-form picker for the mobile case.
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Tags</label>
            <NoSportTagWarning onChange={handleSetSport} />
          </div>
        ) : null}

        {/* Clip Name - always rendered to keep panel height stable */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">
            Clip Name
            {!isNameManuallyEdited && selectedTags.length > 0 && (
              <span className="text-gray-500 ml-2">(auto-generated)</span>
            )}
          </label>
          <input
            type="text"
            value={clipName}
            onChange={handleNameChange}
            placeholder="Enter clip name..."
            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500"
          />
        </div>

        {/* Notes — desktop only */}
        {!isMobile && (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Notes (optional)</label>
            <textarea
              ref={notesRef}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note about this clip..."
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:border-green-500 resize-none"
              rows={2}
            />
          </div>
        )}

        {/* Layer — replaces the old My Athlete on/off toggle. Shown on mobile
            too: this overlay IS the mobile add/edit surface. Locked to Team,
            read-only, for imported clips (shared_by set) — they can never be
            promoted onto the My Athlete layer (T5700, epic decision 2). */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Layer</label>
          <LayerSegmentedControl
            size={isMobile ? 'md' : 'sm'}
            value={myAthlete}
            disabled={!!existingClip?.shared_by}
            disabledReason={existingClip?.shared_by ? `Shared by ${existingClip.shared_by} — imported clips stay on the Team layer` : ''}
            onChange={(mine) => {
              setMyAthlete(mine);
              // T5725: switching TO My Athlete clears teammate tags — teammates
              // are Team-layer-only, so a My Athlete clip must never carry them.
              // Persisted on Save; visible now because the Teammates block hides.
              if (mine) setTaggedTeammates([]);
              if (!createProjectManuallySet) {
                setCreateProject(rating === 5 && mine);
              }
            }}
            className="w-full"
          />
        </div>

        {/* Teammates — Team-layer only (T5725). Dropped the old !isMobile gate:
            teammate tagging reveals on the Team layer for BOTH desktop and
            mobile, and is hidden entirely when the clip is on My Athlete. */}
        {!myAthlete && (
          <div className="mb-4">
            <label className="block text-gray-400 text-sm mb-2">Teammates</label>
            <TeammateTagInput
              teammates={taggedTeammates}
              onChange={setTaggedTeammates}
              suggestions={teammateSuggestions}
            />
          </div>
        )}

        {/* Create Reel — desktop only; toggle in create mode, button in edit mode */}
        {!isMobile && (
          <div className="mb-4 flex items-center justify-between">
            <label className="text-gray-400 text-sm">Reel</label>
            {isEditMode ? (
              existingClip?.autoProjectId ? (
                <span className="text-green-400 text-sm">Reel already created</span>
              ) : (
                <Button
                  variant="cyan"
                  size="sm"
                  icon={Plus}
                  onClick={() => onUpdateClip(existingClip.id, { createProject: true })}
                >
                  Create Reel
                </Button>
              )
            ) : (
              <div className="flex items-center gap-2">
                <span className={`text-sm ${createProject ? 'text-cyan-400' : 'text-gray-500'}`}>
                  {createProject ? 'Create Reel' : "Don't Create Reel"}
                </span>
                <Toggle
                  checked={createProject}
                  onChange={(val) => { setCreateProject(val); setCreateProjectManuallySet(true); }}
                  size="sm"
                  accent="cyan"
                />
              </div>
            )}
          </div>
        )}

    </>
  );

  // T8140: Save/Cancel live in a pinned footer OUTSIDE the scroll area so Save is
  // always visible without scrolling (390x844 mobile) — the body scrolls, the
  // footer does not. Shared by the inline and overlay layouts.
  const actionsFooter = (
    <div className="flex gap-3">
      <button
        onClick={handleSave}
        className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
      >
        {isEditMode ? 'Update' : 'Save'}
      </button>
      <button
        onClick={onClose}
        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
      >
        Cancel
      </button>
    </div>
  );

  if (layout === 'landscape-inline') {
    return (
      <div data-add-clip-form className="border-t border-gray-700 px-3 py-2">
        <ClipScrubRegion
          currentTime={currentTime}
          videoDuration={videoDuration}
          existingClip={existingClip}
          startTime={scrubStartTime}
          endTime={scrubEndTime}
          onStartTimeChange={setScrubStartTime}
          onEndTimeChange={setScrubEndTime}
          onSeek={onSeek}
          onDragStart={() => onScrubDragChange?.(true)}
          onDragEnd={() => onScrubDragChange?.(false)}
          videoController={videoController}
          compact
        />
        <div className="flex items-center gap-2 mt-1.5">
          <StarRating rating={rating} onRatingChange={handleRatingChange} size={20} />
          <span className="text-xs text-gray-500 w-4 text-center">{RATING_NOTATION[rating]}</span>
          <div className="h-4 w-px bg-gray-700 flex-shrink-0" />
          <div className="flex-1 overflow-x-auto scrollbar-hide">
            {tagSet ? (
              <TagSelector
                positions={getPositions(sport)}
                tagsByPosition={tagSet.tags}
                selectedTags={selectedTags}
                onTagToggle={handleTagToggle}
                size="sm"
                flat
              />
            ) : sport === NO_SPORT ? (
              <NoSportTagWarning compact />
            ) : null}
          </div>
          <div className="h-4 w-px bg-gray-700 flex-shrink-0" />
          <button
            onClick={handleSave}
            className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
          >
            {isEditMode ? 'Update' : 'Save'}
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors flex-shrink-0"
            title="Cancel (Esc)"
          >
            <X size={18} className="text-gray-400" />
          </button>
        </div>
      </div>
    );
  }

  if (layout === 'inline') {
    // T8140: flex column = scrolling body (min-h-0 lets it shrink inside a bounded
    // flex parent — the ClipsSidePanel sidebar, the mobileFs sheet, the mobile
    // bottom sheet) + a pinned footer that stays reachable without scrolling
    // (T4933 short-sidebar case AND the 390x844 mobile Save-below-the-fold case).
    return (
      <div data-add-clip-form className="border-t border-gray-700 flex flex-col min-h-0 max-h-full">
        <div className="p-3 overflow-y-auto min-h-0 flex-1">{formBody}</div>
        <div className="p-3 border-t border-gray-700 bg-gray-900/95 flex-shrink-0">{actionsFooter}</div>
      </div>
    );
  }

  const isRight = dockPosition === 'right';

  return (
    <div className={`absolute ${isRight ? 'right-0' : 'left-0'} top-0 bottom-0 z-50 flex items-stretch`}>
      <div
        className={`bg-gray-900/95 shadow-2xl border-gray-700 pointer-events-auto w-[400px] flex flex-col ${isRight ? 'border-l' : 'border-r'}`}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="p-5 overflow-y-auto min-h-0 flex-1">{formBody}</div>
        <div className="px-5 py-4 border-t border-gray-700 bg-gray-900/95 flex-shrink-0">{actionsFooter}</div>
      </div>
    </div>
  );
}

export default AnnotateFullscreenOverlay;
