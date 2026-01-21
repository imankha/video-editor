import React, { useState, useEffect } from 'react';
import { X, Download, Trash2, FolderOpen, Loader, AlertCircle, Video, Play, Image, Columns, Star, Folder, Film, LayoutGrid } from 'lucide-react';
import { Button } from './shared/Button';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { useDownloads } from '../hooks/useDownloads';
import { useGalleryStore } from '../stores/galleryStore';

// Rating notation symbols (chess-inspired) - matches NotesOverlay
const RATING_NOTATION = {
  5: '!!',  // Brilliant
  4: '!',   // Good
  3: '!?',  // Interesting
  2: '?',   // Mistake
  1: '??',  // Blunder
};

// Rating colors for badges - matches NotesOverlay
const RATING_COLORS = {
  5: { bg: 'bg-green-600/20', text: 'text-green-400', border: 'border-green-600/40' },  // Brilliant
  4: { bg: 'bg-emerald-600/20', text: 'text-emerald-400', border: 'border-emerald-600/40' },  // Good
  3: { bg: 'bg-blue-600/20', text: 'text-blue-400', border: 'border-blue-600/40' },  // Interesting
  2: { bg: 'bg-amber-600/20', text: 'text-amber-400', border: 'border-amber-600/40' },  // Mistake
  1: { bg: 'bg-red-600/20', text: 'text-red-400', border: 'border-red-600/40' },  // Blunder
};

// Rating field names matching backend RatingCounts model
const RATING_FIELDS = [
  { rating: 5, field: 'brilliant' },
  { rating: 4, field: 'good' },
  { rating: 3, field: 'interesting' },
  { rating: 2, field: 'mistake' },
  { rating: 1, field: 'blunder' },
];

// Filter options for gallery source types (icon-only with tooltips)
const FILTER_OPTIONS = [
  { value: null, label: 'All', icon: LayoutGrid, color: 'text-gray-400' },
  { value: 'brilliant_clip', label: 'Brilliant Clips', icon: Star, color: 'text-yellow-400' },
  { value: 'custom_project', label: 'Custom Projects', icon: Folder, color: 'text-purple-400' },
  { value: 'annotated_game', label: 'Annotated Games', icon: Film, color: 'text-green-400' },
];

/**
 * RatingCountsBadges - Displays rating counts as badges for annotated game downloads
 * Shows count + notation symbol (e.g., "5!!") for each rating with clips
 */
