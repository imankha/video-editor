/**
 * Client-side log ring buffer — captures console.error, console.warn,
 * and console.info so they can be sent to admins via "Report a problem".
 *
 * Install once at app boot (top of main.jsx). The buffer is capped at
 * MAX_ENTRIES to prevent unbounded memory growth.
 *
 * T1650: Report a Problem Button
 */

const MAX_ENTRIES = 200;
const _buffer = [];
let _installed = false;

/**
 * Install console interceptors. Safe to call multiple times
 * (second call is a no-op). Call as early as possible in the app boot
 * so pre-React errors are captured.
 */
export function installClientLogger() {
  if (_installed) return;
  _installed = true;

  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;

  console.error = function (...args) {
    _push('error', args);
    originalError.apply(console, args);
  };

  console.warn = function (...args) {
    _push('warn', args);
    originalWarn.apply(console, args);
  };

  console.info = function (...args) {
    _push('info', args);
    originalInfo.apply(console, args);
  };
}

function _push(level, args) {
  const message = args
    .map(a => {
      if (a instanceof Error) return `${a.name}: ${a.message}`;
      if (typeof a === 'object') {
        try { return JSON.stringify(a); } catch { return String(a); }
      }
      return String(a);
    })
    .join(' ');

  _buffer.push({
    level,
    message: message.slice(0, 1000), // cap individual message length
    ts: new Date().toISOString(),
  });

  // Evict oldest when over cap
  while (_buffer.length > MAX_ENTRIES) _buffer.shift();
}

/**
 * Get a snapshot of the current log buffer (newest last).
 */
export function getClientLogs() {
  return [..._buffer];
}

/**
 * Clear the buffer (e.g. after a successful report).
 */
export function clearClientLogs() {
  _buffer.length = 0;
}
