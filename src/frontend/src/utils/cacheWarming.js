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
// For clip ranges, key is "url|startByte-endByte" to allow multiple ranges per URL
const warmedUrls = new Set();

// Priority queues - tier1 is project clips (highest), then games, gallery, working
let tier1Queue = [];
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

// Threshold for tail warming (100MB) - videos larger than this likely have moov at end
const TAIL_WARM_SIZE_THRESHOLD = 100 * 1024 * 1024;
// Size of tail to warm (5MB) - moov atom is typically a few MB
const TAIL_WARM_SIZE = 5 * 1024 * 1024;

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
 * Get the next item to warm based on current priority.
 * Returns item object or null if all queues are empty.
 * Tier 1 (project clips) always processes first, then games/gallery by priority.
 */
function getNextItem() {
  // Tier 1: project clips (highest priority)
  while (tier1Queue.length > 0) {
    const item = tier1Queue.shift();
    const cacheKey = item.type === 'clipRange'
      ? `${item.url}|${item.startTime}-${item.endTime}`
      : item.url;
    if (cacheKey && !warmedUrls.has(cacheKey)) {
      return { ...item, _cacheKey: cacheKey };
    }
  }

  // Tier 2/3: games and gallery by user navigation priority
  const priorityQueue = currentPriority === WARMUP_PRIORITY.GAMES ? gamesQueue : galleryQueue;
  const secondaryQueue = currentPriority === WARMUP_PRIORITY.GAMES ? galleryQueue : gamesQueue;

  for (const queue of [priorityQueue, secondaryQueue]) {
    while (queue.length > 0) {
      const item = queue.shift();
      const url = typeof item === 'object' ? item.url : item;
      if (url && !warmedUrls.has(url)) {
        if (typeof item === 'object') {
          return { url, size: item.size, warmTail: true, _cacheKey: url };
        }
        return { url, _cacheKey: url };
      }
    }
  }

  // Working queue last
  while (workingQueue.length > 0) {
    const item = workingQueue.shift();
    const url = typeof item === 'object' ? item.url : item;
    if (url && !warmedUrls.has(url)) {
      return { url, _cacheKey: url };
    }
  }

  return null;
}

/**
 * Warm a single video URL with optional tail warming.
 * @param {string} url - The URL to warm
 * @param {Object} options - Optional warming options
 * @param {number} options.size - File size for tail warming
 * @param {boolean} options.warmTail - Whether to warm the tail of the file
 */
async function warmUrl(url, options = {}) {
  if (!url || url.startsWith('blob:') || warmedUrls.has(url)) {
    return false;
  }

  const { size, warmTail } = options;

  try {
    // Always warm the start
    const startResponse = await fetch(url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-1023' },
      mode: 'cors',
      credentials: 'omit',
    });

    if (!startResponse.ok && startResponse.status !== 206) {
      return false;
    }

    // For large videos, also warm the tail where moov atom often lives
    if (warmTail && size && size > TAIL_WARM_SIZE_THRESHOLD) {
      const tailStart = Math.max(0, size - TAIL_WARM_SIZE);
      const tailEnd = size - 1;
      try {
        await fetch(url, {
          method: 'GET',
          headers: { 'Range': `bytes=${tailStart}-${tailEnd}` },
          mode: 'cors',
          credentials: 'omit',
        });
        console.log(`[CacheWarming] Warmed tail of large video (${Math.round(size / 1024 / 1024)}MB)`);
      } catch (tailErr) {
        // Tail warming failure is non-fatal
        console.log(`[CacheWarming] Tail warm failed (CORS ok): ${tailErr.message}`);
      }
    }

    warmedUrls.add(url);
    return true;
  } catch (err) {
    // CORS errors still warm the cache
    warmedUrls.add(url);
    return true;
  }
}

/**
 * Warm a clip's byte range using proportional estimation.
 * Primes the Cloudflare edge cache for the clip's region of the game video.
 */
