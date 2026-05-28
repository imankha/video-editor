import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Star, X, Plus } from 'lucide-react';
import { getPositions, getTagSet } from '../constants/tagRegistry';
import { generateClipName } from '../../../utils/clipDisplayName';
import { TagSelector } from '../../../components/shared/TagSelector';
import { TeammateTagInput, hasUncommittedTeammateText } from '../../../components/shared/TeammateTagInput';
import { useCurrentProfile } from '../../../stores';
import { ClipScrubRegion } from './ClipScrubRegion';
import { Toggle, Button } from '../../../components/shared/Button';
import { ConfirmationDialog } from '../../../components/shared/ConfirmationDialog';

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

const DEFAULT_CLIP_BEFORE = 15; // seconds before playhead
const DEFAULT_CLIP_AFTER = 5;   // seconds after playhead
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
}) {
  const isEditMode = !!existingClip;
  const currentProfile = useCurrentProfile();
  const sport = currentProfile?.sport || 'soccer';
  const tagSet = getTagSet(sport);

  const [dockPosition, setDockPosition] = useState(savedDockPosition);
  const handleDockChange = useCallback((pos) => {
    savedDockPosition = pos;
    setDockPosition(pos);
  }, []);

  const [rating, setRating] = useState(DEFAULT_RATING);
  const [selectedTags, setSelectedTags] = useState([]);
  const [clipName, setClipName] = useState('');
  const [isNameManuallyEdited, setIsNameManuallyEdited] = useState(false);
  // Capture the currentTime when the overlay first opens so handle resets
  // don't fight with seek-driven currentTime updates during drag
  const initialTimeRef = useRef(currentTime);
  useEffect(() => {
    if (isVisible) {
      initialTimeRef.current = currentTime;
    }
  }, [isVisible]); // only on visibility change, not on currentTime updates

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
  const [showTagWarning, setShowTagWarning] = useState(false);
  const notesRef = useRef(null);
  const handleSaveRef = useRef(null);
  const handleRatingChangeRef = useRef(null);

  // Reset form when existingClip changes (switching between create/edit mode)
  useEffect(() => {
    const t = initialTimeRef.current;
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
      setMyAthlete(true);
      setCreateProject(DEFAULT_RATING === 5);
      setCreateProjectManuallySet(false);
    }
  }, [existingClip]);

  // Auto-generate clip name when rating, tags, or notes change (unless manually edited)
  // Guard: skip when existingClip has a name — the reset effect may not have run yet
  // due to React effect batching, so isNameManuallyEdited could still be stale (false)
  useEffect(() => {
    if (!isNameManuallyEdited && !existingClip?.name) {
      const generatedName = generateClipName(rating, selectedTags, notes);
      setClipName(generatedName);
    }
  }, [rating, selectedTags, notes, isNameManuallyEdited, existingClip?.name]);

  // Focus notes input when overlay appears
  useEffect(() => {
    if (isVisible && notesRef.current) {
      notesRef.current.focus();
    }
  }, [isVisible]);

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
  };
  handleRatingChangeRef.current = handleRatingChange;

  const handleTagToggle = (tagName) => {
    setSelectedTags((prev) =>
      prev.includes(tagName)
        ? prev.filter((t) => t !== tagName)
        : [...prev, tagName]
    );
  };

  const handleNameChange = (e) => {
    setClipName(e.target.value);
    setIsNameManuallyEdited(true);
  };

  const handleSave = () => {
    if (hasUncommittedTeammateText()) {
      setShowTagWarning(true);
      return;
    }
    const clipDuration = scrubEndTime - scrubStartTime;
    if (isEditMode) {
      onUpdateClip(existingClip.id, {
        startTime: scrubStartTime,
        endTime: scrubEndTime,
        rating,
        tags: selectedTags,
        name: isNameManuallyEdited ? clipName : '',
        notes,
        tagged_teammates: taggedTeammates,
        my_athlete: myAthlete,
        createProject,
      });
    } else {
      const clipData = {
        startTime: scrubStartTime,
        duration: clipDuration,
        rating,
        tags: selectedTags,
        name: isNameManuallyEdited ? clipName : '',
        notes,
        tagged_teammates: taggedTeammates,
        my_athlete: myAthlete,
        createProject,
      };
      onCreateClip(clipData);
    }
    setRating(DEFAULT_RATING);
    setSelectedTags([]);
    setClipName('');
    setIsNameManuallyEdited(false);
    setScrubStartTime(Math.max(0, initialTimeRef.current - DEFAULT_CLIP_BEFORE));
    setScrubEndTime(Math.min(initialTimeRef.current + DEFAULT_CLIP_AFTER, videoDuration || Infinity));
    setNotes('');
    setTaggedTeammates([]);
    setMyAthlete(true);
    setCreateProject(DEFAULT_RATING === 5);
    setCreateProjectManuallySet(false);
    onResume();
  };
  handleSaveRef.current = handleSave;

  if (!isVisible) return null;

  const formContent = (
    <>
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className={`${layout === 'inline' ? 'text-sm' : 'text-lg'} font-semibold text-white`}>
            {isEditMode ? 'Edit Clip' : 'Add Clip'}
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
          videoController={videoController}
        />

        {/* Star Rating */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Rating (press 1-5)</label>
          <StarRating rating={rating} onRatingChange={handleRatingChange} size={28} />
        </div>

        {/* Tag Selection */}
        {tagSet && (
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
        )}

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

        {/* Notes */}
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

        {/* Teammates */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Teammates</label>
          <TeammateTagInput
            teammates={taggedTeammates}
            onChange={setTaggedTeammates}
            suggestions={teammateSuggestions}
          />
        </div>

        {/* My Athlete Toggle */}
        <div className="mb-4 flex items-center gap-2">
          <label className="text-gray-400 text-sm">My Athlete</label>
          <button
            type="button"
            onClick={() => {
              setMyAthlete(prev => {
                const next = !prev;
                if (!createProjectManuallySet) {
                  setCreateProject(rating === 5 && next);
                }
                return next;
              });
            }}
            className={`relative w-9 h-5 rounded-full transition-colors ${
              myAthlete ? 'bg-cyan-600' : 'bg-gray-600'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                myAthlete ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {/* Create Reel — toggle in create mode, button in edit mode */}
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

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
          >
            {isEditMode ? 'Update & Continue (Enter)' : 'Save & Continue (Enter)'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>

        <ConfirmationDialog
          isOpen={showTagWarning}
          title="Tag not submitted"
          message="You typed a teammate name but didn't submit it. Press Enter in the teammate field to add the tag."
          buttons={[{ label: 'OK', variant: 'primary', onClick: () => setShowTagWarning(false) }]}
          onClose={() => setShowTagWarning(false)}
        />
    </>
  );

  if (layout === 'inline') {
    return (
      <div data-add-clip-form className="border-t border-gray-700 p-3 overflow-y-auto">
        {formContent}
      </div>
    );
  }

  const isRight = dockPosition === 'right';

  return (
    <div className={`absolute ${isRight ? 'right-0' : 'left-0'} top-0 bottom-0 z-50 flex items-stretch`}>
      <div
        className={`bg-gray-900/95 p-5 shadow-2xl border-gray-700 pointer-events-auto w-[400px] overflow-y-auto ${isRight ? 'border-l' : 'border-r'}`}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {formContent}
      </div>
    </div>
  );
}

export default AnnotateFullscreenOverlay;
