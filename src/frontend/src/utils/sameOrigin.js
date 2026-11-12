/**
 * True when `url` targets the app's own origin (a relative path, or an
 * absolute URL matching `window.location.origin`). Credentials must only be
 * sent for a same-origin request -- a cross-origin/cross-site target (the
 * backend when API_BASE != the frontend origin, or an R2 presigned URL)
 * may never answer Access-Control-Allow-Credentials: true, and Safari
 * correctly refuses a credentialed request in that case (T15720).
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isSameOrigin(url) {
  return url.startsWith('/') ||
    (typeof window !== 'undefined' && url.startsWith(window.location.origin));
}
