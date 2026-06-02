/**
 * Decide, at video-load time, which URL to feed the <video> element.
 *
 * T3250: Game clips now use presigned R2 URLs by default (direct browser
 * streaming). The bounded proxy (T1430) remains as a fallback if the
 * presigned URL fetch fails. When the presigned URL is the main url and
 * gameUrl is null, chooseLoadRoute returns PASSTHROUGH.
 *
 * DIRECT_FORCED (?direct=1) still exists as a debug override.
 *
 * `rangeCovered` is still computed and returned so warm-coverage telemetry
 * survives even though it no longer changes the route.
 *
 * Pure by construction: takes `getWarmedStateFn` so tests can inject.
 */

export const ROUTE = Object.freeze({
  DIRECT_FORCED: 'direct-forced', // ?direct=1 override → go direct (debug only)
  PROXY: 'proxy',                 // game clip → bounded proxy (default)
  PASSTHROUGH: 'passthrough',     // no gameUrl supplied (non-game clip)
});

/**
 * @param {Object}   args
 * @param {string}   args.url              URL the caller would otherwise load (the proxy URL for game clips)
 * @param {string?}  args.gameUrl          Raw R2 presigned URL the warmer uses. Null for non-game clips.
 * @param {number?}  args.clipOffset       Clip start (seconds)
 * @param {number?}  args.clipDuration     Clip duration (seconds)
 * @param {boolean}  args.forceDirect      If true, skip proxy even when cold
 * @param {Function} args.getWarmedStateFn (url) => warmState | null
 * @returns {{ loadUrl: string, warmLookupUrl: string, route: string, rangeCovered: boolean }}
 */
export function chooseLoadRoute({
  url,
  gameUrl,
  clipOffset,
  clipDuration,
  forceDirect,
  getWarmedStateFn,
}) {
  if (!gameUrl) {
    return { loadUrl: url, warmLookupUrl: url, route: ROUTE.PASSTHROUGH, rangeCovered: false };
  }

  const ws = getWarmedStateFn(gameUrl);
  const clipEnd = clipDuration != null && clipOffset != null ? clipOffset + clipDuration : null;
  const rangeCovered = !!(ws && clipEnd != null
    && ws.clipRanges.find(r => r.startTime <= clipOffset && r.endTime >= clipEnd));

  if (forceDirect) {
    return { loadUrl: gameUrl, warmLookupUrl: gameUrl, route: ROUTE.DIRECT_FORCED, rangeCovered };
  }
  return { loadUrl: url, warmLookupUrl: gameUrl, route: ROUTE.PROXY, rangeCovered };
}

/** Read `?direct=1` from window.location. Safe in SSR/tests. */
export function isDirectForced() {
  if (typeof window === 'undefined' || !window.location) return false;
  try {
    return new URLSearchParams(window.location.search).get('direct') === '1';
  } catch {
    return false;
  }
}
