/**
 * useStorageUrl Hook
 *
 * React hook for getting the best URL for accessing files from storage.
 * Handles async presigned URL fetching and provides reactive updates.
 *
 * Usage:
 *   const { url, isLoading } = useStorageUrl('games', 'abc123.mp4', '/api/games/1/video');
 *
 * When R2 is enabled, returns presigned URL for direct R2 access.
 * When R2 is disabled, returns the local fallback URL.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFileUrl, checkStorageStatus, prefetchUrls } from '../utils/storageUrls';

/**
 * Hook to get a single file URL
 *
 * @param {string} fileType - Type of file (games, raw_clips, working_videos, etc.)
 * @param {string} filename - Filename within that directory
 * @param {string} localFallbackUrl - URL to use initially and if R2 fails
 * @param {Object} options - Optional configuration
 * @param {boolean} options.enabled - Whether to fetch (default true)
 * @param {number} options.expiresIn - URL expiration in seconds (default 3600)
 * @returns {{ url: string, isLoading: boolean, isR2: boolean }}
 */
export function useStorageUrl(fileType, filename, localFallbackUrl, options = {}) {
  const { enabled = true, expiresIn = 3600 } = options;

  // Start with local fallback URL for immediate rendering
  const [url, setUrl] = useState(localFallbackUrl);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isR2, setIsR2] = useState(false);

  // Track current request to avoid stale updates
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !fileType || !filename) {
      setUrl(localFallbackUrl);
      setIsLoading(false);
      setIsR2(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setIsLoading(true);

    (async () => {
      try {
        const presignedUrl = await getFileUrl(fileType, filename, localFallbackUrl, expiresIn);

        // Only update if this is still the current request
        if (requestId === requestIdRef.current) {
          setUrl(presignedUrl);
          setIsR2(presignedUrl !== localFallbackUrl);
          setIsLoading(false);
        }
      } catch (err) {
        if (requestId === requestIdRef.current) {
          console.warn('[useStorageUrl] Error getting URL, using fallback:', err);
          setUrl(localFallbackUrl);
          setIsR2(false);
          setIsLoading(false);
        }
      }
    })();
  }, [fileType, filename, localFallbackUrl, enabled, expiresIn]);

  return { url, isLoading, isR2 };
}

/**
 * Hook to get multiple file URLs at once
 * More efficient than multiple useStorageUrl calls as it uses batch endpoint
 *
 * @param {Array<{fileType: string, filename: string, localUrl: string, key?: string}>} files
 * @param {Object} options
 * @returns {{ urls: Object<string, string>, isLoading: boolean }}
 */
export function useStorageUrls(files, options = {}) {
  const { enabled = true, expiresIn = 3600 } = options;

  // Map of key -> url (key defaults to fileType/filename)
  const [urls, setUrls] = useState(() => {
    const initial = {};
    files.forEach(({ fileType, filename, localUrl, key }) => {
      const k = key || `${fileType}/${filename}`;
      initial[k] = localUrl;
    });
    return initial;
  });
  const [isLoading, setIsLoading] = useState(enabled && files.length > 0);

  const filesRef = useRef(files);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    if (!enabled || files.length === 0) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    (async () => {
      try {
        // Check storage status first
        const status = await checkStorageStatus();

        if (!status.r2_enabled) {
          // Just use local URLs
          const localUrls = {};
          filesRef.current.forEach(({ fileType, filename, localUrl, key }) => {
            const k = key || `${fileType}/${filename}`;
            localUrls[k] = localUrl;
          });
          setUrls(localUrls);
          setIsLoading(false);
          return;
        }

        // Prefetch all URLs
        await prefetchUrls(
          filesRef.current.map(({ fileType, filename }) => ({ fileType, filename })),
          expiresIn
        );

        // Now get each URL (should hit cache)
        const newUrls = {};
        await Promise.all(
          filesRef.current.map(async ({ fileType, filename, localUrl, key }) => {
            const k = key || `${fileType}/${filename}`;
            const presignedUrl = await getFileUrl(fileType, filename, localUrl, expiresIn);
            newUrls[k] = presignedUrl;
          })
        );

        setUrls(newUrls);
        setIsLoading(false);
      } catch (err) {
        console.warn('[useStorageUrls] Error getting URLs:', err);
        setIsLoading(false);
      }
    })();
  }, [enabled, expiresIn, JSON.stringify(files.map(f => `${f.fileType}/${f.filename}`))]);

  return { urls, isLoading };
}

/**
 * Hook that returns helper functions for getting URLs imperatively
 * Use this when you need to get URLs on-demand rather than declaratively
 *
 * @returns {{ getUrl: Function, prefetch: Function, isR2Enabled: boolean | null }}
 */
export function useStorageUrlHelpers() {
  const [isR2Enabled, setIsR2Enabled] = useState(null);

  useEffect(() => {
    checkStorageStatus().then(status => {
      setIsR2Enabled(status.r2_enabled);
    });
  }, []);

  const getUrl = useCallback(async (fileType, filename, localFallbackUrl, expiresIn = 3600) => {
    return getFileUrl(fileType, filename, localFallbackUrl, expiresIn);
  }, []);

  const prefetch = useCallback(async (files, expiresIn = 3600) => {
    return prefetchUrls(files, expiresIn);
  }, []);

  return { getUrl, prefetch, isR2Enabled };
}

export default useStorageUrl;
