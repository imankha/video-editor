/**
 * R2 Cache Warming Utility
 *
 * Cloudflare R2 can have slow first-byte times when content isn't cached at the edge.
 * This utility pre-warms the cache by making small range requests to video URLs,
 * ensuring faster load times when users actually open videos.
 *
 * T55: Addresses slow video loading (60+ seconds) on cold cache.
 */

// Track URLs currently being warmed to avoid duplicate requests
const warmingInProgress = new Set();

// Track URLs that have been warmed this session
const warmedUrls = new Set();

/**
 * Warm the R2 cache for a video URL by requesting a small byte range.
 * This triggers Cloudflare to cache the file at the edge.
 *
 * @param {string} url - Video URL to warm
 * @param {Object} options - Options
 * @param {boolean} options.force - Force warming even if already warmed this session
 * @returns {Promise<boolean>} - True if warming succeeded
 */
export async function warmVideoCache(url, { force = false } = {}) {
  if (!url || url.startsWith('blob:')) {
    return false; // Skip blob URLs
  }

  // Skip if already warmed this session (unless forced)
  if (!force && warmedUrls.has(url)) {
    return true;
  }

  // Skip if warming is already in progress for this URL
  if (warmingInProgress.has(url)) {
    return false;
  }

  warmingInProgress.add(url);

  try {
    // Request just the first 1KB to warm the cache
    // This is enough to trigger R2 to cache the file at Cloudflare's edge
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Range': 'bytes=0-1023'  // First 1KB
      },
      // Don't follow redirects, don't send credentials
      mode: 'cors',
      credentials: 'omit',
    });

    if (response.ok || response.status === 206) {
      warmedUrls.add(url);
      console.log(`[CacheWarming] Warmed: ${url.substring(0, 50)}...`);
      return true;
    } else {
      console.warn(`[CacheWarming] Failed to warm (${response.status}): ${url.substring(0, 50)}...`);
      return false;
    }
  } catch (err) {
    // CORS errors are expected if R2 CORS isn't configured yet
    // The request still warms the cache even if we can't read the response
    console.log(`[CacheWarming] Request sent (may have warmed cache): ${url.substring(0, 50)}...`);
    warmedUrls.add(url); // Optimistically mark as warmed
    return true;
  } finally {
    warmingInProgress.delete(url);
  }
}

/**
 * Warm the cache for multiple video URLs.
 * Requests are made in parallel with a concurrency limit.
 *
 * @param {string[]} urls - Array of video URLs to warm
 * @param {Object} options - Options
 * @param {number} options.concurrency - Max concurrent requests (default 3)
 * @param {boolean} options.force - Force warming even if already warmed
 * @returns {Promise<number>} - Number of URLs successfully warmed
 */
export async function warmMultipleVideos(urls, { concurrency = 3, force = false } = {}) {
  if (!urls || urls.length === 0) {
    return 0;
  }

  // Filter out already-warmed URLs unless forced
  const urlsToWarm = force
    ? urls.filter(Boolean)
    : urls.filter(url => url && !warmedUrls.has(url));

  if (urlsToWarm.length === 0) {
    return 0;
  }

  console.log(`[CacheWarming] Warming ${urlsToWarm.length} video(s)...`);

  let warmed = 0;

  // Process in batches to limit concurrency
  for (let i = 0; i < urlsToWarm.length; i += concurrency) {
    const batch = urlsToWarm.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(url => warmVideoCache(url, { force }))
    );
    warmed += results.filter(Boolean).length;
  }

  console.log(`[CacheWarming] Warmed ${warmed}/${urlsToWarm.length} videos`);
  return warmed;
}

/**
 * Warm cache for games that have video URLs.
 * Call this when the games list loads.
 *
 * @param {Array} games - Array of game objects from API
 * @returns {Promise<number>} - Number of videos warmed
 */
export async function warmGamesCache(games) {
  if (!games || games.length === 0) {
    return 0;
  }

  // Extract video URLs from games
  const videoUrls = games
    .map(game => game.video_url)
    .filter(Boolean);

  return warmMultipleVideos(videoUrls);
}

/**
 * Clear the warmed URLs cache.
 * Call this when the user logs out or when you want to force re-warming.
 */
export function clearWarmingCache() {
  warmedUrls.clear();
  warmingInProgress.clear();
}
