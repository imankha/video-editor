/**
 * useGameUpload Hook
 *
 * React hook for uploading games with deduplication support.
 * Wraps the uploadManager service with React state management.
 *
 * Features:
 * - Progress tracking (phase, percent, message)
 * - Deduplication (same file = instant link, no re-upload)
 * - 4GB+ file support via multipart upload
 * - Error handling
 */

import { useState, useCallback, useRef } from 'react';
import {
  uploadGame,
  cancelUpload,
  listDedupeGames,
  deleteDedupeGame,
  getDedupeGameUrl,
  listPendingUploads,
  UPLOAD_PHASE,
} from '../services/uploadManager';
import { useGamesStore } from '../stores';

export { UPLOAD_PHASE };

export function useGameUpload() {
  // Upload state
  const [phase, setPhase] = useState(UPLOAD_PHASE.IDLE);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  // Deduplicated games list
  const [dedupeGames, setDedupeGames] = useState([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);

  // Pending uploads (for resume)
  const [pendingUploads, setPendingUploads] = useState([]);

  // Upload session for cancellation
  const uploadSessionRef = useRef(null);

  // Global games invalidation for cross-component coordination
  const invalidateGames = useGamesStore((state) => state.invalidateGames);

  /**
   * Upload a game file with deduplication
   * @param {File} file - Video file to upload
   * @returns {Promise<Object>} - Upload result
   */
  const upload = useCallback(
    async (file) => {
      setPhase(UPLOAD_PHASE.IDLE);
      setPercent(0);
      setMessage('');
      setError(null);
      setResult(null);

      try {
        const uploadResult = await uploadGame(file, (progress) => {
          setPhase(progress.phase);
          setPercent(progress.percent);
          setMessage(progress.message);
        });

        setResult(uploadResult);

        // Notify other components that games list changed
        invalidateGames();

        return uploadResult;
      } catch (err) {
        setError(err.message);
        setPhase(UPLOAD_PHASE.ERROR);
        throw err;
      }
    },
    [invalidateGames]
  );

  /**
   * Cancel the current upload
   */
  const cancel = useCallback(async () => {
    if (uploadSessionRef.current) {
      try {
        await cancelUpload(uploadSessionRef.current);
        uploadSessionRef.current = null;
        setPhase(UPLOAD_PHASE.IDLE);
        setPercent(0);
        setMessage('Upload cancelled');
      } catch (err) {
        setError(err.message);
      }
    }
  }, []);

  /**
   * Reset upload state
   */
  const reset = useCallback(() => {
    setPhase(UPLOAD_PHASE.IDLE);
    setPercent(0);
    setMessage('');
    setError(null);
    setResult(null);
    uploadSessionRef.current = null;
  }, []);

  /**
   * Fetch deduplicated games list
   */
  const fetchDedupeGames = useCallback(async () => {
    setIsLoadingGames(true);
    try {
      const games = await listDedupeGames();
      setDedupeGames(games);
      return games;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setIsLoadingGames(false);
    }
  }, []);

  /**
   * Fetch pending uploads (for resume support)
   */
  const fetchPendingUploads = useCallback(async () => {
    try {
      const uploads = await listPendingUploads();
      setPendingUploads(uploads);
      return uploads;
    } catch (err) {
      // Non-fatal - just means we can't show resumable uploads
      console.warn('Failed to fetch pending uploads:', err);
      return [];
    }
  }, []);

  /**
   * Delete a deduplicated game
   * @param {number} gameId - Game ID
   */
  const deleteGame = useCallback(
    async (gameId) => {
      try {
        await deleteDedupeGame(gameId);
        setDedupeGames((prev) => prev.filter((g) => g.id !== gameId));
        invalidateGames();
        return true;
      } catch (err) {
        setError(err.message);
        return false;
      }
    },
    [invalidateGames]
  );

  /**
   * Get video URL for a deduplicated game
   * @param {number} gameId - Game ID
   * @returns {Promise<string>} - Presigned URL
   */
  const getGameUrl = useCallback(async (gameId) => {
    try {
      return await getDedupeGameUrl(gameId);
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  // Computed state
  const isUploading =
    phase === UPLOAD_PHASE.HASHING ||
    phase === UPLOAD_PHASE.PREPARING ||
    phase === UPLOAD_PHASE.UPLOADING ||
    phase === UPLOAD_PHASE.FINALIZING;

  const isComplete = phase === UPLOAD_PHASE.COMPLETE;
  const hasError = phase === UPLOAD_PHASE.ERROR;
  const wasDeduplicated = result?.deduplicated === true;

  return {
    // Upload state
    phase,
    percent,
    message,
    error,
    result,
    isUploading,
    isComplete,
    hasError,
    wasDeduplicated,

    // Dedupe games
    dedupeGames,
    isLoadingGames,

    // Pending uploads (resume support)
    pendingUploads,

    // Actions
    upload,
    cancel,
    reset,
    fetchDedupeGames,
    fetchPendingUploads,
    deleteGame,
    getGameUrl,
  };
}

export default useGameUpload;
