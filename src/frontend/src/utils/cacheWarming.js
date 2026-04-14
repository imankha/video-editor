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
  // T1410: while a foreground <video> is cold-loading, the warmer must stop
  // racing it on the R2 origin. Setting this priority aborts all in-flight
  // warm fetches and pauses the worker loop until priority is cleared.
  FOREGROUND_ACTIVE: 'foreground_active',
});

// Track URLs that have been warmed this session
// For clip ranges, key is "url|startByte-endByte" to allow multiple ranges per URL
const warmedUrls = new Set();

// T1430: per-URL warm state for observability. Lets useVideo log whether the
// clip about to be loaded was actually pre-warmed. Keyed by full URL.
// Shape: { urlWarmed: bool, tailWarmed: bool, clipRanges: Array<{startTime,
// endTime, startByte, endByte, warmedAt}>, warmedAt: number }
const warmedState = new Map();

function getOrInitState(url) {
  let s = warmedState.get(url);
  if (!s) {
    s = { urlWarmed: false, tailWarmed: false, clipRanges: [], warmedAt: 0 };
    warmedState.set(url, s);
  }
  return s;
}

/**
 * T1430: returns warm state for a URL, or null if never seen.
 * useVideo uses this at load start to log clipWarmed / rangeCovered.
 */
export function getWarmedState(url) {
  if (!url) return null;
  const s = warmedState.get(url);
  if (!s) return null;
  return {
    urlWarmed: s.urlWarmed,
    tailWarmed: s.tailWarmed,
    clipRanges: s.clipRanges.slice(),
    warmedAt: s.warmedAt,
  };
}

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

// T1410: AbortControllers for every in-flight warm fetch. When the foreground
// video starts loading we abort them all so the browser can dedicate bandwidth
// and R2 connections to the user-visible <video> element.
const inFlightControllers = new Set();

// T1410: priority before FOREGROUND_ACTIVE, so we can restore it on clear.
let priorityBeforeForeground = null;


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
  if (priority === currentPriority) return { abortedCount: 0 };
  console.log(`[CacheWarming] Priority changed to: ${priority}`);

  // T1410: entering FOREGROUND_ACTIVE aborts every in-flight warm fetch and
  // pauses the worker loop (getNextItem returns null). Leaving it restarts
  // workers against whatever is still queued.
  if (priority === WARMUP_PRIORITY.FOREGROUND_ACTIVE) {
    if (currentPriority !== WARMUP_PRIORITY.FOREGROUND_ACTIVE) {
      priorityBeforeForeground = currentPriority;
    }
    currentPriority = priority;
    const abortedCount = abortInFlightWarms();
    return { abortedCount };
  }

  // Leaving FOREGROUND_ACTIVE — restore prior priority if caller passed one,
  // else honor their explicit choice.
  currentPriority = priority;
  // Resume workers if queues still have items and nothing is running.
  if (!workersRunning) {
    const remaining = tier1Queue.length + gamesQueue.length + galleryQueue.length + workingQueue.length;
    if (remaining > 0) {
      runWorkers();
    }
  }
  priorityBeforeForeground = null;
  return { abortedCount: 0 };
}

/**
 * T1410: clear FOREGROUND_ACTIVE without the caller needing to know the
 * previous priority. No-op if not currently in foreground mode.
 */
export function clearForegroundActive() {
  if (currentPriority !== WARMUP_PRIORITY.FOREGROUND_ACTIVE) return;
  const restore = priorityBeforeForeground || WARMUP_PRIORITY.GAMES;
  setWarmupPriority(restore);
}

function abortInFlightWarms() {
  const count = inFlightControllers.size;
  if (count === 0) return 0;
  console.log(`[CacheWarming] Aborting ${count} in-flight warm fetches for foreground load`);
  for (const ctrl of inFlightControllers) {
    try { ctrl.abort(); } catch { /* ignore */ }
  }
  inFlightControllers.clear();
  return count;
}


/**
 * Get the next item to warm based on current priority.
 * Returns item object or null if all queues are empty.
 * Tier 1 (project clips) always processes first, then games/gallery by priority.
 */