async function warmClipRange(url, startTime, endTime, videoDuration, videoSize) {
  if (!url || !videoDuration || !videoSize) return false;

  const startByte = Math.floor((startTime / videoDuration) * videoSize);
  const endByte = Math.ceil((endTime / videoDuration) * videoSize);
  const rangeSize = endByte - startByte;
  const buffer = Math.ceil(rangeSize * 0.1); // 10% buffer each side

  const warmStart = Math.max(0, startByte - buffer);
  const warmEnd = Math.min(videoSize - 1, endByte + buffer);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Range': `bytes=${warmStart}-${warmEnd}` },
      mode: 'cors',
      credentials: 'omit',
    });

    if (!response.ok && response.status !== 206) {
      return false;
    }

    console.log(`[CacheWarming] Warmed clip range ${Math.round(warmStart / 1024 / 1024)}MB-${Math.round(warmEnd / 1024 / 1024)}MB of ${Math.round(videoSize / 1024 / 1024)}MB video`);
    return true;
  } catch {
    // CORS errors still warm the cache
    return true;
  }
}

/**
 * Worker function that continuously pulls from queues.
 */
async function worker(workerId) {
  let warmed = 0;

  while (true) {
    const item = getNextItem();
    if (!item) break;

    let success;
    if (item.type === 'clipRange') {
      success = await warmClipRange(item.url, item.startTime, item.endTime, item.videoDuration, item.videoSize);
    } else {
      success = await warmUrl(item.url, { size: item.size, warmTail: item.warmTail });
    }

    if (success && item._cacheKey) {
      warmedUrls.add(item._cacheKey);
    }
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

  const totalBefore = tier1Queue.length + gamesQueue.length + galleryQueue.length + workingQueue.length;
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
  tier1Queue = [];
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

    // Populate tier 1: project clips (highest priority)
    tier1Queue = [];
    for (const project of (data.project_clips || [])) {
      if (project.has_working_video && project.working_video_url) {
        // Framed project: warm the working video (user's next step is Overlay)
        tier1Queue.push({ url: project.working_video_url, warmTail: true });
      } else {
        // Unframed project: warm clip byte ranges
        for (const clip of (project.clips || [])) {
          tier1Queue.push({
            type: 'clipRange',
            url: clip.game_url,
            startTime: clip.start_time,
            endTime: clip.end_time,
            videoDuration: clip.video_duration,
            videoSize: clip.video_size,
          });
        }
      }
    }

    // Populate remaining queues (filter already-warmed URLs)
    galleryQueue = (data.gallery_urls || []).filter(url => url && !warmedUrls.has(url));
    gamesQueue = (data.game_urls || []).filter(item => {
      const url = typeof item === 'object' ? item.url : item;
      return url && !warmedUrls.has(url);
    });
    workingQueue = (data.working_urls || []).filter(url => url && !warmedUrls.has(url));

    const total = tier1Queue.length + galleryQueue.length + gamesQueue.length + workingQueue.length;

    if (total === 0) {
      console.log('[CacheWarming] No videos to warm');
      return { warmed: 0, total: 0 };
    }

    const largeGames = gamesQueue.filter(item =>
      typeof item === 'object' && item.size && item.size > TAIL_WARM_SIZE_THRESHOLD
    ).length;
    console.log(`[CacheWarming] Queued: ${tier1Queue.length} project clips (tier 1), ${gamesQueue.length} games (${largeGames} large with tail warm), ${galleryQueue.length} gallery, ${workingQueue.length} working`);

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

/**
 * Push clip ranges to the front of the warmup queue.
 * Call this when a new project is created to immediately warm its clips.
 * @param {Array<{url, startTime, endTime, videoDuration, videoSize}>} clipRanges
 */
export function pushClipRanges(clipRanges) {
  if (!clipRanges?.length) return;

  const items = clipRanges.map(clip => ({
    type: 'clipRange',
    url: clip.url,
    startTime: clip.startTime,
    endTime: clip.endTime,
    videoDuration: clip.videoDuration,
    videoSize: clip.videoSize,
  }));

  // Prepend to tier1 so these process next
  tier1Queue = [...items, ...tier1Queue];
  console.log(`[CacheWarming] Pushed ${items.length} clip ranges to tier 1 queue`);

  // Restart workers if they've finished
  if (!workersRunning) {
    runWorkers();
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
