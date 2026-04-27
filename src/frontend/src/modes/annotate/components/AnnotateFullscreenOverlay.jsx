import React, { useState, useEffect, useRef } from 'react';
import { Star, X, Check } from 'lucide-react';
import { positions, soccerTags, generateClipName } from '../constants/soccerTags';
import { ClipScrubRegion } from './ClipScrubRegion';

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
 * TagSelector - Multi-select tags grouped by position
 * Shows all tags from all positions, allowing selection from multiple positions
 */
function TagSelector({ selectedTags, onTagToggle }) {
  return (
    <div className="space-y-3">
      {positions.map((pos) => {
        const positionTags = soccerTags[pos.id] || [];
        return (
          <div key={pos.id}>
            {/* Position groups rendered without labels */}
            <div className="flex flex-wrap gap-2">
              {positionTags.map((tag) => {
                const isSelected = selectedTags.includes(tag.name);
                return (
                  <button
                    key={tag.name}
                    onClick={() => onTagToggle(tag.name)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      isSelected
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                    title={tag.description}
                  >
                    {isSelected && <Check size={14} />}
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
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
  videoRef,
}) {
  const isEditMode = !!existingClip;

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
  const notesRef = useRef(null);

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
    } else {
      setRating(DEFAULT_RATING);
      setSelectedTags([]);
      setClipName('');
      setIsNameManuallyEdited(false);
      setScrubStartTime(Math.max(0, t - DEFAULT_CLIP_BEFORE));
      setScrubEndTime(Math.min(t + DEFAULT_CLIP_AFTER, videoDuration || Infinity));
      setNotes('');
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

  // Handle keyboard shortcuts
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e) => {
      // Don't intercept if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key >= '1' && e.key <= '5') {
        // Number keys to set rating
        setRating(parseInt(e.key, 10));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, rating, scrubStartTime, scrubEndTime, notes, existingClip, selectedTags, clipName]);

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
    const clipDuration = scrubEndTime - scrubStartTime;
    if (isEditMode) {
      // Update existing clip with new start/end times
      // Only include name if it was manually edited, otherwise leave empty for auto-generation
      onUpdateClip(existingClip.id, {
        startTime: scrubStartTime,
        endTime: scrubEndTime,
        rating,
        tags: selectedTags,
        name: isNameManuallyEdited ? clipName : '',
        notes,
      });
    } else {
      // Create new clip using scrub region start/end
      // Only include name if it was manually edited, otherwise leave empty for auto-generation
      const clipData = {
        startTime: scrubStartTime,
        duration: clipDuration,
        rating,
        tags: selectedTags,
        name: isNameManuallyEdited ? clipName : '',
        notes,
      };
      onCreateClip(clipData);
    }
    // Reset form
    setRating(3);
    setSelectedTags([]);
    setClipName('');
    setIsNameManuallyEdited(false);
    setScrubStartTime(Math.max(0, initialTimeRef.current - DEFAULT_CLIP_BEFORE));
    setScrubEndTime(Math.min(initialTimeRef.current + DEFAULT_CLIP_AFTER, videoDuration || Infinity));
    setNotes('');
    // Resume playback
    onResume();
  };

  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-start pl-4 pointer-events-none">
      <div
        className="bg-gray-900 rounded-xl p-6 w-full max-w-md shadow-2xl border border-gray-700 max-h-[90vh] overflow-y-auto pointer-events-auto"
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">
            {isEditMode ? 'Edit Clip' : 'Add Clip'}
          </h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
            title="Cancel (Esc)"
          >
            <X size={20} className="text-gray-400" />
          </button>
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
          videoRef={videoRef}
        />

        {/* Star Rating */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Rating (press 1-5)</label>
          <StarRating rating={rating} onRatingChange={setRating} size={28} />
        </div>

        {/* Tag Selection */}
        <div className="mb-4">
          <label className="block text-gray-400 text-sm mb-2">Tags</label>
          <TagSelector
            selectedTags={selectedTags}
            onTagToggle={handleTagToggle}
          />
        </div>

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
      </div>
    </div>
  );
}

export default AnnotateFullscreenOverlay;
