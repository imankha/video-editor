import React, { useState } from 'react';
import { X, Download, Trash2, FolderOpen, Loader, AlertCircle, Video, Play, Image } from 'lucide-react';
import { useDownloads } from '../hooks/useDownloads';

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
  isOpen,
  onClose,
  onOpenProject,  // (projectId) => void - Navigate to project
  onCountChange   // () => void - Callback when count changes (for refreshing header badge)
}) {
  const {
    downloads,
    loadState,
    error,
    hasDownloads,
    groupedDownloads,
    deleteDownload,
    downloadFile,
    getDownloadUrl,
    formatFileSize,
    formatDate
  } = useDownloads(isOpen);

  // State for video preview modal
  const [playingVideo, setPlayingVideo] = useState(null);

  if (!isOpen) return null;

  const groups = groupedDownloads();

  const handleDelete = async (e, download) => {
    e.stopPropagation();
    if (window.confirm(`Delete "${download.filename}"?`)) {
      const success = await deleteDownload(download.id, true);
      if (success && onCountChange) {
        // Notify parent to refresh the badge count
        onCountChange();
      }
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
    if (onOpenProject) {
      onOpenProject(download.project_id);
      onClose();
    }
  };

  const renderGroup = (title, items) => {
    if (items.length === 0) return null;

    return (
      <div key={title} className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 mb-2 px-1">{title}</h3>
        <div className="space-y-2">
          {items.map(download => (
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
                  {onOpenProject && (
                    <button
                      onClick={(e) => handleOpenProject(e, download)}
                      className="p-2 hover:bg-gray-600 rounded transition-colors"
                      title="Open project"
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
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Retry
          </button>
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
        onClick={onClose}
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
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
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
                <button
                  onClick={() => {
                    console.log('[DownloadsPanel] Modal download:', { id: playingVideo.id, project_name: playingVideo.project_name });
                    downloadFile(playingVideo.id);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
                >
                  <Download size={16} />
                  Download
                </button>
                <button
                  onClick={() => setPlayingVideo(null)}
                  className="p-1.5 hover:bg-gray-700 rounded transition-colors"
                >
                  <X size={20} className="text-gray-400" />
                </button>
              </div>
            </div>

            {/* Video Player */}
            <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
              <video
                src={getDownloadUrl(playingVideo.id)}
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