function getNextItem() {
  // T1410: while foreground video is loading, don't pull new work. Workers
  // will drain out and runWorkers() will restart them when priority clears.
  if (currentPriority === WARMUP_PRIORITY.FOREGROUND_ACTIVE) {
    return null;
  }
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
  const startMs = performance.now();
  const controller = new AbortController();
  inFlightControllers.add(controller);

  try {
    // Always warm the start.
    // NOTE: mode: 'no-cors' is deliberate. R2 presigned URLs don't serve
    // Access-Control-Allow-Origin, so 'cors' would be rejected by the
    // browser (TypeError + noisy console CORS error). With 'no-cors' the
    // edge cache is still warmed (Cloudflare sees the request) but the
    // response returned to JS is opaque: status === 0, ok === false,
    // headers are hidden. Any response reaching us without throwing means
    // the network round-trip succeeded, so we treat it as warmed.
    // T1410: signal attached so foreground loads can abort us.
    await fetch(url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-1023' },
      mode: 'no-cors',
      credentials: 'omit',
      signal: controller.signal,
    });

    // T1430: record URL warm before optional tail so observers see partial state.
    {
      const s = getOrInitState(url);
      s.urlWarmed = true;
      s.warmedAt = Date.now();
    }

    // For large videos, also warm the tail where moov atom often lives
    if (warmTail && size && size > TAIL_WARM_SIZE_THRESHOLD) {
      const tailStart = Math.max(0, size - TAIL_WARM_SIZE);
      const tailEnd = size - 1;
      try {
        await fetch(url, {
          method: 'GET',
          headers: { 'Range': `bytes=${tailStart}-${tailEnd}` },
          mode: 'no-cors',
          credentials: 'omit',
          signal: controller.signal,
        });
        getOrInitState(url).tailWarmed = true;
        console.log(`[CacheWarming] Warmed tail url=${url.substring(0, 60)} size=${Math.round(size / 1024 / 1024)}MB elapsedMs=${Math.round(performance.now() - startMs)}`);
      } catch (tailErr) {
        if (tailErr.name !== 'AbortError') {
          console.log(`[CacheWarming] Tail warm failed: ${tailErr.message}`);
        }
      }
    }

    warmedUrls.add(url);
    console.log(`[CacheWarming] Warmed url url=${url.substring(0, 60)} tail=${warmTail && size && size > TAIL_WARM_SIZE_THRESHOLD ? 'yes' : 'no'} elapsedMs=${Math.round(performance.now() - startMs)}`);
    return true;
  } catch {
    // Network error (DNS, offline, aborted). Not warmed.
    return false;
  } finally {
    inFlightControllers.delete(controller);
  }
}

/**
 * Warm a clip's byte range using proportional estimation.
 * Primes the Cloudflare edge cache for the clip's region of the game video.
 */
async function warmClipRange(url, startTime, endTime, videoDuration, videoSize, clipId = null) {
  if (!url || !videoDuration || !videoSize) return false;
  const startMs = performance.now();

  const startByte = Math.floor((startTime / videoDuration) * videoSize);
  const endByte = Math.ceil((endTime / videoDuration) * videoSize);
  const rangeSize = endByte - startByte;
  const buffer = Math.ceil(rangeSize * 0.1); // 10% buffer each side

  const warmStart = Math.max(0, startByte - buffer);
  const warmEnd = Math.min(videoSize - 1, endByte + buffer);

  const controller = new AbortController();
  inFlightControllers.add(controller);
  try {
    // See warmUrl for the no-cors rationale. Opaque response (status 0,
    // ok false) is expected and counts as a successful cache warm.
    // T1410: signal attached so foreground loads can abort us.
    await fetch(url, {
      method: 'GET',
      headers: { 'Range': `bytes=${warmStart}-${warmEnd}` },
      mode: 'no-cors',
      credentials: 'omit',
      signal: controller.signal,
    });

    // T1430: record clip range so useVideo can check coverage at load start.
    const s = getOrInitState(url);
    s.clipRanges.push({ startTime, endTime, startByte: warmStart, endByte: warmEnd, warmedAt: Date.now() });
    s.warmedAt = Date.now();
    console.log(`[CacheWarming] Warmed clip clipId=${clipId ?? 'null'} url=${url.substring(0, 60)} range=${warmStart}-${warmEnd} elapsedMs=${Math.round(performance.now() - startMs)}`);
    return true;
  } catch {
    // Network failure or aborted; clip range not warmed.
    return false;
  } finally {
    inFlightControllers.delete(controller);
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
      success = await warmClipRange(item.url, item.startTime, item.endTime, item.videoDuration, item.videoSize, item.clipId);
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
  warmedState.clear();
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
  // T1330: guest accounts removed — pre-login there are no videos to warm.
  const { useAuthStore } = await import('../stores/authStore');
  if (!useAuthStore.getState().isAuthenticated) {
    return { warmed: 0, total: 0 };
  }
  if (warmupInProgress) {
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
            clipId: clip.id ?? null,
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
    clipId: clip.clipId ?? clip.id ?? null,
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
