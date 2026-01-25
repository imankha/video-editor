import { useState, useCallback, useEffect } from 'react';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * useRawClips - Manages the raw clips library
 *
 * Raw clips are created by exporting from Annotate mode.
 * They can be added to any project.
 */
export function useRawClips() {
  const [rawClips, setRawClips] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Fetch all raw clips
   */
  const fetchRawClips = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/clips/raw`);
      if (!response.ok) throw new Error('Failed to fetch raw clips');
      const data = await response.json();
      setRawClips(data);
      return data;
    } catch (err) {
      setError(err.message);
      console.error('[useRawClips] fetchRawClips error:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Get URL for a raw clip file
   * Uses presigned R2 URL if available (from clip.file_url), otherwise falls back to local proxy
   * @param {number} clipId - Clip ID
   * @param {Object} clip - Optional clip object that may contain file_url from API
   */
  const getRawClipFileUrl = useCallback((clipId, clip = null) => {
    // If clip object has presigned URL, use it (direct R2 access)
    if (clip?.file_url) {
      return clip.file_url;
    }
    // Find clip in rawClips array if not provided
    const foundClip = clip || rawClips.find(c => c.id === clipId);
    if (foundClip?.file_url) {
      return foundClip.file_url;
    }
    // Fallback to local proxy endpoint
    return `${API_BASE_URL}/clips/raw/${clipId}/file`;
  }, [rawClips]);

  // Fetch on mount
  useEffect(() => {
    fetchRawClips();
  }, [fetchRawClips]);

  return {
    rawClips,
    loading,
    error,
    hasRawClips: rawClips.length > 0,
    fetchRawClips,
    getRawClipFileUrl
  };
}

export default useRawClips;
