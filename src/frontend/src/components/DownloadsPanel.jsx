import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Trash2, FolderOpen, Loader, AlertCircle, Video, Play, Image, Columns, Star, Folder, LayoutGrid } from 'lucide-react';
import { Button } from './shared/Button';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { MediaPlayer } from './MediaPlayer';
import { useDownloads } from '../hooks/useDownloads';
import { useGalleryStore } from '../stores/galleryStore';
import { SourceType, getSourceTypeLabel } from '../constants/sourceTypes';
import { useQuestStore } from '../stores/questStore';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { API_BASE } from '../config';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';

// Filter options for gallery source types (icon-only with tooltips)
const FILTER_OPTIONS = [
  { value: null, label: 'All', icon: LayoutGrid, color: 'text-gray-400' },
  { value: SourceType.BRILLIANT_CLIP, label: 'Brilliant Clips', icon: Star, color: 'text-yellow-400' },
  { value: SourceType.CUSTOM_PROJECT, label: 'Custom Reels', icon: Folder, color: REEL.accent },
];

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
    downloadingId,
    getDownloadUrl,
    getStreamingUrl,
    markWatched,
    formatFileSize,
    formatDuration,
    formatDate,
    setFilter
  } = useDownloads(isOpen);

  const setUnwatchedCount = useGalleryStore((state) => state.setUnwatchedCount);

  // Sync download count to gallery store
  useEffect(() => {
    if (loadState === 'ready') {
      setCount(downloads.length);
      setUnwatchedCount(downloads.filter(d => !d.watched_at).length);
    }
  }, [downloads, loadState, setCount, setUnwatchedCount]);

  // State for video preview modal
  const [playingVideo, setPlayingVideo] = useState(null);
  const watchTimerRef = useRef(null);

  // State for before/after export
  const [exportingBeforeAfter, setExportingBeforeAfter] = useState(null);

  // State for project restore (T66)
  const [restoringProjectId, setRestoringProjectId] = useState(null);

  if (!isOpen && !playingVideo) return null;

  const groups = isOpen ? groupedDownloads() : [];

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
    setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_ACTIVE);
    setPlayingVideo(download);
    close();
    if (!download.watched_at) markWatched(download.id);
    // T540: Record achievements for viewing gallery video
    useQuestStore.getState().recordAchievement('viewed_gallery_video');
    // Custom project video gets a separate achievement for Quest 3
    if (download.source_type === SourceType.CUSTOM_PROJECT) {
      useQuestStore.getState().recordAchievement('viewed_custom_project_video');
    }
    // T780: Record "watched 1s" achievement after 1 second of playback (autoPlay = true)
    clearTimeout(watchTimerRef.current);
    watchTimerRef.current = setTimeout(() => {
      useQuestStore.getState().recordAchievement('watched_gallery_video_1s');
      // Quest 3: milestone achievement — only if overlay step already complete
      const q3 = useQuestStore.getState().quests.find(q => q.id === 'quest_3');
      if (q3?.steps?.overlay_second_highlight) {
        useQuestStore.getState().recordAchievement('watched_gallery_video_after_2_overlays');
      }
    }, 1000);
  };

  const closeVideo = () => {
    clearTimeout(watchTimerRef.current);
    setPlayingVideo(null);
  };

  const handleOpenProject = async (e, download) => {
    e.stopPropagation();
    if (onOpenProject && download.project_id && download.project_id !== 0) {
      // T66: Restore project from archive if needed
      setRestoringProjectId(download.id);
      try {
        const response = await fetch(`${API_BASE}/api/downloads/${download.id}/restore-project`, {
          method: 'POST',
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.detail || 'Failed to restore reel');
        }
        const result = await response.json();
        // Navigate to the project (project_id from response, may differ if restored)
        onOpenProject(result.project_id);
        close();
      } catch (error) {
        console.error('[DownloadsPanel] Restore project error:', error);
        alert(`Failed to open reel as draft: ${error.message}`);
      } finally {
        setRestoringProjectId(null);
      }
    }
  };

  // Check if folder button should be shown for a download
  const canOpenSource = (download) => {
    if (download.project_id && download.project_id !== 0 && onOpenProject) {
      return true;
    }
    return false;
  };

  // Get appropriate title for the folder button
  const getOpenSourceTitle = () => 'Open Reel as Draft';

  const handleBeforeAfter = async (e, download) => {
    e.stopPropagation();
    setExportingBeforeAfter(download.id);

    try {
      // First check if before/after is available
      const statusRes = await fetch(`${API_BASE}/api/export/before-after/${download.id}/status`);
      const status = await statusRes.json();

      if (!status.available) {
        alert(status.error || 'Before/After comparison not available for this video');
        return;
      }

      // Generate the comparison video
      const response = await fetch(`${API_BASE}/api/export/before-after/${download.id}`, {
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

  // Check if a filename is a UUID/hash pattern (not meaningful to users)
  const isUuidFilename = (filename) => {
    if (!filename) return true;
    // Match patterns like: "3fc140fc2a79.mp4", "final_64_9753b5fe.mp4", "8ea26608de38.mp4"
    return /^[a-f0-9]{12}\.mp4$/i.test(filename) ||
           /^final_\d+_[a-f0-9]+\.mp4$/i.test(filename) ||
           /^working_\d+_[a-f0-9]+\.mp4$/i.test(filename);
  };

  // getSourceTypeLabel imported from constants/sourceTypes.js

  // Find the latest unwatched download ID (first unwatched in created_at DESC order)
  const latestUnwatchedId = downloads.find(d => !d.watched_at)?.id ?? null;

  // ID of the latest export (for auto-expanding its parent group)
  const latestDownloadId = downloads[0]?.id ?? null;

  const getUnwatchedStyle = (downloadId) => {
    if (downloadId === latestUnwatchedId) {
      return { border: 'border-cyan-400', dot: 'unwatched-dot unwatched-dot-cyan' };
    }
    return { border: 'border-blue-500', dot: 'bg-blue-500' };
  };

  // Render a single download item card
  const renderDownloadCard = (download) => {
    // Determine what to show as subtitle (avoid redundant or meaningless info)
    const showFilename = !isUuidFilename(download.filename);
    // Only show source type if project_name doesn't already indicate it
    const projectNameLower = (download.project_name || '').toLowerCase();
    const sourceTypeLabel = getSourceTypeLabel(download.source_type);
    const showSourceType = sourceTypeLabel &&
      !projectNameLower.includes('annotated') &&
      !projectNameLower.includes('brilliant');

    const isUnwatched = !download.watched_at;
    const style = isUnwatched ? getUnwatchedStyle(download.id) : null;

    return (
      <div
        key={download.id}
        className={`p-3 bg-gray-700 rounded-lg border transition-colors ${
          isUnwatched
            ? `${style.border} border-l-4`
            : 'border-gray-600 hover:border-gray-500'
        }`}
      >
        <div className="flex items-start gap-3">
          {/* Video icon with unwatched dot */}
          <div className={`relative w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${
            isUnwatched ? 'bg-cyan-900/40' : REEL.bgMuted
          }`}>
            <Video size={20} className={isUnwatched ? 'text-cyan-400' : REEL.accent} />
            {isUnwatched && (
              <span className={`absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full ${style.dot} ring-2 ring-gray-700`} />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="text-white font-medium truncate">
              {download.project_name}
            </div>
            {(showFilename || showSourceType) && (
              <div className="text-sm text-gray-400 truncate">
                {showFilename ? download.filename : sourceTypeLabel}
              </div>
            )}
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
            <span>{formatDate(download.created_at)}</span>
            {formatDuration(download.duration) && <span>{formatDuration(download.duration)}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => handlePlay(e, download)}
            className={`p-2 hover:${REEL.bgMuted} rounded transition-colors`}
            title="Play video"
          >
            <Play size={16} className={`${REEL.accent} hover:text-cyan-300`} />
          </button>
          <button
            onClick={(e) => handleDownload(e, download)}
            disabled={downloadingId === download.id}
            className="p-2 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
            title="Download file"
          >
            {downloadingId === download.id ? (
              <Loader size={16} className="text-gray-400 animate-spin" />
            ) : (
              <Download size={16} className="text-gray-400 hover:text-white" />
            )}
          </button>
          {!import.meta.env.PROD && (
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
              disabled={restoringProjectId === download.id}
              className="p-2 hover:bg-gray-600 rounded transition-colors disabled:opacity-50"
              title={getOpenSourceTitle(download)}
            >
              {restoringProjectId === download.id ? (
                <Loader size={16} className="text-gray-400 animate-spin" />
              ) : (
                <FolderOpen size={16} className="text-gray-400 hover:text-white" />
              )}
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
  };

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

          {/* Grouped items by game - latest export's group expanded by default */}
          {sortedKeys.map(groupKey => (
            <CollapsibleGroup
              key={groupKey}
              title={groupKey}
              count={gameGroups[groupKey].length}
              defaultExpanded={gameGroups[groupKey].some(d => d.id === latestDownloadId)}
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
          <Loader size={24} className={`${REEL.accent} animate-spin`} />
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
      {isOpen && <>
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
            <Image size={20} className={REEL.accent} />
            <h2 className="text-lg font-bold text-white">{SECTION_NAMES.LIBRARY}</h2>
            {hasDownloads && (
              <span className={`px-2 py-0.5 ${REEL.bg} text-white text-xs font-medium rounded-full`}>
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
                    ? `${REEL.bg} text-white`
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
      </>}

      {/* Video Preview Modal */}
      {playingVideo && (
        <>
          {/* Modal Backdrop */}
          <div
            className="fixed inset-0 bg-black/80 z-[60]"
            onClick={() => closeVideo()}
          />

          {/* Modal Content */}
          <div className="fixed inset-4 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <Video size={20} className={REEL.accent} />
                <div>
                  <h3 className="text-white font-medium">{playingVideo.project_name}</h3>
                  {(() => {
                    const showFilename = !isUuidFilename(playingVideo.filename);
                    const projectNameLower = (playingVideo.project_name || '').toLowerCase();
                    const sourceTypeLabel = getSourceTypeLabel(playingVideo.source_type);
                    const showSourceType = sourceTypeLabel &&
                      !projectNameLower.includes('annotated') &&
                      !projectNameLower.includes('brilliant');
                    if (showFilename) {
                      return <p className="text-sm text-gray-400">{playingVideo.filename}</p>;
                    } else if (showSourceType) {
                      return <p className="text-sm text-gray-400">{sourceTypeLabel}</p>;
                    }
                    return null;
                  })()}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  icon={downloadingId === playingVideo.id ? Loader : Download}
                  disabled={downloadingId === playingVideo.id}
                  onClick={() => {
                    console.log('[DownloadsPanel] Modal download:', { id: playingVideo.id, project_name: playingVideo.project_name });
                    downloadFile(playingVideo.id);
                  }}
                  className={downloadingId === playingVideo.id ? '[&_svg]:animate-spin' : ''}
                >
                  {downloadingId === playingVideo.id ? 'Downloading...' : 'Download'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  iconOnly
                  onClick={() => closeVideo()}
                />
              </div>
            </div>

            {/* Video Player */}
            <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
              <MediaPlayer
                src={getStreamingUrl(playingVideo.id, playingVideo)}
                autoPlay
                onClose={() => closeVideo()}
              />
            </div>
          </div>
        </>
      )}
    </>
  );
}

export default DownloadsPanel;
