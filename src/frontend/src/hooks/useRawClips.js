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
   */
  const getRawClipFileUrl = useCallback((clipId) => {
    return `${API_BASE_URL}/clips/raw/${clipId}/file`;
  }, []);

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
