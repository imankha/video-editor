import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Trash2, FolderOpen, Loader, AlertCircle, Video, Play, Image, Columns, Star, Folder, LayoutGrid, Share2, Link2, Pencil, MoreVertical } from 'lucide-react';
import { ShareModal } from './ShareModal';
import { Button } from './shared/Button';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { CollectionsTab } from './collections/CollectionsTab';
import { MediaPlayer } from './MediaPlayer';
import { useDownloads } from '../hooks/useDownloads';
import { useCollections } from '../hooks/useCollections';
import { useWebShare } from '../hooks/useWebShare';
import { useGalleryStore } from '../stores/galleryStore';
import { SourceType, getSourceTypeLabel } from '../constants/sourceTypes';
import { useQuestStore } from '../stores/questStore';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { toast } from './shared/Toast';
import { track } from '../utils/analytics';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { SECTION_NAMES } from '../config/displayNames';
import { REEL } from '../config/themeColors';
import { ratioGlyph, ratioLabel } from '../constants/aspectRatios';

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
  // Header chip count: galleryStore is the source of truth (the full reel list is
  // no longer fetched on open). Badge unchanged (T3610 §0.6).
  const galleryCount = useGalleryStore((state) => state.count);

  // useDownloads supplies the per-reel action helpers + formatters. The full-list
  // fetch is disabled (false) — the single view sources members from
  // useCollections, not this list (T3610 §0B.1). `downloads` stays [].
  const {
    downloads,
    deleteDownload,
    downloadFile,
    downloadingId,
    getDownloadUrl,
    getStreamingUrl,
    renameDownload,
    markWatched,
    formatFileSize,
    formatDuration,
    formatDate,
  } = useDownloads(false);

  // Collections data, lifted here so per-reel mutations can keep the member
  // lists honest (T3610 §0B.6).
  const collections = useCollections(isOpen);

  // State for video preview modal
  const [playingVideo, setPlayingVideo] = useState(null);
  const watchTimerRef = useRef(null);

  // State for inline rename
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState('');

  // State for before/after export
  const [exportingBeforeAfter, setExportingBeforeAfter] = useState(null);

  // State for project restore (T66)
  const [restoringProjectId, setRestoringProjectId] = useState(null);

  // State for share modal
  const [sharingDownload, setSharingDownload] = useState(null);

  // State for overflow menu on reel cards
  const [overflowMenuId, setOverflowMenuId] = useState(null);
  const overflowMenuRef = useRef(null);

  // Native share support
  const { isMobile, copyLink, webShare } = useWebShare();

  useEffect(() => {
    if (!overflowMenuId) return;
    const handleClickOutside = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setOverflowMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [overflowMenuId]);

  if (!isOpen && !playingVideo) return null;

  const handleDelete = async (e, download) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${download.filename}"?`)) {
      await deleteDownload(download.id, true);
      // Keep the collection member lists + aggregates honest (T3610 §0B.6):
      // drop the card now, refetch the summary (counts/eligibility change).
      collections.removeMember(download.id);
      collections.fetchSummary();
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
    setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_DIRECT);
    setPlayingVideo(download);
    close();
    if (!download.watched_at) {
      markWatched(download.id);
      collections.patchMember(download.id, { watched_at: new Date().toISOString() });
    }
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
        const response = await apiFetch(`${API_BASE}/api/downloads/${download.id}/restore-project`, {
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
      const statusRes = await apiFetch(`${API_BASE}/api/export/before-after/${download.id}/status`);
      const status = await statusRes.json();

      if (!status.available) {
        alert(status.error || 'Before/After comparison not available for this video');
        return;
      }

      // Generate separate before/after videos (no text overlays) as a zip
      const response = await apiFetch(`${API_BASE}/api/export/before-after/${download.id}?output=separate&overlays=false`, {
        method: 'POST'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.detail || 'Failed to generate comparison video');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `before_after_${download.project_name || download.id}.zip`;
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
        <div className="flex items-center gap-3">
          {/* Video icon with unwatched dot */}
          <div className={`relative w-10 h-10 rounded flex items-center justify-center flex-shrink-0 ${
            isUnwatched ? 'bg-cyan-900/40' : REEL.bgMuted
          }`}>
            <Video size={20} className={isUnwatched ? 'text-cyan-400' : REEL.accent} />
            {isUnwatched && (
              <span className={`absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full ${style.dot} ring-2 ring-gray-700`} />
            )}
          </div>

          {/* Info + actions */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
            {download.aspect_ratio && (
              <span className={`text-base leading-none ${REEL.accent} shrink-0`} title={ratioLabel(download.aspect_ratio)}>
                {ratioGlyph(download.aspect_ratio)}
              </span>
            )}
            {editingId === download.id ? (
              <input
                autoFocus
                className="w-full bg-gray-600 text-white font-medium px-1 py-0.5 rounded border border-cyan-500 outline-none text-sm"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const trimmed = editingName.trim();
                    if (trimmed && trimmed !== download.project_name) {
                      renameDownload(download.id, trimmed);
                      collections.patchMember(download.id, { project_name: trimmed });
                    }
                    setEditingId(null);
                  } else if (e.key === 'Escape') {
                    setEditingId(null);
                  }
                }}
                onBlur={() => {
                  const trimmed = editingName.trim();
                  if (trimmed && trimmed !== download.project_name) {
                    renameDownload(download.id, trimmed);
                    collections.patchMember(download.id, { project_name: trimmed });
                  }
                  setEditingId(null);
                }}
              />
            ) : (
              <div
                className="text-white font-medium truncate cursor-pointer hover:text-cyan-300 transition-colors"
                onClick={() => { setEditingId(download.id); setEditingName(download.project_name || ''); }}
                title="Click to rename"
              >
                {download.project_name}
              </div>
            )}
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500 min-w-0">
              {(showFilename || showSourceType) && (
                <span className="truncate">{showFilename ? download.filename : sourceTypeLabel}</span>
              )}
              {(showFilename || showSourceType) && <span aria-hidden>·</span>}
              <span className="shrink-0">{formatDate(download.created_at)}</span>
              {formatDuration(download.duration) && <span aria-hidden>·</span>}
              {formatDuration(download.duration) && <span className="shrink-0">{formatDuration(download.duration)}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={(e) => handlePlay(e, download)}
                  className={`min-w-[44px] min-h-[44px] flex items-center justify-center hover:${REEL.bgMuted} rounded-lg transition-colors`}
                  title="Play video"
                >
                  <Play size={20} className={`${REEL.accent} hover:text-cyan-300`} />
                </button>
                {isMobile ? (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        const filename = `${download.project_name || 'highlight'}-highlight.mp4`;
                        const method = await webShare({
                          downloadId: download.id,
                          title: download.project_name || 'Highlight Reel',
                          text: `Check out ${download.project_name || 'this highlight reel'}!`,
                          filename,
                        });
                        track('share_initiated', { method, source: 'gallery' });
                        if (method === 'clipboard') {
                          toast.success('Link copied to clipboard');
                        }
                      } catch (err) {
                        if (err.name === 'AbortError') return;
                        setSharingDownload(download);
                      }
                    }}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-gray-600 rounded-lg transition-colors"
                    title="Share video"
                  >
                    <Share2 size={20} className="text-gray-400 hover:text-cyan-400" />
                  </button>
                ) : (
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await copyLink({ downloadId: download.id });
                        track('share_initiated', { method: 'clipboard', source: 'gallery' });
                        toast.success('Link copied to clipboard');
                      } catch (err) {
                        if (err.name === 'AbortError') return;
                        setSharingDownload(download);
                      }
                    }}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-gray-600 rounded-lg transition-colors"
                    title="Copy link"
                  >
                    <Link2 size={20} className="text-gray-400 hover:text-cyan-400" />
                  </button>
                )}
                {/* Overflow menu */}
                <div className="relative" ref={overflowMenuId === download.id ? overflowMenuRef : undefined}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setOverflowMenuId(overflowMenuId === download.id ? null : download.id);
                    }}
                    className="min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-gray-600 rounded-lg transition-colors"
                    title="More actions"
                  >
                    <MoreVertical size={20} className="text-gray-400" />
                  </button>
                  {overflowMenuId === download.id && (
                    <div className="absolute right-0 bottom-full mb-1 bg-gray-700 border border-gray-600 rounded-lg shadow-xl z-50 min-w-[180px] py-1">
                      <button
                        onClick={(e) => { handleDownload(e, download); setOverflowMenuId(null); }}
                        disabled={downloadingId === download.id}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors disabled:opacity-50"
                      >
                        {downloadingId === download.id ? (
                          <Loader size={18} className="text-gray-400 animate-spin flex-shrink-0" />
                        ) : (
                          <Download size={18} className="text-gray-300 flex-shrink-0" />
                        )}
                        <span className="text-gray-200">Download</span>
                      </button>
                      {isMobile ? (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setOverflowMenuId(null);
                            try {
                              await copyLink({ downloadId: download.id });
                              track('share_initiated', { method: 'clipboard', source: 'gallery' });
                              toast.success('Link copied to clipboard');
                            } catch (err) {
                              if (err.name === 'AbortError') return;
                              setSharingDownload(download);
                            }
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors"
                        >
                          <Link2 size={18} className="text-gray-300 flex-shrink-0" />
                          <span className="text-gray-200">Copy Link</span>
                        </button>
                      ) : (
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            setOverflowMenuId(null);
                            try {
                              const filename = `${download.project_name || 'highlight'}-highlight.mp4`;
                              const method = await webShare({
                                downloadId: download.id,
                                title: download.project_name || 'Highlight Reel',
                                text: `Check out ${download.project_name || 'this highlight reel'}!`,
                                filename,
                              });
                              track('share_initiated', { method, source: 'gallery' });
                              if (method === 'clipboard') {
                                toast.success('Link copied to clipboard');
                              }
                            } catch (err) {
                              if (err.name === 'AbortError') return;
                              setSharingDownload(download);
                            }
                          }}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors"
                        >
                          <Share2 size={18} className="text-gray-300 flex-shrink-0" />
                          <span className="text-gray-200">Share</span>
                        </button>
                      )}
                      {!import.meta.env.PROD && (
                        <button
                          onClick={(e) => { handleBeforeAfter(e, download); setOverflowMenuId(null); }}
                          disabled={exportingBeforeAfter === download.id}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors disabled:opacity-50"
                        >
                          {exportingBeforeAfter === download.id ? (
                            <Loader size={18} className="text-blue-400 animate-spin flex-shrink-0" />
                          ) : (
                            <Columns size={18} className="text-blue-400 flex-shrink-0" />
                          )}
                          <span className="text-gray-200">Before / After</span>
                        </button>
                      )}
                      {canOpenSource(download) && (
                        <button
                          onClick={(e) => { handleOpenProject(e, download); setOverflowMenuId(null); }}
                          disabled={restoringProjectId === download.id}
                          className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-gray-600 transition-colors disabled:opacity-50"
                        >
                          {restoringProjectId === download.id ? (
                            <Loader size={18} className="text-gray-300 animate-spin flex-shrink-0" />
                          ) : (
                            <FolderOpen size={18} className="text-gray-300 flex-shrink-0" />
                          )}
                          <span className="text-gray-200">Open as Draft</span>
                        </button>
                      )}
                      <button
                        onClick={(e) => { handleDelete(e, download); setOverflowMenuId(null); }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-left hover:bg-red-900/40 transition-colors"
                      >
                        <Trash2 size={18} className="text-red-400 flex-shrink-0" />
                        <span className="text-red-400">Delete</span>
                      </button>
                    </div>
                  )}
                </div>
          </div>
        </div>
    </div>
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
            {galleryCount > 0 && (
              <span className={`px-2 py-0.5 ${REEL.bg} text-white text-xs font-medium rounded-full`}>
                {galleryCount}
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

        {/* Content — single My Reels view (T3610 §0B.1) */}
        <div className="flex-1 overflow-y-auto p-4">
          <CollectionsTab collections={collections} renderCard={renderDownloadCard} />
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

      {/* Share Modal */}
      {sharingDownload && (
        <ShareModal
          videoId={sharingDownload.id}
          videoName={sharingDownload.project_name}
          onClose={() => setSharingDownload(null)}
        />
      )}

      {/* Video Preview Modal */}
      {playingVideo && (
        <>
          {/* Modal Backdrop */}
          <div
            className="fixed inset-0 bg-black z-[60]"
            onClick={() => closeVideo()}
          />

          {/* Modal Content */}
          <div className="fixed inset-0 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-black overflow-hidden md:rounded-xl md:bg-gray-900 md:shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-3 py-2 md:p-4 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-2 md:gap-3 min-w-0">
                <Video size={18} className={`${REEL.accent} shrink-0`} />
                <div className="min-w-0">
                  <h3 className="text-white text-sm md:text-base font-medium truncate">{playingVideo.project_name}</h3>
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
