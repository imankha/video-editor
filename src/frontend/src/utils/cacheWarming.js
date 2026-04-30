/**
 * R2 Cache Warming Utility
 *
 * Cloudflare R2 can have slow first-byte times when content isn't cached at the edge.
 * This utility pre-warms the cache by making small range requests to video URLs,
 * ensuring faster load times when users actually open videos.
 *
 * T55: Addresses slow video loading (60+ seconds) on cold cache.
 *
 * Lifecycle:
 * 1. warmAllUserVideos() runs on app init — queues all user videos
 * 2. Single worker drains queue sequentially (R2 is HTTP/1.1, 6-socket limit)
 * 3. When user opens a video, FOREGROUND_ACTIVE permanently kills the warmer
 *
 * Usage:
 * - Call warmAllUserVideos() on app init/user login
 * - Call setWarmupPriority('gallery') when gallery is opened
 * - Call setWarmupPriority('games') when games/annotate is accessed
 */

import { API_BASE, resolveApiUrl } from '../config';

// ── Fetch mode ──────────────────────────────────────────────────────────────

// R2 presigned URLs don't serve CORS headers — no-cors + credentials:omit.
// Same-origin proxy /stream URLs need the session cookie.
function warmFetchMode(url) {
  const isSameOrigin =
    url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));
  return isSameOrigin
    ? { credentials: 'include' }
    : { mode: 'no-cors', credentials: 'omit' };
}

// ── Constants ───────────────────────────────────────────────────────────────

export const WARMUP_PRIORITY = Object.freeze({
  GAMES: 'games',
  GALLERY: 'gallery',
  // Setting this permanently kills the warmer for the session.
  FOREGROUND_ACTIVE: 'foreground_active',
});

// Per-fetch timeout (30s). Without this, a warm fetch that stalls (browser
// suspends background tab, R2 edge is slow) blocks the worker and holds an
// R2 connection slot indefinitely.
const WARM_FETCH_TIMEOUT_MS = 30_000;

// Threshold for tail warming (100MB) - videos larger than this likely have moov at end
const TAIL_WARM_SIZE_THRESHOLD = 100 * 1024 * 1024;
// Size of tail to warm (5MB) - moov atom is typically a few MB
const TAIL_WARM_SIZE = 5 * 1024 * 1024;

// ── Session state ───────────────────────────────────────────────────────────

// Track URLs warmed this session (Set of cache keys)
const warmedUrls = new Set();

// Per-URL warm state for load-route decisions (chooseLoadRoute checks whether
// a clip's byte range was pre-warmed to decide proxy vs direct).
// Keyed by stable URL (host+path, no query string).
const warmedState = new Map();

function stableUrlKey(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url.split('?')[0];
  }
}

function getOrInitState(url) {
  const key = stableUrlKey(url);
  let s = warmedState.get(key);
  if (!s) {
    s = { urlWarmed: false, tailWarmed: false, clipRanges: [], warmedAt: 0 };
    warmedState.set(key, s);
  }
  return s;
}

/**
 * Returns warm state for a URL, or null if never seen.
 * Used by chooseLoadRoute to decide proxy vs direct.
 */
export function getWarmedState(url) {
  if (!url) return null;
  const s = warmedState.get(stableUrlKey(url));
  if (!s) return null;
  return {
    urlWarmed: s.urlWarmed,
    tailWarmed: s.tailWarmed,
    clipRanges: s.clipRanges.slice(),
    warmedAt: s.warmedAt,
  };
}

// ── Queues ───────────────────────────────────────────────────────────────────

let tier1Queue = [];    // project clips (highest priority)
let gamesQueue = [];
let galleryQueue = [];
let workingQueue = [];

// ── Worker state ────────────────────────────────────────────────────────────

let currentPriority = WARMUP_PRIORITY.GAMES;
let workersRunning = false;
let warmupInProgress = false;

// Pauses ALL warming while foreground video is loading.
// Cleared by clearForegroundActive() when the foreground video becomes playable.
let warmerDisabled = false;

// AbortControllers for in-flight warm fetches. FOREGROUND_ACTIVE and
// visibility-change abort ALL of these so the browser can reclaim connections.
const inFlightControllers = new Set();
const inFlightClipRangeControllers = new Set();

// ── Diagnostics ─────────────────────────────────────────────────────────────

/**
 * Snapshot of warmer state. Used by uploadManager to correlate upload-start
 * moments with concurrent warm-fetch activity.
 */
export function getWarmingDiag() {
  return {
    priority: currentPriority,
    inFlight: inFlightControllers.size + inFlightClipRangeControllers.size,
    tier1: tier1Queue.length,
    games: gamesQueue.length,
    gallery: galleryQueue.length,
    working: workingQueue.length,
    workersRunning,
  };
}

