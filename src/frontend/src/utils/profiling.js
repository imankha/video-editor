/**
 * Frontend profiling instrumentation (T1570).
 *
 * Gated by VITE_PROFILING_ENABLED env var:
 *   - staging: set to "true" to enable all instrumentation
 *   - production: omit or set to "false" for zero overhead
 *
 * When disabled, timedSpan returns the function unchanged and profiledFetch
 * falls through to native fetch -- no performance.mark/measure calls, no
 * timing math, no console output.
 *
 * Three capabilities:
 *   1. timedSpan(label, fn, thresholdMs) -- User Timing API wrapper
 *   2. profiledFetch(label, url, opts, thresholdMs) -- fetch with TTFB/body timing
 *   3. PROFILING_ENABLED flag for conditional use elsewhere
 */

export const PROFILING_ENABLED =
  import.meta.env.VITE_PROFILING_ENABLED === 'true';

/** Per-label thresholds (ms). Any measure exceeding its threshold emits a [TIMING] log. */
const LABEL_THRESHOLDS = {
  'games:fetch': 1000,
  'project:load': 1000,
  'clip:extract': 2000,
  'export:start': 2000,
  'video:load': 3000,
};

/**
 * Wrap an async function with User Timing API marks.
 *
 * The resulting performance.measure() entries are visible in DevTools
 * Performance timeline automatically. If the measure exceeds the per-label
 * threshold (or the provided fallback), a structured [TIMING] console log
 * is emitted.
 *
 * When PROFILING_ENABLED is false, returns `fn` unchanged -- zero overhead.
 *
 * @param {string} label - measure name (e.g. "games:fetch")
 * @param {Function} fn - async function to wrap
 * @param {number} [thresholdMs] - override per-label threshold
 * @returns {Function} wrapped function (same signature as fn)
 */
export function timedSpan(label, fn, thresholdMs) {
  if (!PROFILING_ENABLED) return fn;

  const threshold = thresholdMs ?? LABEL_THRESHOLDS[label] ?? 1000;

  return async (...args) => {
    const markStart = `${label}:start`;
    const markEnd = `${label}:end`;

    performance.mark(markStart);
    try {
      return await fn(...args);
    } finally {
      performance.mark(markEnd);
      try {
        const measure = performance.measure(label, markStart, markEnd);
        const elapsed = Math.round(measure.duration);
        if (elapsed >= threshold) {
          // eslint-disable-next-line no-console
          console.warn(
            `[TIMING] ${label} duration=${elapsed}ms threshold=${threshold}ms`
          );
        }
      } catch {
        /* measure can throw if marks were cleared; ignore */
      }
      // Clean up marks to avoid accumulation
      performance.clearMarks(markStart);
      performance.clearMarks(markEnd);
    }
  };
}

/**
 * Profiled fetch wrapper.
 *
 * Wraps native fetch and logs three timing components:
 *   - total: wall-clock from request start to body fully read
 *   - ttfb: time to first byte (headers received)
 *   - body: time to read the response body (json/text/blob)
 *
 * When PROFILING_ENABLED is false, delegates directly to native fetch.
 *
 * @param {string} label - identifier for this fetch (e.g. "games:fetch")
 * @param {string|URL} url - fetch URL
 * @param {RequestInit} [opts] - fetch options
 * @param {number} [thresholdMs=500] - log if total exceeds this
 * @returns {Promise<Response>} the original Response (body already consumed
 *   internally -- callers get a new Response wrapping the parsed body)
 */
export async function profiledFetch(label, url, opts, thresholdMs = 500) {
  if (!PROFILING_ENABLED) return fetch(url, opts);

  const t0 = performance.now();
  const response = await fetch(url, opts);
  const ttfb = performance.now() - t0;

  // Clone so the caller can still read the body
  const cloned = response.clone();

  // Read body to measure body transfer time
  const tBody0 = performance.now();
  try {
    await cloned.text();
  } catch {
    /* body read failed; still report what we have */
  }
  const bodyTime = performance.now() - tBody0;
  const total = performance.now() - t0;

  const totalRound = Math.round(total);
  if (totalRound >= thresholdMs) {
    // eslint-disable-next-line no-console
    console.warn(
      `[TIMING] fetch:${label} total=${totalRound}ms ttfb=${Math.round(ttfb)}ms body=${Math.round(bodyTime)}ms url=${typeof url === 'string' ? url.split('?')[0] : url}`
    );
  }

  // Also create a User Timing measure for DevTools visibility
  const markStart = `fetch:${label}:start`;
  const markEnd = `fetch:${label}:end`;
  try {
    performance.mark(markStart, { startTime: t0 });
    performance.mark(markEnd);
    performance.measure(`fetch:${label}`, markStart, markEnd);
    performance.clearMarks(markStart);
    performance.clearMarks(markEnd);
  } catch {
    /* timing API unavailable */
  }

  return response;
}
