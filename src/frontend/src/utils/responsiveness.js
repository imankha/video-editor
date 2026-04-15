/**
 * Global responsiveness monitor.
 *
 * Installs a PerformanceObserver on `longtask` entries (tasks that block the
 * main thread >50ms) and logs them. Purpose: surface any "UI feels frozen"
 * moments with enough attribution to find the root cause.
 *
 * Browser support: Chromium + recent Firefox expose the `longtask` entry
 * type. Safari does not. Wrap in try/catch so unsupported browsers are silent.
 *
 * The observer is fire-and-forget; it has no state and is safe to call once
 * at app boot.
 */

const WARN_THRESHOLD_MS = 200;  // log as warning at/above this
const INFO_THRESHOLD_MS = 50;   // long-task spec minimum

let installed = false;

export function installResponsivenessMonitor() {
  if (installed) return;
  installed = true;

  if (typeof PerformanceObserver === 'undefined') return;
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;

  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = Math.round(entry.duration);
        if (duration < INFO_THRESHOLD_MS) continue;

        // Attribution: the spec exposes entry.attribution[] with containerType
        // (iframe, embed, object) + containerSrc. In practice for our SPA it's
        // usually 'window' with an empty src — still useful as a marker.
        const attr = (entry.attribution || [])
          .map(a => a.containerType || 'self')
          .join(',') || 'self';

        const msg = `[LONGTASK] duration=${duration}ms start=${Math.round(entry.startTime)}ms attribution=${attr} name=${entry.name}`;
        if (duration >= WARN_THRESHOLD_MS) {
          // eslint-disable-next-line no-console
          console.warn(msg);
        } else {
          // eslint-disable-next-line no-console
          console.info(msg);
        }
      }
    });
    obs.observe({ type: 'longtask', buffered: true });
  } catch {
    /* browser refused; silently bail */
  }
}

/**
 * Wrap an async function so its wall-clock duration is logged if it exceeds
 * `thresholdMs`. Use at boundaries where we care about user-perceived latency
 * (data fetches, store mutations that fan out into renders). Does not change
 * the wrapped function's return value or error behavior.
 */
export function profileSlow(label, fn, thresholdMs = 500) {
  return async (...args) => {
    const t0 = performance.now();
    try {
      return await fn(...args);
    } finally {
      const elapsed = Math.round(performance.now() - t0);
      if (elapsed >= thresholdMs) {
        // eslint-disable-next-line no-console
        console.warn(`[SLOW] ${label} took ${elapsed}ms (threshold ${thresholdMs}ms)`);
      }
    }
  };
}
