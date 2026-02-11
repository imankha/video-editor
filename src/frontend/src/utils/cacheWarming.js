/**
 * R2 Cache Warming Utility
 *
 * Cloudflare R2 can have slow first-byte times when content isn't cached at the edge.
 * This utility pre-warms the cache by making small range requests to video URLs,
 * ensuring faster load times when users actually open videos.
 *
 * T55: Addresses slow video loading (60+ seconds) on cold cache.
 *
 * Features:
 * - Priority queue system: games vs gallery
 * - Dynamic priority switching based on user navigation
 * - Concurrent workers pull from priority queue first
 *
 * Usage:
 * - Call warmAllUserVideos() on app init/user login
 * - Call setWarmupPriority('gallery') when gallery is opened
 * - Call setWarmupPriority('games') when games/annotate is accessed
 */

import { API_BASE } from '../config';

// Priority constants
export const WARMUP_PRIORITY = Object.freeze({
  GAMES: 'games',
  GALLERY: 'gallery',
});

// Track URLs that have been warmed this session
const warmedUrls = new Set();

// Priority queues
let gamesQueue = [];
let galleryQueue = [];
let workingQueue = [];

// Current priority
let currentPriority = WARMUP_PRIORITY.GAMES;

// Track if warmup workers are running
let workersRunning = false;
let warmupInProgress = false;

// Concurrency settings
const CONCURRENCY = 5;

/**
 * Set the warmup priority. Call this when user navigates.
 * @param {'games' | 'gallery'} priority
 */
export function setWarmupPriority(priority) {
  if (priority !== currentPriority) {
    console.log(`[CacheWarming] Priority changed to: ${priority}`);
    currentPriority = priority;
  }
}

/**
 * Get the next URL to warm based on current priority.
 * Returns null if all queues are empty.
 */
function getNextUrl() {
  // Priority queue first
  const priorityQueue = currentPriority === WARMUP_PRIORITY.GAMES ? gamesQueue : galleryQueue;
  const secondaryQueue = currentPriority === WARMUP_PRIORITY.GAMES ? galleryQueue : gamesQueue;

  // Try priority queue
  while (priorityQueue.length > 0) {
    const url = priorityQueue.shift();
    if (url && !warmedUrls.has(url)) {
      return url;
    }
  }

  // Try secondary queue
  while (secondaryQueue.length > 0) {
    const url = secondaryQueue.shift();
    if (url && !warmedUrls.has(url)) {
      return url;
    }
  }

  // Try working queue last
  while (workingQueue.length > 0) {
    const url = workingQueue.shift();
    if (url && !warmedUrls.has(url)) {
      return url;
    }
  }

  return null;
}

/**
 * Warm a single video URL.
 */
async function warmUrl(url) {
  if (!url || url.startsWith('blob:') || warmedUrls.has(url)) {
    return false;
  }

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-1023' },
      mode: 'cors',
      credentials: 'omit',
    });

    if (response.ok || response.status === 206) {
      warmedUrls.add(url);
      return true;
    }
    return false;
  } catch (err) {
    // CORS errors still warm the cache
    warmedUrls.add(url);
    return true;
  }
}

/**
 * Worker function that continuously pulls from queues.
 */
async function worker(workerId) {
  let warmed = 0;

  while (true) {
    const url = getNextUrl();
    if (!url) break;

    const success = await warmUrl(url);
    if (success) warmed++;
  }

  return warmed;
}

/**
 * Start concurrent workers to process the queues.
 */
async function runWorkers() {
  if (workersRunning) return;
  workersRunning = true;

  const totalBefore = gamesQueue.length + galleryQueue.length + workingQueue.length;
  if (totalBefore === 0) {
    workersRunning = false;
    return;
  }

  console.log(`[CacheWarming] Starting ${CONCURRENCY} workers for ${totalBefore} videos (priority: ${currentPriority})`);

  // Start concurrent workers
  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }

  const results = await Promise.all(workers);
  const totalWarmed = results.reduce((a, b) => a + b, 0);

  console.log(`[CacheWarming] Complete: ${totalWarmed} videos warmed`);
  workersRunning = false;
}

/**
 * Clear the warmed URLs cache.
 */
export function clearWarmingCache() {
  warmedUrls.clear();
  gamesQueue = [];
  galleryQueue = [];
  workingQueue = [];
}

/**
 * Warm all videos for the current user.
 * Fetches URLs from backend and starts priority-based warming.
 */
export async function warmAllUserVideos() {
  if (warmupInProgress) {
    console.log('[CacheWarming] Warmup already in progress, skipping');
    return { warmed: 0, total: 0 };
  }
  warmupInProgress = true;

  try {
    console.log('[CacheWarming] Fetching video URLs...');

    const response = await fetch(`${API_BASE}/storage/warmup`);
    if (!response.ok) {
      console.warn(`[CacheWarming] Failed to fetch warmup URLs: ${response.status}`);
      return { warmed: 0, total: 0 };
    }

    const data = await response.json();

    if (!data.r2_enabled) {
      console.log('[CacheWarming] R2 not enabled, skipping warmup');
      return { warmed: 0, total: 0 };
    }

    // Populate queues (filter already-warmed URLs)
    galleryQueue = (data.gallery_urls || []).filter(url => url && !warmedUrls.has(url));
    gamesQueue = (data.game_urls || []).filter(url => url && !warmedUrls.has(url));
    workingQueue = (data.working_urls || []).filter(url => url && !warmedUrls.has(url));

    const total = galleryQueue.length + gamesQueue.length + workingQueue.length;

    if (total === 0) {
      console.log('[CacheWarming] No videos to warm');
      return { warmed: 0, total: 0 };
    }

    console.log(`[CacheWarming] Queued: ${gamesQueue.length} games, ${galleryQueue.length} gallery, ${workingQueue.length} working`);

    // Start workers (non-blocking)
    runWorkers();

    return { warmed: 0, total }; // Workers run async
  } catch (err) {
    console.error('[CacheWarming] Error:', err);
    return { warmed: 0, total: 0 };
  } finally {
    warmupInProgress = false;
  }
}

// Legacy exports for backwards compatibility
export async function warmVideoCache(url, { force = false } = {}) {
  if (force || !warmedUrls.has(url)) {
    return warmUrl(url);
  }
  return true;
}

export async function warmMultipleVideos(urls, { concurrency = 3, force = false } = {}) {
  const toWarm = force ? urls.filter(Boolean) : urls.filter(url => url && !warmedUrls.has(url));
  let warmed = 0;
  for (let i = 0; i < toWarm.length; i += concurrency) {
    const batch = toWarm.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(warmUrl));
    warmed += results.filter(Boolean).length;
  }
  return warmed;
}

export async function warmGamesCache(games) {
  if (!games?.length) return 0;
  const urls = games.map(g => g.video_url).filter(Boolean);
  return warmMultipleVideos(urls);
}