// ── Priority / abort ────────────────────────────────────────────────────────

/**
 * Set the warmup priority. Call this when user navigates.
 * FOREGROUND_ACTIVE stops ALL warming and aborts ALL in-flight fetches
 * (including tier-1 clip ranges) to free connections for the foreground video.
 * Cleared by clearForegroundActive().
 */
export function setWarmupPriority(priority) {
  if (priority === currentPriority) return { abortedCount: 0 };
  console.log(`[CacheWarming] Priority changed to: ${priority}`);

  if (priority === WARMUP_PRIORITY.FOREGROUND_ACTIVE) {
    currentPriority = priority;
    warmerDisabled = true;
    const abortedCount = abortInFlightWarms();
    return { abortedCount };
  }

  currentPriority = priority;
  return { abortedCount: 0 };
}

function abortInFlightWarms() {
  const count = inFlightControllers.size + inFlightClipRangeControllers.size;
  if (count === 0) return 0;
  console.log(`[CacheWarming] Aborting ${count} in-flight warm fetches`);
  for (const ctrl of inFlightControllers) {
    try { ctrl.abort(); } catch { /* ignore */ }
  }
  inFlightControllers.clear();
  for (const ctrl of inFlightClipRangeControllers) {
    try { ctrl.abort(); } catch { /* ignore */ }
  }
  inFlightClipRangeControllers.clear();
  return count;
}

// Abort warm fetches when the tab goes to background. Background fetches sit
// in browser "blocked" state indefinitely, tying up the worker and an R2
// connection slot.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      const total = inFlightControllers.size + inFlightClipRangeControllers.size;
      if (total > 0) {
        console.log(`[CacheWarming] Tab hidden — aborting ${total} in-flight warm fetches`);
        abortInFlightWarms();
      }
    }
  });
}

// ── Queue consumer ──────────────────────────────────────────────────────────

/**
 * Get the next item to warm based on current priority.
 * Returns null if queues are empty, warmer is disabled, or tab is hidden.
 */
function getNextItem() {
  // Don't start new fetches while tab is hidden — they'll just stall.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return null;
  }

  // All tiers are paused when foreground video is loading — free all
  // connections for the user's video (R2 is HTTP/1.1, 6-socket limit).
  if (warmerDisabled) return null;

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

// ── Warm functions ──────────────────────────────────────────────────────────

/**
 * Warm a single video URL with optional tail warming.
 */
async function warmUrl(url, options = {}) {
  if (!url || url.startsWith('blob:') || warmedUrls.has(url) || warmerDisabled) {
    return false;
  }

  const { size, warmTail } = options;
  const startMs = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WARM_FETCH_TIMEOUT_MS);
  inFlightControllers.add(controller);

  try {
    // no-cors: R2 presigned URLs don't serve CORS headers. Opaque response
    // (status 0, ok false) is expected — any response without throwing means
    // the edge cache was warmed.
    await fetch(url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-1023' },
      ...warmFetchMode(url),
      signal: controller.signal,
    });

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
          ...warmFetchMode(url),
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
    return false;
  } finally {
    clearTimeout(timeout);
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
  const timeout = setTimeout(() => controller.abort(), WARM_FETCH_TIMEOUT_MS);
  inFlightClipRangeControllers.add(controller);
  try {
    // Warm the moov/ftyp header region (1MB). <video> always fetches a head
    // range first to parse the moov atom before it can seek to clipOffset.
    const headPromise = fetch(url, {
      method: 'GET',
      headers: { 'Range': 'bytes=0-1048575' },
      ...warmFetchMode(url),
      signal: controller.signal,
    }).catch(() => {});

    // Warm the clip's byte range (opaque response expected with no-cors).
    await fetch(url, {
      method: 'GET',
      headers: { 'Range': `bytes=${warmStart}-${warmEnd}` },
      ...warmFetchMode(url),
      signal: controller.signal,
    });
    await headPromise;

    const s = getOrInitState(url);
    s.clipRanges.push({ startTime, endTime, startByte: warmStart, endByte: warmEnd, warmedAt: Date.now() });
    s.warmedAt = Date.now();
    console.log(`[CacheWarming] Warmed clip clipId=${clipId ?? 'null'} url=${url.substring(0, 60)} head=0-1048575 range=${warmStart}-${warmEnd} elapsedMs=${Math.round(performance.now() - startMs)}`);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
    inFlightClipRangeControllers.delete(controller);
  }
}

