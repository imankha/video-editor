/**
 * Cloudflare Analytics wrapper
 *
 * Behavior:
 * - Dev (no VITE_CF_ANALYTICS_TOKEN): all calls are no-ops
 * - Prod (token set): injects CF Web Analytics beacon on first import,
 *   and sends custom events via zaraz.track() or __cfBeacon.send()
 *
 * Usage:
 *   import { track } from '../utils/analytics';
 *   track('export_started', { type: 'framing' });
 *
 * To enable: set VITE_CF_ANALYTICS_TOKEN in your environment.
 * Use a separate CF site token per environment (dev/staging/prod)
 * so traffic is segmented in the Cloudflare dashboard.
 */

const TOKEN = import.meta.env.VITE_CF_ANALYTICS_TOKEN;

// Inject beacon script once on module load — only when token is configured
if (TOKEN && !document.querySelector('[data-cf-beacon]')) {
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.setAttribute('data-cf-beacon', JSON.stringify({ token: TOKEN }));
  document.head.appendChild(script);
}

/**
 * Send a named custom event to Cloudflare Analytics.
 * No-op when TOKEN is not set (dev / CI).
 *
 * @param {string} event - Event name (snake_case)
 * @param {Object} [props] - Optional key/value metadata
 */
export function track(event, props = {}) {
  if (!TOKEN) return;

  // Prefer Zaraz if the zone has it enabled
  if (window.zaraz?.track) {
    window.zaraz.track(event, props);
    return;
  }

  // CF Web Analytics custom event fallback
  window.__cfBeacon?.send({ type: 'event', name: event, ...props });
}
