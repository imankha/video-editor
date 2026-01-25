/**
 * Storage URL Utilities
 *
 * Provides functions for getting the best URL for accessing files:
 * - When R2 is enabled: Returns presigned URLs for direct R2 access
 * - When R2 is disabled: Returns local API URLs
 *
 * Presigned URLs are cached to avoid unnecessary API calls.
 * Cache entries expire 5 minutes before the actual URL expires
 * to ensure URLs are still valid when used.
 */

import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;
const STORAGE_BASE_URL = `${API_BASE}/storage`;

// Cache for presigned URLs
// Structure: { [cacheKey]: { url, expiresAt } }
const urlCache = new Map();

// Default URL expiration (1 hour)
const DEFAULT_EXPIRES_IN = 3600;

// How much earlier to refresh before actual expiration (5 minutes)
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// Storage status cache
let storageStatus = null;
let storageStatusPromise = null;

/**
 * Check if R2 storage is enabled
 * Caches the result for the session
 */
export async function checkStorageStatus() {
  if (storageStatus !== null) {
    return storageStatus;
  }

  // Prevent duplicate requests
  if (storageStatusPromise) {
    return storageStatusPromise;
  }

  storageStatusPromise = (async () => {
    try {
      const response = await fetch(`${STORAGE_BASE_URL}/status`);
      if (!response.ok) {
        console.warn('[storageUrls] Failed to check storage status, assuming local mode');
        storageStatus = { r2_enabled: false, mode: 'local' };
        return storageStatus;
      }
      storageStatus = await response.json();
      console.log('[storageUrls] Storage status:', storageStatus);
      return storageStatus;
    } catch (err) {
      console.warn('[storageUrls] Error checking storage status:', err);
      storageStatus = { r2_enabled: false, mode: 'local' };
      return storageStatus;
    } finally {
      storageStatusPromise = null;
    }
  })();

  return storageStatusPromise;
}

/**
 * Get a cache key for a file
 */
function getCacheKey(fileType, filename) {
  return `${fileType}/${filename}`;
}

/**
 * Check if a cached URL is still valid
 */
function isCacheValid(cacheEntry) {
  if (!cacheEntry) return false;
  return Date.now() < cacheEntry.expiresAt;
}

/**
 * Fetch a presigned URL from the backend
 */
async function fetchPresignedUrl(fileType, filename, expiresIn = DEFAULT_EXPIRES_IN) {
  try {
    const response = await fetch(
      `${STORAGE_BASE_URL}/url/${fileType}/${encodeURIComponent(filename)}?expires_in=${expiresIn}`
    );

    if (!response.ok) {
      console.warn(`[storageUrls] Failed to get presigned URL for ${fileType}/${filename}`);
      return null;
    }

    const data = await response.json();
    return {
      url: data.url,
      expiresIn: data.expires_in
    };
  } catch (err) {
    console.error('[storageUrls] Error fetching presigned URL:', err);
    return null;
  }
}

/**
 * Get the best URL for accessing a file
 *
 * @param {string} fileType - Type of file (games, raw_clips, working_videos, final_videos, highlights, downloads)
 * @param {string} filename - Filename within that directory
 * @param {string} localFallbackUrl - URL to use if R2 is disabled or presigned URL fails
 * @param {number} expiresIn - URL expiration time in seconds (default 1 hour)
 * @returns {Promise<string>} The best URL to use
 */
export async function getFileUrl(fileType, filename, localFallbackUrl, expiresIn = DEFAULT_EXPIRES_IN) {
  // Check if R2 is enabled
  const status = await checkStorageStatus();

  if (!status.r2_enabled) {
    return localFallbackUrl;
  }

  const cacheKey = getCacheKey(fileType, filename);

  // Check cache
  const cached = urlCache.get(cacheKey);
  if (isCacheValid(cached)) {
    return cached.url;
  }

  // Fetch new presigned URL
  const result = await fetchPresignedUrl(fileType, filename, expiresIn);

  if (!result) {
    console.warn(`[storageUrls] Falling back to local URL for ${fileType}/${filename}`);
    return localFallbackUrl;
  }

  // Cache the URL with expiration (subtract buffer to refresh early)
  const expiresAt = Date.now() + (result.expiresIn * 1000) - EXPIRY_BUFFER_MS;
  urlCache.set(cacheKey, {
    url: result.url,
    expiresAt
  });

  return result.url;
}

