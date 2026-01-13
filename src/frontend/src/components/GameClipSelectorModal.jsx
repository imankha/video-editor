import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Filter, Clock, Film, Settings, Sliders } from 'lucide-react';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * GameClipSelectorModal - Create a project from library clips
 *
 * Allows users to:
 * - Select games to include (with clip counts)
 * - Filter by minimum rating (3+, 4+, 5 only)
 * - Filter by tags
 * - See total clip count and duration (real-time updates)
 * - Set project name and aspect ratio
 */
export function GameClipSelectorModal({ isOpen, onClose, onCreate, games = [] }) {
  // Form state
  const [projectName, setProjectName] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [selectedGameIds, setSelectedGameIds] = useState([]);
  const [minRating, setMinRating] = useState(0); // 0 = All clips
  const [selectedTags, setSelectedTags] = useState([]);

  // Data state
  const [rawClips, setRawClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Fetch raw clips on mount
  useEffect(() => {
    if (!isOpen) return;

    const fetchClips = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/clips/raw`);
        if (response.ok) {
          const clips = await response.json();
          setRawClips(clips);
        }
      } catch (err) {
        console.error('[GameClipSelectorModal] Failed to fetch clips:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClips();
  }, [isOpen]);

  // Compute filtered clips locally for instant preview
  const filteredClips = useMemo(() => {
    return rawClips.filter(clip => {
      // Rating filter (minRating = 0 means "All" - include everything)
      const clipRating = clip.rating ?? 0;
      if (minRating > 0 && clipRating < minRating) return false;

      // Game filter (empty = all games)
      if (selectedGameIds.length > 0 && !selectedGameIds.includes(clip.game_id)) {
        return false;
      }

      // Tag filter (clip must have ALL selected tags)
      if (selectedTags.length > 0) {
        const clipTags = clip.tags || [];
        const hasAllTags = selectedTags.every(tag => clipTags.includes(tag));
        if (!hasAllTags) return false;
      }

      return true;
    });
  }, [rawClips, minRating, selectedGameIds, selectedTags]);

  // Compute preview stats (real-time)
  const preview = useMemo(() => {
    const totalDuration = filteredClips.reduce((sum, clip) => {
      const start = clip.start_time || 0;
      const end = clip.end_time || 0;
      return sum + Math.max(0, end - start);
    }, 0);

    return {
      clip_count: filteredClips.length,
      total_duration: totalDuration
    };
  }, [filteredClips]);

  // Get all unique tags from filtered clips (updates based on game/rating filters)
  const availableTags = useMemo(() => {
    // Get clips that match game and rating filters (but not tag filter)
    const baseFilteredClips = rawClips.filter(clip => {
      const clipRating = clip.rating ?? 0;
      if (minRating > 0 && clipRating < minRating) return false;
      if (selectedGameIds.length > 0 && !selectedGameIds.includes(clip.game_id)) {
        return false;
      }
      return true;
    });

    const tagSet = new Set();
    baseFilteredClips.forEach(clip => {
      (clip.tags || []).forEach(tag => tagSet.add(tag));
    });
    return [...tagSet].sort();
  }, [rawClips, minRating, selectedGameIds]);

  // Get games with their clip counts (based on rating filter)
  const gamesWithCounts = useMemo(() => {
    const countMap = {};
    rawClips.forEach(clip => {
      const clipRating = clip.rating ?? 0;
      // minRating = 0 means "All", so include all clips
      if (clip.game_id && (minRating === 0 || clipRating >= minRating)) {
        countMap[clip.game_id] = (countMap[clip.game_id] || 0) + 1;
      }
    });

    return games.map(game => ({
      ...game,
      clipCount: countMap[game.id] || 0
    })).filter(g => g.clipCount > 0);
  }, [games, rawClips, minRating]);

  // Format duration for display
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Toggle game selection
  const toggleGame = useCallback((gameId) => {
    setSelectedGameIds(prev => {
      if (prev.includes(gameId)) {
        return prev.filter(id => id !== gameId);
      }
      return [...prev, gameId];
    });
  }, []);

  // Toggle tag selection
  const toggleTag = useCallback((tag) => {
    setSelectedTags(prev => {
      if (prev.includes(tag)) {
        return prev.filter(t => t !== tag);
      }
      return [...prev, tag];
    });
  }, []);

  // Handle create
  const handleCreate = async () => {
    if (!projectName.trim() || filteredClips.length === 0) return;

    setCreating(true);
    try {
      const response = await fetch(`${API_BASE_URL}/projects/from-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          aspect_ratio: aspectRatio,
          game_ids: selectedGameIds,
          min_rating: minRating,
          tags: selectedTags
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to create project');
      }

      const project = await response.json();
      onCreate?.(project);
      onClose();
    } catch (err) {
      console.error('[GameClipSelectorModal] Failed to create project:', err);
      alert(`Failed to create project: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Create Project from Clips</h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white rounded transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-180px)]">
          {loading ? (
            <div className="text-center py-8 text-gray-400">Loading clips...</div>
          ) : rawClips.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              No clips in library. Annotate some games first!
            </div>
          ) : (
            <div className="space-y-6">
              {/* ==================== FILTERS SECTION ==================== */}
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 mb-4">
                  <Filter size={16} className="text-blue-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Filters</h3>
                </div>

                <div className="space-y-4">
                  {/* Game Filter */}
                  {gamesWithCounts.length > 0 && (
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">
                        Games {selectedGameIds.length > 0 && (
                          <span className="text-blue-400">({selectedGameIds.length} selected)</span>
                        )}
                      </label>
                      <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                        {gamesWithCounts.map(game => (
                          <button
                            key={game.id}
                            type="button"
                            onClick={() => toggleGame(game.id)}
                            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                              selectedGameIds.includes(game.id)
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                            }`}
                          >
                            {game.name} ({game.clipCount})
                          </button>
                        ))}
                      </div>
                      {selectedGameIds.length === 0 && (
                        <p className="text-xs text-gray-500 mt-1">All games included</p>
                      )}
                    </div>
                  )}

                  {/* Rating Filter */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      Minimum Rating
                    </label>
                    <div className="flex gap-2">
                      {[
                        { value: 0, label: 'All' },
                        { value: 3, label: '3+' },
                        { value: 4, label: '4+' },
                        { value: 5, label: '5 Only' },
                      ].map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMinRating(option.value)}
                          className={`px-4 py-2 rounded-lg border transition-colors ${
                            minRating === option.value
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tag Filter */}
                  {availableTags.length > 0 && (
                    <div>
                      <label className="block text-sm text-gray-400 mb-2">
                        Tags {selectedTags.length > 0 && (
                          <span className="text-green-400">({selectedTags.length} selected)</span>
                        )}
                      </label>
                      <div className="flex flex-wrap gap-2 max-h-20 overflow-y-auto">
                        {availableTags.map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => toggleTag(tag)}
                            className={`px-3 py-1 rounded-full border text-xs transition-colors ${
                              selectedTags.includes(tag)
                                ? 'bg-green-600 border-green-500 text-white'
                                : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                            }`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Real-time Summary - inside filter section */}
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <div className="flex items-center justify-center gap-8">
                    <div className="flex items-center gap-2">
                      <Film size={18} className="text-purple-400" />
                      <span className="text-2xl font-bold text-white">{preview.clip_count}</span>
                      <span className="text-gray-400 text-sm">clips</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock size={18} className="text-purple-400" />
                      <span className="text-2xl font-bold text-white">{formatDuration(preview.total_duration)}</span>
                      <span className="text-gray-400 text-sm">total</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* ==================== SETTINGS SECTION ==================== */}
              <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                <div className="flex items-center gap-2 mb-4">
                  <Settings size={16} className="text-purple-400" />
                  <h3 className="text-sm font-semibold text-white uppercase tracking-wide">Settings</h3>
                </div>

                <div className="space-y-4">
                  {/* Aspect Ratio */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      Aspect Ratio
                    </label>
                    <div className="flex gap-2">
                      {[
                        { value: '16:9', label: '16:9', desc: 'Landscape' },
                        { value: '9:16', label: '9:16', desc: 'Portrait' },
                        { value: '1:1', label: '1:1', desc: 'Square' },
                      ].map(option => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAspectRatio(option.value)}
                          className={`flex-1 p-2 rounded-lg border transition-colors ${
                            aspectRatio === option.value
                              ? 'bg-purple-600 border-purple-500 text-white'
                              : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                          }`}
                        >
                          <div className="font-medium text-sm">{option.label}</div>
                          <div className="text-xs opacity-70">{option.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Project Name */}
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">
                      Project Name
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="My Highlight Reel"
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-700">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!projectName.trim() || preview.clip_count === 0 || creating}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
          >
            {creating ? 'Creating...' : `Create with ${preview.clip_count} Clips`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default GameClipSelectorModal;