// ── Worker ──────────────────────────────────────────────────────────────────

async function worker() {
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
 * Start the single worker to process all queues in priority order.
 */
async function runWorkers() {
  if (workersRunning) return;
  workersRunning = true;

  const total = tier1Queue.length + gamesQueue.length + galleryQueue.length + workingQueue.length;
  if (total === 0) {
    workersRunning = false;
    return;
  }

  console.log(`[CacheWarming] Starting worker for ${total} videos (priority: ${currentPriority}, tier1=${tier1Queue.length})`);

  const warmed = await worker();

  console.log(`[CacheWarming] Complete: ${warmed} videos warmed`);
  workersRunning = false;
}

// ── Public API ──────────────────────────────────────────────────────────────

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
        tier1Queue.push({ url: resolveApiUrl(project.working_video_url), warmTail: true });
      } else {
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
    workingQueue = (data.working_urls || [])
      .map(url => resolveApiUrl(url))
      .filter(url => url && !warmedUrls.has(url));

    const total = tier1Queue.length + galleryQueue.length + gamesQueue.length + workingQueue.length;

    if (total === 0) {
      console.log('[CacheWarming] No videos to warm');
      return { warmed: 0, total: 0 };
    }

    const largeGames = gamesQueue.filter(item =>
      typeof item === 'object' && item.size && item.size > TAIL_WARM_SIZE_THRESHOLD
    ).length;
    console.log(`[CacheWarming] Queued: ${tier1Queue.length} project clips (tier 1), ${gamesQueue.length} games (${largeGames} large with tail warm), ${galleryQueue.length} gallery, ${workingQueue.length} working`);

    // Start worker (non-blocking)
    runWorkers();

    return { warmed: 0, total }; // Worker runs async
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
 */
export function pushClipRanges(clipRanges) {
  if (!clipRanges?.length) return;

  const key = (url, st, et) => `${url}|${st}-${et}`;
  const existingKeys = new Set(
    tier1Queue
      .filter(i => i.type === 'clipRange')
      .map(i => key(i.url, i.startTime, i.endTime))
  );
  const items = clipRanges
    .filter(clip => {
      const k = key(clip.url, clip.startTime, clip.endTime);
      return !existingKeys.has(k) && !warmedUrls.has(k);
    })
    .map(clip => ({
      type: 'clipRange',
      clipId: clip.clipId ?? clip.id ?? null,
      url: clip.url,
      startTime: clip.startTime,
      endTime: clip.endTime,
      videoDuration: clip.videoDuration,
      videoSize: clip.videoSize,
    }));

  if (!items.length) return;

  tier1Queue = [...items, ...tier1Queue];
  console.log(`[CacheWarming] Pushed ${items.length} clip ranges to tier 1 queue`);

  if (!workersRunning) {
    runWorkers();
  }
}

// Legacy export — used by FramingScreen for direct warming outside the queue.
export async function warmVideoCache(url, { force = false } = {}) {
  if (force || !warmedUrls.has(url)) {
    return warmUrl(url);
  }
  return true;
}

export function clearForegroundActive() {
  if (!warmerDisabled) return;
  warmerDisabled = false;
  currentPriority = WARMUP_PRIORITY.GAMES;
  const remaining = tier1Queue.length + gamesQueue.length + galleryQueue.length + workingQueue.length;
  if (remaining > 0) {
    console.log(`[CacheWarming] Foreground clear — resuming worker for ${remaining} queued items`);
    runWorkers();
  }
}

/**
 * Warm multiple video URLs with optional concurrency and force.
 * Returns the count of successfully warmed URLs.
 * Used by tests and callers that need to warm a batch of URLs directly.
 *
 * @param {string[]} urls - Array of URLs to warm
 * @param {object} options
 * @param {number} [options.concurrency=1] - Max concurrent warm fetches
 * @param {boolean} [options.force=false] - Bypass the already-warmed cache check
 * @returns {Promise<number>} Number of URLs successfully warmed
 */
export async function warmMultipleVideos(urls, { concurrency = 1, force = false } = {}) {
  if (!urls || urls.length === 0) return 0;

  let warmedCount = 0;
  const queue = [...urls];

  async function worker() {
    while (queue.length > 0) {
      const url = queue.shift();
      if (!url) continue;
      if (!force && warmedUrls.has(url)) {
        warmedCount++;
        continue;
      }
      // Temporarily clear warmed state if force so warmUrl doesn't skip it
      if (force) warmedUrls.delete(url);
      const ok = await warmUrl(url);
      if (ok) warmedCount++;
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, urls.length) }, () => worker());
  await Promise.all(workers);
  return warmedCount;
}