/**
 * Synchronous version that returns cached URL or local fallback
 * Use this when you can't await (e.g., in render)
 *
 * Note: This will return local URL on first call, then presigned URL
 * after cache is populated. For video sources, prefer using async version
 * and updating src when URL is ready.
 *
 * @param {string} fileType - Type of file
 * @param {string} filename - Filename
 * @param {string} localFallbackUrl - URL to use if not cached
 * @returns {string} Cached presigned URL or local fallback
 */
export function getFileUrlSync(fileType, filename, localFallbackUrl) {
  // If R2 is known to be disabled, return local
  if (storageStatus && !storageStatus.r2_enabled) {
    return localFallbackUrl;
  }

  const cacheKey = getCacheKey(fileType, filename);
  const cached = urlCache.get(cacheKey);

  if (isCacheValid(cached)) {
    return cached.url;
  }

  return localFallbackUrl;
}

/**
 * Prefetch presigned URLs for multiple files
 * Useful for loading a list view where you know what files you'll need
 *
 * @param {Array<{fileType: string, filename: string}>} files - Array of file info
 * @param {number} expiresIn - URL expiration time in seconds
 */
export async function prefetchUrls(files, expiresIn = DEFAULT_EXPIRES_IN) {
  const status = await checkStorageStatus();

  if (!status.r2_enabled) {
    return; // Nothing to prefetch
  }

  // Filter out already cached files
  const needsFetch = files.filter(({ fileType, filename }) => {
    const cacheKey = getCacheKey(fileType, filename);
    return !isCacheValid(urlCache.get(cacheKey));
  });

  if (needsFetch.length === 0) {
    return;
  }

  // Use batch endpoint for efficiency
  try {
    const paths = needsFetch.map(({ fileType, filename }) => `${fileType}/${filename}`);

    const response = await fetch(`${STORAGE_BASE_URL}/urls/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paths,
        expires_in: expiresIn
      })
    });

    if (!response.ok) {
      console.warn('[storageUrls] Failed to batch fetch presigned URLs');
      return;
    }

    const data = await response.json();
    const expiresAt = Date.now() + (expiresIn * 1000) - EXPIRY_BUFFER_MS;

    // Cache all returned URLs
    for (const [path, url] of Object.entries(data.urls)) {
      urlCache.set(path, { url, expiresAt });
    }

    console.log(`[storageUrls] Prefetched ${Object.keys(data.urls).length} presigned URLs`);
  } catch (err) {
    console.error('[storageUrls] Error batch fetching presigned URLs:', err);
  }
}

/**
 * Clear the URL cache
 * Useful when user context changes
 */
export function clearUrlCache() {
  urlCache.clear();
  storageStatus = null;
  console.log('[storageUrls] URL cache cleared');
}

/**
 * Helper: Get game video URL (maps to games/{id}.mp4)
 */
export async function getGameVideoUrl(gameId, localFallbackUrl) {
  // Game videos are stored as games/{uuid}.mp4
  // The gameId from DB should match the filename
  return getFileUrl('games', `${gameId}.mp4`, localFallbackUrl);
}

/**
 * Helper: Get raw clip URL (maps to raw_clips/{filename})
 */
export async function getRawClipUrl(filename, localFallbackUrl) {
  return getFileUrl('raw_clips', filename, localFallbackUrl);
}

/**
 * Helper: Get working video URL (maps to working_videos/{filename})
 */
export async function getWorkingVideoUrl(filename, localFallbackUrl) {
  return getFileUrl('working_videos', filename, localFallbackUrl);
}

/**
 * Helper: Get download/final video URL (maps to downloads/{filename})
 */
export async function getDownloadFileUrl(filename, localFallbackUrl) {
  return getFileUrl('downloads', filename, localFallbackUrl);
}

/**
 * Helper: Get highlight image URL (maps to highlights/{filename})
 */
export async function getHighlightImageUrl(filename, localFallbackUrl) {
  return getFileUrl('highlights', filename, localFallbackUrl);
}
