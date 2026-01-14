import { useState, useEffect, useMemo } from 'react';
import { X, Star, Check, Film, Clock, Filter } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { createGameLookup, formatClipDisplayName } from '../utils/gameNameLookup';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * ClipLibraryModal - Select clips from the raw clips library with filters
 *
 * Features:
 * - Game filter (with clip counts)
 * - Rating filter (All, 3+, 4+, 5 only)
 * - Tag filter
 * - Real-time clip count and duration preview
 * - Shows "Game Name > Clip Name" format
 *
 * @param {boolean} isOpen - Whether modal is visible
 * @param {function} onClose - Callback to close modal
 * @param {function} onSelectClip - Callback when clip is selected (receives raw_clip_id)
 * @param {number[]} existingClipIds - Raw clip IDs already in the project
 * @param {Array} games - Array of game objects with id and name
 */
export function ClipLibraryModal({
  isOpen,
  onClose,
  onSelectClip,
  existingClipIds = [],
  games = []
}) {
  // Data state
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Filter state
  const [selectedGameIds, setSelectedGameIds] = useState([]);
  const [minRating, setMinRating] = useState(0); // 0 = All
  const [selectedTags, setSelectedTags] = useState([]);

  // Game lookup map
  const gameLookup = useMemo(() => createGameLookup(games), [games]);

  // Fetch raw clips
  useEffect(() => {
    if (!isOpen) return;

    const fetchClips = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/clips/raw`);
        if (response.ok) {
          const data = await response.json();
          setClips(data);
        }
      } catch (err) {
        console.error('Failed to fetch clips:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClips();
    // Reset filters and selection when modal opens
    setSelectedIds(new Set());
    setSelectedGameIds([]);
    setMinRating(0);
    setSelectedTags([]);
  }, [isOpen]);

  // Compute filtered clips
  const filteredClips = useMemo(() => {
    return clips.filter(clip => {
      // Exclude clips already in project
      if (existingClipIds.includes(clip.id)) return false;

      // Rating filter
      const clipRating = clip.rating || 0;
      if (minRating > 0 && clipRating < minRating) return false;

      // Game filter
      if (selectedGameIds.length > 0 && !selectedGameIds.includes(clip.game_id)) {
        return false;
      }

      // Tag filter (must have ALL selected tags)
      if (selectedTags.length > 0) {
        const clipTags = clip.tags || [];
        if (!selectedTags.every(tag => clipTags.includes(tag))) return false;
      }

      return true;
    });
  }, [clips, existingClipIds, minRating, selectedGameIds, selectedTags]);

  // Compute preview stats
  const preview = useMemo(() => {
    const totalDuration = filteredClips.reduce((sum, clip) => {
      const start = clip.start_time || 0;
      const end = clip.end_time || 0;
      return sum + Math.max(0, end - start);
    }, 0);

    return {
      clipCount: filteredClips.length,
      totalDuration
    };
  }, [filteredClips]);

  // Get available tags from filtered clips (based on game/rating)
  const availableTags = useMemo(() => {
    const baseFiltered = clips.filter(clip => {
      if (existingClipIds.includes(clip.id)) return false;
      const clipRating = clip.rating || 0;
      if (minRating > 0 && clipRating < minRating) return false;
      if (selectedGameIds.length > 0 && !selectedGameIds.includes(clip.game_id)) return false;
      return true;
    });

    const tagSet = new Set();
    baseFiltered.forEach(clip => {
      (clip.tags || []).forEach(tag => tagSet.add(tag));
    });
    return [...tagSet].sort();
  }, [clips, existingClipIds, minRating, selectedGameIds]);

  // Get games with clip counts
  const gamesWithCounts = useMemo(() => {
    const countMap = {};
    clips.forEach(clip => {
      if (existingClipIds.includes(clip.id)) return;
      const clipRating = clip.rating || 0;
      if (clip.game_id && (minRating === 0 || clipRating >= minRating)) {
        countMap[clip.game_id] = (countMap[clip.game_id] || 0) + 1;
      }
    });

    return games
      .map(game => ({
        ...game,
        clipCount: countMap[game.id] || 0
      }))
      .filter(g => g.clipCount > 0);
  }, [clips, games, existingClipIds, minRating]);

  if (!isOpen) return null;

  // Handlers
  const handleToggleSelect = (clipId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) {
        next.delete(clipId);
      } else {
        next.add(clipId);
      }
      return next;
    });
  };

  const handleToggleGame = (gameId) => {
    setSelectedGameIds(prev => {
      if (prev.includes(gameId)) {
        return prev.filter(id => id !== gameId);
      }
      return [...prev, gameId];
    });
  };

  const handleToggleTag = (tag) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      }
      return [...prev, tag];
    });
  };

  const handleAdd = () => {
    selectedIds.forEach(id => {
      onSelectClip(id);
    });
    setSelectedIds(new Set());
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] flex flex-col border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Filter size={20} />
            Add from Library
          </h2>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            iconOnly
            onClick={onClose}
          />
        </div>

        {/* Filters */}
        <div className="p-4 bg-gray-900/50 border-b border-gray-700 space-y-3">
          {/* Games */}
          {gamesWithCounts.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Games</label>
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                {gamesWithCounts.map(game => (
                  <button
                    key={game.id}
                    onClick={() => handleToggleGame(game.id)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      selectedGameIds.includes(game.id)
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {game.name} ({game.clipCount})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rating */}
          <div>
            <label className="block text-xs text-gray-400 mb-1">Minimum Rating</label>
            <div className="flex gap-1">
              {[
                { value: 0, label: 'All' },
                { value: 3, label: '3+' },
                { value: 4, label: '4+' },
                { value: 5, label: '5 Only' }
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setMinRating(opt.value)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    minRating === opt.value
                      ? 'bg-purple-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          {availableTags.length > 0 && (
            <div>
              <label className="block text-xs text-gray-400 mb-1">Tags</label>
              <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
                {availableTags.map(tag => (
                  <button
                    key={tag}
                    onClick={() => handleToggleTag(tag)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      selectedTags.includes(tag)
                        ? 'bg-green-600 text-white'
                        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Preview summary */}
          <div className="flex items-center gap-6 text-sm text-gray-300 pt-2 border-t border-gray-700">
            <span className="flex items-center gap-1">
              <Film size={14} />
              {preview.clipCount} clips
            </span>
            <span className="flex items-center gap-1">
              <Clock size={14} />
              {formatDuration(preview.totalDuration)}
            </span>
          </div>
        </div>

        {/* Content - Clip list */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : filteredClips.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {clips.length === 0
                ? 'No clips in library. Create clips in Annotate mode first.'
                : 'No clips match the current filters.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredClips.map(clip => {
                const isSelected = selectedIds.has(clip.id);
                const displayName = formatClipDisplayName(
                  clip.name || clip.filename?.replace('.mp4', '') || 'Unnamed',
                  clip.game_id,
                  gameLookup
                );

                return (
                  <div
                    key={clip.id}
                    onClick={() => handleToggleSelect(clip.id)}
                    className={`p-3 rounded-lg cursor-pointer border transition-all ${
                      isSelected
                        ? 'bg-purple-900/40 border-purple-500'
                        : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                        isSelected
                          ? 'bg-purple-600 border-purple-600'
                          : 'border-gray-500'
                      }`}>
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>

                      {/* Clip info */}
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-medium truncate" title={displayName}>
                          {displayName}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {/* Rating stars */}
                          <span className="flex">
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star
                                key={n}
                                size={12}
                                fill={n <= (clip.rating || 0) ? '#fbbf24' : 'transparent'}
                                color={n <= (clip.rating || 0) ? '#fbbf24' : '#6b7280'}
                              />
                            ))}
                          </span>
                          {/* Duration */}
                          {clip.start_time !== undefined && clip.end_time !== undefined && (
                            <span className="text-xs">
                              {formatDuration(clip.end_time - clip.start_time)}
                            </span>
                          )}
                          {/* Tags */}
                          {clip.tags?.length > 0 && (
                            <span className="text-xs truncate">
                              {clip.tags.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex gap-3">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleAdd}
            disabled={selectedIds.size === 0}
          >
            Add {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ClipLibraryModal;
