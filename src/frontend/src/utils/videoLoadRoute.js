/**
 * T1460: decide, at video-load time, whether to stream direct from R2 or via
 * the T1430 bounded proxy.
 *
 * Why this is here and not in FramingScreen:
 *   Previously FramingScreen picked proxy-vs-direct at clip-select time based
 *   on `getWarmedState` at that instant. The warmer usually finishes ~1s
 *   later, so the decision was frozen before warm data arrived. This module
 *   runs inside useVideo.loadVideo so it reads the freshest warm state
 *   available, and `warm_status` telemetry is keyed on the R2 URL (the one
 *   the warmer actually warmed) rather than whichever URL was chosen.
 *
 * Pure by construction: takes `getWarmedStateFn` so tests can inject.
 */

export const ROUTE = Object.freeze({
  DIRECT_WARM: 'direct-warm',     // warm range covers clip → go direct
  DIRECT_FORCED: 'direct-forced', // ?direct=1 override → go direct
  PROXY: 'proxy',                 // not warm, no override → bounded proxy
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
  const rangeCovered = !!(ws && clipEnd != null && ws.clipRanges.some(
    r => r.startTime <= clipOffset && r.endTime >= clipEnd
  ));

  if (rangeCovered) {
    return { loadUrl: gameUrl, warmLookupUrl: gameUrl, route: ROUTE.DIRECT_WARM, rangeCovered: true };
  }
  if (forceDirect) {
    return { loadUrl: gameUrl, warmLookupUrl: gameUrl, route: ROUTE.DIRECT_FORCED, rangeCovered: false };
  }
  return { loadUrl: url, warmLookupUrl: gameUrl, route: ROUTE.PROXY, rangeCovered: false };
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
