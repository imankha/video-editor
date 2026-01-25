import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { X, Filter, Clock, Film, Settings, Sliders, Check, Star, List, Play } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { ensureUniqueName } from '../utils/uniqueName';

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
export function GameClipSelectorModal({ isOpen, onClose, onCreate, games = [], existingProjectNames = [] }) {
  // Form state
  const [projectName, setProjectName] = useState('');
  const [isNameManuallySet, setIsNameManuallySet] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [selectedGameIds, setSelectedGameIds] = useState([]);
  const [minRating, setMinRating] = useState(0); // 0 = All clips
  const [selectedTags, setSelectedTags] = useState([]);
  const [excludedClipIds, setExcludedClipIds] = useState(new Set()); // Clips excluded from project

  // Data state
  const [rawClips, setRawClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // Preview state
  const [previewingClip, setPreviewingClip] = useState(null);
  const previewVideoRef = useRef(null);

  // Fetch raw clips on mount and reset form state
  useEffect(() => {
    if (!isOpen) return;

    // Reset form when modal opens
    setProjectName('');
    setIsNameManuallySet(false);
    setSelectedGameIds([]);
    setMinRating(0);
    setSelectedTags([]);
    setExcludedClipIds(new Set());

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

  // Compute included clips (filtered minus manually excluded)
  const includedClips = useMemo(() => {
    return filteredClips.filter(clip => !excludedClipIds.has(clip.id));
  }, [filteredClips, excludedClipIds]);

  // Compute preview stats (real-time) - based on included clips only
  const preview = useMemo(() => {
    const totalDuration = includedClips.reduce((sum, clip) => {
      const start = clip.start_time || 0;
      const end = clip.end_time || 0;
      return sum + Math.max(0, end - start);
    }, 0);

    return {
      clip_count: includedClips.length,
      total_duration: totalDuration
    };
  }, [includedClips]);

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

  /**
   * Detect season from a date
   * @param {Date} date
   * @returns {'Winter' | 'Spring' | 'Summer' | 'Fall'}
   */
  const getSeason = (date) => {
    const month = date.getMonth(); // 0-11
    if (month >= 2 && month <= 4) return 'Spring';
    if (month >= 5 && month <= 7) return 'Summer';
    if (month >= 8 && month <= 10) return 'Fall';
    return 'Winter';
  };

  /**
   * Check if all games fall within the same season
   * @param {Array} gameList - List of games with date/created_at
   * @returns {{ season: string, year: number } | null}
   */
  const detectSeasonPattern = (gameList) => {
    if (gameList.length === 0) return null;

    const dates = gameList
      .map(g => g.date || g.game_date || g.created_at)
      .filter(Boolean)
      .map(d => new Date(d));

    if (dates.length === 0) return null;

    const seasons = dates.map(d => ({ season: getSeason(d), year: d.getFullYear() }));
    const firstSeason = seasons[0];

    // Check if all games are in the same season and year
    const allSameSeason = seasons.every(
      s => s.season === firstSeason.season && s.year === firstSeason.year
    );

    if (allSameSeason) {
      return firstSeason;
    }

    // Check if all games are in the same year (different seasons)
    const allSameYear = seasons.every(s => s.year === firstSeason.year);
    if (allSameYear && gameList.length <= 4) {
      return { season: null, year: firstSeason.year };
    }

    return null;
  };

  /**
   * Format a game date for display (e.g., "Jan 14")
   */
  const formatGameDate = (game) => {
    const dateStr = game.date || game.game_date || game.created_at;
    if (!dateStr) return null;

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;

    const month = date.toLocaleString('en-US', { month: 'short' });
    const day = date.getDate();
    return `${month} ${day}`;
  };

  /**
   * Generate intelligent default project name based on filters
   *
   * Priority:
   * 1. Single game → "Game Name - Date" or just "Game Name"
   * 2. 5-star only → "Brilliants" (or "Game Name Brilliants")
   * 3. Same season games → "Fall 2024" or "Spring 2025"
   * 4. Tags selected → Include tag names
   * 5. Fallback → "Highlight Reel"
   */
  const suggestedName = useMemo(() => {
    const parts = [];

    // Determine which games we're working with
    const activeGames = selectedGameIds.length > 0
      ? games.filter(g => selectedGameIds.includes(g.id))
      : gamesWithCounts;

    // Check if this is a "Brilliants" collection (5-star only)
    const isBrilliants = minRating === 5;

    // === SINGLE GAME ===
    if (activeGames.length === 1) {
      const game = activeGames[0];
      let gamePart = game.name;

      // Try to add date
      const dateStr = formatGameDate(game);
      if (dateStr) {
        gamePart = `${game.name} ${dateStr}`;
      }

      parts.push(gamePart);
    }
    // === MULTIPLE GAMES ===
    else if (activeGames.length > 1) {
      const seasonInfo = detectSeasonPattern(activeGames);

      if (seasonInfo?.season) {
        // All games in same season: "Fall 2024"
        parts.push(`${seasonInfo.season} ${seasonInfo.year}`);
      } else if (seasonInfo?.year) {
        // Same year, different seasons: "2024 Highlights"
        parts.push(`${seasonInfo.year}`);
      } else if (activeGames.length === 2) {
        // Two games: combine names
        parts.push(`${activeGames[0].name} & ${activeGames[1].name}`);
      }
      // else: no specific pattern, will use Brilliants or tags or fallback
    }

    // === ADD BRILLIANTS LABEL ===
    if (isBrilliants) {
      if (parts.length === 0) {
        parts.push('Brilliants');
      } else {
        parts.push('Brilliants');
      }
    }

    // === ADD TAGS ===
    if (selectedTags.length > 0) {
      // Format tags nicely (capitalize, limit to 2-3)
      const tagPart = selectedTags
        .slice(0, 3)
        .map(t => t.charAt(0).toUpperCase() + t.slice(1))
        .join(' ');

      if (parts.length === 0) {
        parts.push(tagPart);
      } else {
        parts.push(tagPart);
      }
    }

    // === FALLBACK ===
    if (parts.length === 0) {
      // Check rating for descriptive name
      if (minRating === 4) {
        parts.push('Good To Brilliant');
      } else if (minRating === 3) {
        parts.push('Highlights');
      } else {
        parts.push('Highlight Reel');
      }
    }

    // Join parts with appropriate separator
    const baseName = parts.join(' ');

    // Ensure the name is unique among existing projects
    return ensureUniqueName(baseName, existingProjectNames);
  }, [selectedGameIds, games, gamesWithCounts, minRating, selectedTags, existingProjectNames]);

  // Auto-update project name when filters change (unless manually edited)
  useEffect(() => {
    if (!isNameManuallySet && suggestedName) {
      setProjectName(suggestedName);
    }
  }, [suggestedName, isNameManuallySet]);

  // Handle manual name input
  const handleNameChange = useCallback((e) => {
    const value = e.target.value;
    setProjectName(value);
    // Mark as manually set if user types something different from suggestion
    if (value !== suggestedName) {
      setIsNameManuallySet(true);
    }
    // If user clears the field or matches suggestion, allow auto-update again
    if (value === '' || value === suggestedName) {
      setIsNameManuallySet(false);
    }
  }, [suggestedName]);

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

  // Toggle individual clip inclusion
  const toggleClip = useCallback((clipId) => {
    setExcludedClipIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) {
        next.delete(clipId);
      } else {
        next.add(clipId);
      }
      return next;
    });
  }, []);

  // Select all clips (clear exclusions)
  const selectAllClips = useCallback(() => {
    setExcludedClipIds(new Set());
  }, []);

  // Deselect all clips (exclude all)
  const deselectAllClips = useCallback(() => {
    setExcludedClipIds(new Set(filteredClips.map(c => c.id)));
  }, [filteredClips]);

  // Get video URL for a game - uses presigned R2 URL if available
  const getGameVideoUrl = useCallback((gameId) => {
    // Look up game to check for presigned URL
    const game = games.find(g => g.id === gameId);
    if (game?.video_url) {
      return game.video_url;
    }
    // Fallback to local proxy
    return `${API_BASE}/api/games/${gameId}/video`;
  }, [games]);

  // Open clip preview
  const openPreview = useCallback((clip, e) => {
    e.stopPropagation(); // Don't toggle clip selection
    setPreviewingClip(clip);
  }, []);

  // Close clip preview
  const closePreview = useCallback(() => {
    setPreviewingClip(null);
  }, []);

  // Handle video loaded - seek to start time
  const handlePreviewVideoLoaded = useCallback(() => {
    if (previewVideoRef.current && previewingClip) {
      previewVideoRef.current.currentTime = previewingClip.start_time || 0;
      previewVideoRef.current.play();
    }
  }, [previewingClip]);

  // Handle video time update - stop at end time
  const handlePreviewTimeUpdate = useCallback(() => {
    if (previewVideoRef.current && previewingClip) {
      const endTime = previewingClip.end_time || previewVideoRef.current.duration;
      if (previewVideoRef.current.currentTime >= endTime) {
        previewVideoRef.current.pause();
        previewVideoRef.current.currentTime = previewingClip.start_time || 0;
      }
    }
  }, [previewingClip]);

  // Handle create
  const handleCreate = async () => {
    if (!projectName.trim() || includedClips.length === 0) return;

    setCreating(true);
    try {
      // Pass specific clip IDs to preserve user's selection
      const clipIds = includedClips.map(c => c.id);

      const response = await fetch(`${API_BASE_URL}/projects/from-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: projectName.trim(),
          aspect_ratio: aspectRatio,
          game_ids: selectedGameIds,
          min_rating: minRating,
          tags: selectedTags,
          clip_ids: clipIds
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
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            iconOnly
            onClick={onClose}
          />
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

              {/* ==================== CLIPS LIST SECTION ==================== */}
              {filteredClips.length > 0 && (
                <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <List size={16} className="text-blue-400" />
                      <h3 className="text-sm font-semibold text-white uppercase tracking-wide">
                        Clips
                        {excludedClipIds.size > 0 && (
                          <span className="ml-2 text-xs font-normal text-gray-400">
                            ({includedClips.length} of {filteredClips.length} selected)
                          </span>
                        )}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={selectAllClips}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Select All
                      </button>
                      <span className="text-gray-600">|</span>
                      <button
                        type="button"
                        onClick={deselectAllClips}
                        className="text-xs text-gray-400 hover:text-gray-300"
                      >
                        Deselect All
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {filteredClips.map(clip => {
                      const isIncluded = !excludedClipIds.has(clip.id);
                      const clipDuration = Math.max(0, (clip.end_time || 0) - (clip.start_time || 0));
                      const clipTags = clip.tags || [];
                      const gameName = games.find(g => g.id === clip.game_id)?.name;

                      return (
                        <button
                          key={clip.id}
                          type="button"
                          onClick={() => toggleClip(clip.id)}
                          className={`w-full flex items-center gap-3 p-2 rounded-lg border transition-colors text-left ${
                            isIncluded
                              ? 'bg-gray-700/50 border-gray-600 hover:border-blue-500'
                              : 'bg-gray-800/50 border-gray-700 opacity-50 hover:opacity-75'
                          }`}
                        >
                          {/* Checkbox indicator */}
                          <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ${
                            isIncluded ? 'bg-blue-600' : 'bg-gray-600'
                          }`}>
                            {isIncluded && <Check size={14} className="text-white" />}
                          </div>

                          {/* Clip info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              {/* Rating stars */}
                              {clip.rating >= 5 && <Star size={12} className="text-yellow-400" fill="currentColor" />}
                              <span className={`text-sm truncate ${isIncluded ? 'text-white' : 'text-gray-400'}`}>
                                {clip.name || `Clip ${clip.id}`}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              {gameName && <span>{gameName}</span>}
                              {gameName && clipTags.length > 0 && <span>•</span>}
                              {clipTags.length > 0 && (
                                <span className="truncate">{clipTags.slice(0, 2).join(', ')}</span>
                              )}
                            </div>
                          </div>

                          {/* Play preview button */}
                          <button
                            type="button"
                            onClick={(e) => openPreview(clip, e)}
                            className="p-1.5 rounded hover:bg-purple-600/50 transition-colors flex-shrink-0"
                            title="Preview clip"
                          >
                            <Play size={14} className="text-purple-400" />
                          </button>

                          {/* Duration */}
                          <span className="text-xs text-gray-500 flex-shrink-0">
                            {formatDuration(clipDuration)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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
                      {!isNameManuallySet && projectName && (
                        <span className="ml-2 text-xs text-purple-400">(auto)</span>
                      )}
                    </label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={handleNameChange}
                      placeholder="My Highlight Reel"
                      className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                    />
                    {!isNameManuallySet && (
                      <p className="text-xs text-gray-500 mt-1">
                        Name updates automatically based on your filters
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-700">
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
            onClick={handleCreate}
            disabled={!projectName.trim() || preview.clip_count === 0 || creating}
            loading={creating}
          >
            {creating ? 'Creating...' : `Create with ${preview.clip_count} Clips`}
          </Button>
        </div>
      </div>

      {/* Video Preview Modal */}
      {previewingClip && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 z-[60]"
            onClick={closePreview}
          />

          {/* Modal */}
          <div className="fixed inset-8 md:inset-16 lg:inset-24 z-[70] flex flex-col bg-gray-900 rounded-xl overflow-hidden shadow-2xl border border-gray-700">
            {/* Header */}
            <div className="flex items-center justify-between p-3 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <Play size={18} className="text-purple-400" />
                <div>
                  <h3 className="text-white font-medium">
                    {previewingClip.name || `Clip ${previewingClip.id}`}
                  </h3>
                  <p className="text-xs text-gray-400">
                    {games.find(g => g.id === previewingClip.game_id)?.name}
                    {' • '}
                    {formatDuration((previewingClip.end_time || 0) - (previewingClip.start_time || 0))}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Include/Exclude toggle */}
                <Button
                  variant={excludedClipIds.has(previewingClip.id) ? 'secondary' : 'success'}
                  size="sm"
                  icon={Check}
                  onClick={() => toggleClip(previewingClip.id)}
                >
                  {excludedClipIds.has(previewingClip.id) ? 'Excluded' : 'Included'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  iconOnly
                  onClick={closePreview}
                />
              </div>
            </div>

            {/* Video Player */}
            <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
              <video
                ref={previewVideoRef}
                src={getGameVideoUrl(previewingClip.game_id)}
                controls
                onLoadedMetadata={handlePreviewVideoLoaded}
                onTimeUpdate={handlePreviewTimeUpdate}
                className="w-full h-full object-contain"
                style={{ maxHeight: '100%', maxWidth: '100%' }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default GameClipSelectorModal;
