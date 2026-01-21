import { useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * useDownloads - Manages downloads panel state and API interactions
 *
 * Race-safe implementation:
 * - Uses AbortController to cancel stale requests
 * - Tracks loading state machine ('idle' | 'loading' | 'ready' | 'error')
 * - Guards against state updates from cancelled requests
 *
 * Provides:
 * - downloads: List of all final videos
 * - loadState: Current loading state
 * - count: Quick count for header badge
 * - filter: Current source_type filter
 * - Actions: fetchDownloads, deleteDownload, downloadFile, setFilter
 */
export function useDownloads(isOpen = false) {
  const [downloads, setDownloads] = useState([]);
  const [loadState, setLoadState] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'error'
  const [count, setCount] = useState(0);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState(null); // null | 'brilliant_clip' | 'custom_project' | 'annotated_game'

  // AbortController ref for cancelling requests
  const abortControllerRef = useRef(null);

  /**
   * Fetch all downloads from the API
   * Race-safe: cancels previous request if still pending
   * @param {string|null} sourceType - Filter by source type
   */
  const fetchDownloads = useCallback(async (sourceType = null) => {
    // Cancel any pending request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    // Create new abort controller
    abortControllerRef.current = new AbortController();
    const currentController = abortControllerRef.current;

    setLoadState('loading');
    setError(null);

    try {
      // Build URL with optional filter
      let url = `${API_BASE_URL}/downloads`;
      if (sourceType) {
        url += `?source_type=${encodeURIComponent(sourceType)}`;
      }

      const response = await fetch(url, {
        signal: currentController.signal
      });

      if (!response.ok) throw new Error('Failed to fetch downloads');
      const data = await response.json();

      // Guard: Don't update if request was cancelled
      if (!currentController.signal.aborted) {
        console.log('[useDownloads] Fetched downloads:', data.downloads?.length, 'first download file_url:', data.downloads?.[0]?.file_url);
        setDownloads(data.downloads || []);
        setCount(data.total_count || 0);
        setLoadState('ready');
      }

      return data.downloads || [];
    } catch (err) {
      // Don't update state if aborted
      if (err.name === 'AbortError') {
        return [];
      }

      setError(err.message);
      setLoadState('error');
      console.error('[useDownloads] fetchDownloads error:', err);
      return [];
    }
  }, []);

  /**
   * Fetch just the count (for header badge)
   * Lightweight - doesn't require full data
   */
  const fetchCount = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/downloads/count`);
      if (!response.ok) throw new Error('Failed to fetch count');
      const data = await response.json();
      setCount(data.count || 0);
      return data.count || 0;
    } catch (err) {
      console.error('[useDownloads] fetchCount error:', err);
      return 0;
    }
  }, []);

  /**
   * Delete a download
   */
  const deleteDownload = useCallback(async (downloadId, removeFile = false) => {
    try {
      const response = await fetch(
        `${API_BASE_URL}/downloads/${downloadId}?remove_file=${removeFile}`,
        { method: 'DELETE' }
      );

      if (!response.ok) throw new Error('Failed to delete download');

      // Update local state optimistically
      setDownloads(prev => prev.filter(d => d.id !== downloadId));
      setCount(prev => Math.max(0, prev - 1));

      return true;
    } catch (err) {
      setError(err.message);
      console.error('[useDownloads] deleteDownload error:', err);
      return false;
    }
  }, []);

  /**
   * Get download URL for a file
   * Uses presigned R2 URL if available (from download.file_url), otherwise falls back to local proxy
   * @param {number} downloadId - Download ID
   * @param {Object} download - Optional download object that may contain file_url from API
   */
  const getDownloadUrl = useCallback((downloadId, download = null) => {
    console.log('[useDownloads] getDownloadUrl called:', { downloadId, download_file_url: download?.file_url });
    // If download object has presigned URL, use it (direct R2 access)
    if (download?.file_url) {
      console.log('[useDownloads] Using presigned R2 URL:', download.file_url);
      return download.file_url;
    }
    // Find download in downloads array if not provided
    const foundDownload = download || downloads.find(d => d.id === downloadId);
    if (foundDownload?.file_url) {
      console.log('[useDownloads] Using found presigned R2 URL:', foundDownload.file_url);
      return foundDownload.file_url;
    }
    // Fallback to local proxy endpoint
    const fallbackUrl = `${API_BASE_URL}/downloads/${downloadId}/file`;
    console.log('[useDownloads] Using fallback local proxy URL:', fallbackUrl);
    return fallbackUrl;
  }, [downloads]);

  /**
   * Trigger file download in browser
   * Note: Filename is controlled by backend's Content-Disposition header (single source of truth)
   */
  const downloadFile = useCallback((downloadId) => {
    const url = getDownloadUrl(downloadId);
    console.log('[useDownloads] downloadFile called:', { downloadId, url });

    // Create a temporary link and trigger download
    // Don't set link.download - let the server's Content-Disposition header control the filename
    const link = document.createElement('a');
    link.href = url;
    document.body.appendChild(link);
    console.log('[useDownloads] Triggering download click');
    link.click();
    document.body.removeChild(link);
  }, [getDownloadUrl]);

  /**
   * Format file size for display
   */
  const formatFileSize = useCallback((bytes) => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }, []);

  /**
   * Format date for display
   */
  const formatDate = useCallback((dateString) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString();
  }, []);

  /**
   * Group downloads by date
   */
  const groupedDownloads = useCallback(() => {
    const groups = {
      today: [],
      yesterday: [],
      lastWeek: [],
      older: []
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    downloads.forEach(download => {
      const downloadDate = new Date(download.created_at);

      if (downloadDate >= today) {
        groups.today.push(download);
      } else if (downloadDate >= yesterday) {
        groups.yesterday.push(download);
      } else if (downloadDate >= weekAgo) {
        groups.lastWeek.push(download);
      } else {
        groups.older.push(download);
      }
    });

    return groups;
  }, [downloads]);

  // Fetch downloads when panel opens or filter changes
  useEffect(() => {
    if (isOpen) {
      fetchDownloads(filter);
    }

    // Cleanup: abort pending request on unmount or close
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isOpen, filter, fetchDownloads]);

  // Fetch count on mount (for badge)
  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  return {
    // State
    downloads,
    loadState,
    count,
    error,
    filter,
    hasDownloads: downloads.length > 0,

    // Computed
    groupedDownloads,

    // Actions
    fetchDownloads,
    fetchCount,
    deleteDownload,
    downloadFile,
    getDownloadUrl,
    setFilter,

    // Utilities
    formatFileSize,
    formatDate
  };
}

export default useDownloads;