function RatingCountsBadges({ ratingCounts }) {
  if (!ratingCounts) return null;

  const badges = RATING_FIELDS
    .map(({ rating, field }) => {
      const count = ratingCounts[field] || 0;
      if (count === 0) return null;
      const colors = RATING_COLORS[rating];
      const notation = RATING_NOTATION[rating];
      return (
        <span
          key={rating}
          className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${colors.bg} ${colors.text} ${colors.border}`}
          title={`${count} ${field} clip${count !== 1 ? 's' : ''}`}
        >
          {count}{notation}
        </span>
      );
    })
    .filter(Boolean);

  if (badges.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 mt-1.5">
      {badges}
      {ratingCounts.weighted_average != null && (
        <span className="text-xs text-gray-500 ml-1">
          avg: {ratingCounts.weighted_average.toFixed(1)}
        </span>
      )}
    </div>
  );
}

/**
 * DownloadsPanel - Slide-out panel for managing final video downloads
 *
 * Features:
 * - Lists all final videos grouped by date
 * - Each item shows: project name, filename, date, file size
 * - Actions: Download to local, Open project, Delete
 *
 * Race-safe:
 * - Uses useDownloads hook with AbortController
 * - Shows loading skeleton while fetching
 * - Guards against stale state updates
 */
export function DownloadsPanel({
  onOpenProject,  // (projectId) => void - Navigate to project
  onOpenGame,     // (gameId) => void - Navigate to annotate mode with game
}) {
  // Gallery state from store
  const isOpen = useGalleryStore((state) => state.isOpen);
  const close = useGalleryStore((state) => state.close);
  const setCount = useGalleryStore((state) => state.setCount);

  const {
    downloads,
    loadState,
    error,
    filter,
    hasDownloads,
    groupedDownloads,
    deleteDownload,
    downloadFile,
    getDownloadUrl,
    formatFileSize,
    formatDate,
    setFilter
  } = useDownloads(isOpen);

  // Sync download count to gallery store
  useEffect(() => {
    if (downloads) {
      setCount(downloads.length);
    }
  }, [downloads, setCount]);

  // State for video preview modal
  const [playingVideo, setPlayingVideo] = useState(null);

  // State for before/after export
  const [exportingBeforeAfter, setExportingBeforeAfter] = useState(null);

  if (!isOpen) return null;

  const groups = groupedDownloads();

  const handleDelete = async (e, download) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${download.filename}"?`)) {
      await deleteDownload(download.id, true);
      // Count will auto-update via the useEffect when downloads changes
    }
  };

  const handleDownload = (e, download) => {
    e.stopPropagation();
    console.log('[DownloadsPanel] handleDownload:', { id: download.id, project_name: download.project_name });
    // Filename is controlled by backend's Content-Disposition header (single source of truth)
    downloadFile(download.id);
  };

  const handlePlay = (e, download) => {
    e.stopPropagation();
    setPlayingVideo(download);
  };

  const handleOpenProject = (e, download) => {
    e.stopPropagation();
    // For annotated game exports, navigate to the game in annotate mode
    if (download.source_type === 'annotated_game' && download.game_id && onOpenGame) {
      onOpenGame(download.game_id);
      close();
    } else if (onOpenProject && download.project_id && download.project_id !== 0) {
      onOpenProject(download.project_id);
      close();
    }
  };

  // Check if folder button should be shown for a download
  const canOpenSource = (download) => {
    if (download.source_type === 'annotated_game' && download.game_id && onOpenGame) {
      return true;
    }
    if (download.project_id && download.project_id !== 0 && onOpenProject) {
      return true;
    }
    return false;
  };

  // Get appropriate title for the folder button
  const getOpenSourceTitle = (download) => {
    if (download.source_type === 'annotated_game') {
      return 'Open game';
    }
    return 'Open project';
  };

  const handleBeforeAfter = async (e, download) => {
    e.stopPropagation();
    setExportingBeforeAfter(download.id);

    try {
      // First check if before/after is available
      const statusRes = await fetch(`/api/export/before-after/${download.id}/status`);
      const status = await statusRes.json();

      if (!status.available) {
        alert(status.error || 'Before/After comparison not available for this video');
        return;
      }

      // Generate the comparison video
      const response = await fetch(`/api/export/before-after/${download.id}`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate comparison video');
      }

      // Download the generated video
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `before_after_${download.project_name || download.id}.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

    } catch (error) {
      console.error('[DownloadsPanel] Before/After export error:', error);
      alert(`Failed to generate comparison: ${error.message}`);
    } finally {
      setExportingBeforeAfter(null);
    }
  };

  // Render a single download item card
  const renderDownloadCard = (download) => (
    <div
      key={download.id}
      className="p-3 bg-gray-700 rounded-lg border border-gray-600 hover:border-gray-500 transition-colors"
    >
      <div className="flex items-start gap-3">
        {/* Video icon */}
        <div className="w-10 h-10 rounded bg-purple-900/40 flex items-center justify-center flex-shrink-0">
          <Video size={20} className="text-purple-400" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium truncate">
            {download.project_name}
          </div>
          <div className="text-sm text-gray-400 truncate">
            {download.filename}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
            <span>{formatDate(download.created_at)}</span>
            <span>{formatFileSize(download.file_size)}</span>
          </div>
          {/* Rating counts for annotated games */}
          {download.source_type === 'annotated_game' && download.rating_counts && (
            <RatingCountsBadges ratingCounts={download.rating_counts} />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => handlePlay(e, download)}
            className="p-2 hover:bg-purple-900/40 rounded transition-colors"
            title="Play video"
          >
            <Play size={16} className="text-purple-400 hover:text-purple-300" />
          </button>
          <button
            onClick={(e) => handleDownload(e, download)}
            className="p-2 hover:bg-gray-600 rounded transition-colors"
            title="Download file"
          >
            <Download size={16} className="text-gray-400 hover:text-white" />
          </button>
          {download.source_type !== 'annotated_game' && (
            <button
              onClick={(e) => handleBeforeAfter(e, download)}
              disabled={exportingBeforeAfter === download.id}
              className="p-2 hover:bg-blue-900/40 rounded transition-colors disabled:opacity-50"
              title="Export Before/After comparison"
            >
              {exportingBeforeAfter === download.id ? (
                <Loader size={16} className="text-blue-400 animate-spin" />
              ) : (
                <Columns size={16} className="text-blue-400 hover:text-blue-300" />
              )}
            </button>
          )}
          {canOpenSource(download) && (
            <button
              onClick={(e) => handleOpenProject(e, download)}
              className="p-2 hover:bg-gray-600 rounded transition-colors"
              title={getOpenSourceTitle(download)}
            >
              <FolderOpen size={16} className="text-gray-400 hover:text-white" />
            </button>
          )}
          <button
            onClick={(e) => handleDelete(e, download)}
            className="p-2 hover:bg-red-900/40 rounded transition-colors"
            title="Delete download"
          >
            <Trash2 size={16} className="text-gray-400 hover:text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );

  // Group items by game within a date group
  const groupByGame = (items) => {
    const gameGroups = {};
    const ungrouped = [];

    items.forEach(item => {
      const key = item.group_key;
      if (key) {
        if (!gameGroups[key]) {
          gameGroups[key] = [];
        }
        gameGroups[key].push(item);
      } else {
        ungrouped.push(item);
      }
    });

    return { gameGroups, ungrouped, sortedKeys: Object.keys(gameGroups).sort() };
  };

  const renderGroup = (title, items) => {
    if (items.length === 0) return null;

    const { gameGroups, ungrouped, sortedKeys } = groupByGame(items);

    return (
      <div key={title} className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 mb-2 px-1">{title}</h3>
        <div className="space-y-2">
          {/* Ungrouped items first */}
          {ungrouped.map(download => renderDownloadCard(download))}

          {/* Grouped items by game - collapsed by default */}
          {sortedKeys.map(groupKey => (
            <CollapsibleGroup
              key={groupKey}
              title={groupKey}
              count={gameGroups[groupKey].length}
              defaultExpanded={false}
            >
              <div className="space-y-2">
                {gameGroups[groupKey].map(download => renderDownloadCard(download))}
              </div>
            </CollapsibleGroup>
          ))}
        </div>
      </div>
    );
  };

  const renderContent = () => {
    if (loadState === 'loading') {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader size={24} className="text-purple-500 animate-spin" />
        </div>
      );
    }

    if (loadState === 'error') {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertCircle size={32} className="text-red-400 mb-3" />
          <p className="text-gray-400 mb-4">{error || 'Failed to load downloads'}</p>
          <Button
            variant="secondary"
            onClick={() => window.location.reload()}
          >
            Retry
          </Button>
        </div>
      );
    }

    if (!hasDownloads) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Video size={48} className="text-gray-600 mb-4" />
          <p className="text-gray-400">No videos yet</p>
          <p className="text-sm text-gray-500 mt-1">
            Export from Overlay mode to see videos here
          </p>
        </div>
      );
    }

    return (
      <>
        {renderGroup('Today', groups.today)}
        {renderGroup('Yesterday', groups.yesterday)}
        {renderGroup('Last 7 Days', groups.lastWeek)}
        {renderGroup('Older', groups.older)}
      </>
    );
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={close}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-gray-800 shadow-xl z-50 flex flex-col border-l border-gray-700 animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Image size={20} className="text-purple-400" />
            <h2 className="text-lg font-bold text-white">Gallery</h2>
            {hasDownloads && (
              <span className="px-2 py-0.5 bg-purple-600 text-white text-xs font-medium rounded-full">
                {downloads.length}
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={X}
            iconOnly
            onClick={close}
          />
        </div>

        {/* Filter Tabs - Icon only with tooltips */}
        <div className="flex gap-1 p-2 border-b border-gray-700 bg-gray-800/50">
          {FILTER_OPTIONS.map((option) => {
            const isActive = filter === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value ?? 'all'}
                onClick={() => setFilter(option.value)}
                title={option.label}
                className={`p-2 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-purple-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <Icon size={18} className={isActive ? 'text-white' : option.color} />
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderContent()}
        </div>
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.2s ease-out forwards;
        }
      `}</style>

      {/* Video Preview Modal */}
      {playingVideo && (
        <>
          {/* Modal Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 z-[60]"
            onClick={() => setPlayingVideo(null)}
          />

          {/* Modal Content */}
          <div className="fixed inset-4 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <Video size={20} className="text-purple-400" />
                <div>
                  <h3 className="text-white font-medium">{playingVideo.project_name}</h3>
                  <p className="text-sm text-gray-400">{playingVideo.filename}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={Download}
                  onClick={() => {
                    console.log('[DownloadsPanel] Modal download:', { id: playingVideo.id, project_name: playingVideo.project_name });
                    downloadFile(playingVideo.id);
                  }}
                >
                  Download
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  iconOnly
                  onClick={() => setPlayingVideo(null)}
                />
              </div>
            </div>

            {/* Video Player */}
            <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
              <video
                src={getDownloadUrl(playingVideo.id, playingVideo)}
                controls
                autoPlay
                className="w-full h-full object-contain"
                style={{ maxHeight: '100%', maxWidth: '100%' }}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default DownloadsPanel;
