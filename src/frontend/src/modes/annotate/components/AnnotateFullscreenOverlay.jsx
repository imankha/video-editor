import React, { useState, useEffect, useRef } from 'react';
import { Star, X, Check } from 'lucide-react';
import { positions, soccerTags, generateClipName } from '../constants/soccerTags';

// Rating notation map
const RATING_NOTATION = {
  1: '??',
  2: '?',
  3: '!?',
  4: '!',
  5: '!!'
};

const DEFAULT_CLIP_DURATION = 15;
const MIN_CLIP_DURATION = 1;
const MAX_CLIP_DURATION = 60;

/**
 * Format seconds to MM:SS.s for display
 */
function formatTimeDisplay(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toFixed(1).padStart(4, '0')}`;
}

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
            <div className="text-gray-400 text-xs mb-1.5">{pos.name}</div>
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
                    {tag.shortName}
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
}) {
  const isEditMode = !!existingClip;

  const [rating, setRating] = useState(3);
  const [selectedTags, setSelectedTags] = useState([]);
  const [clipName, setClipName] = useState('');
  const [isNameManuallyEdited, setIsNameManuallyEdited] = useState(false);
  const [duration, setDuration] = useState(DEFAULT_CLIP_DURATION);
  const [notes, setNotes] = useState('');
  const notesRef = useRef(null);

  // Reset form when existingClip changes (switching between create/edit mode)
  useEffect(() => {
    if (existingClip) {
      setRating(existingClip.rating || 3);
      setSelectedTags(existingClip.tags || []);
      setClipName(existingClip.name || '');
      setIsNameManuallyEdited(!!existingClip.name);
      setDuration(existingClip.endTime - existingClip.startTime);
      setNotes(existingClip.notes || '');
    } else {
      setRating(3);
      setSelectedTags([]);
      setClipName('');
      setIsNameManuallyEdited(false);
      setDuration(DEFAULT_CLIP_DURATION);
      setNotes('');
    }
  }, [existingClip]);

  // Auto-generate clip name when rating or tags change (unless manually edited)
  useEffect(() => {
    if (!isNameManuallyEdited && selectedTags.length > 0) {
      const generatedName = generateClipName(rating, selectedTags);
      setClipName(generatedName);
    }
  }, [rating, selectedTags, isNameManuallyEdited]);

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
  }, [isVisible, rating, duration, notes, existingClip, selectedTags, clipName]);

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
    if (isEditMode) {
      // Update existing clip
      onUpdateClip(existingClip.id, {
        duration,
        rating,
        tags: selectedTags,
        name: clipName,
        notes,
      });
    } else {
      // Create new clip - currentTime is the END time, so start = end - duration
      const calculatedStartTime = Math.max(0, currentTime - duration);
      const clipData = {
        startTime: calculatedStartTime,
        duration,
        rating,
        tags: selectedTags,
        name: clipName,
        notes,
      };
      onCreateClip(clipData);
    }
    // Reset form
    setRating(3);
    setSelectedTags([]);
    setClipName('');
    setIsNameManuallyEdited(false);
    setDuration(DEFAULT_CLIP_DURATION);
    setNotes('');
    // Resume playback
    onResume();
  };

  // Calculate times for display
  // For new clips: currentTime is the END time, start = end - duration
  // For editing: use existing clip's start time
  const endTime = isEditMode ? existingClip.endTime : currentTime;
  const startTime = isEditMode ? existingClip.startTime : Math.max(0, currentTime - duration);

  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl p-6 w-full max-w-lg shadow-2xl border border-gray-700 max-h-[90vh] overflow-y-auto">
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

        {/* Time info */}
        <div className="mb-4 text-sm text-gray-400">
          Start: <span className="font-mono text-white">{formatTimeDisplay(startTime)}</span>
          {' '}&rarr;{' '}
          End: <span className="font-mono text-white">{formatTimeDisplay(endTime)}</span>
        </div>

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

        {/* Clip Name */}
        {(selectedTags.length > 0 || clipName) && (
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
        )}

        {/* Duration Slider */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-gray-400 text-sm">Duration</label>
            <span className="text-white font-mono text-sm">{duration.toFixed(1)}s</span>
          </div>
          <input
            type="range"
            min={MIN_CLIP_DURATION}
            max={MAX_CLIP_DURATION}
            step={0.5}
            value={duration}
            onChange={(e) => setDuration(parseFloat(e.target.value))}
            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
          />
          <div className="relative w-full h-5 mt-1">
            <span className="absolute left-0 text-xs text-gray-500">{MIN_CLIP_DURATION}s</span>
            <span className="absolute text-xs text-gray-500" style={{ left: `${((DEFAULT_CLIP_DURATION - MIN_CLIP_DURATION) / (MAX_CLIP_DURATION - MIN_CLIP_DURATION)) * 100}%`, transform: 'translateX(-50%)' }}>{DEFAULT_CLIP_DURATION}s</span>
            <span className="absolute right-0 text-xs text-gray-500">{MAX_CLIP_DURATION}s</span>
          </div>
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
