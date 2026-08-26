/**
 * Client-side log ring buffer — captures console.error, console.warn,
 * and console.info so they can be sent to admins via "Report a problem".
 *
 * Install once at app boot (top of main.jsx). The buffer is capped at
 * MAX_ENTRIES to prevent unbounded memory growth.
 *
 * T1650: Report a Problem Button
 */

import { API_BASE } from '../config';
import apiFetch from './apiFetch';

const MAX_ENTRIES = 200;
const _buffer = [];
let _installed = false;

// T7510 frustration-signal tier 2: cap beacon sends so a crash loop can't flood
// the server with one POST per exception. The ring buffer above already keeps
// every entry for the "Report a problem" flow; this cap is only for the
// separate fire-and-forget server beacon.
const MAX_BEACONS_PER_SESSION = 20;
let _beaconCount = 0;

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

  // T7560: capture UNCAUGHT errors too. console.error only fires when our own
  // code logs; a raw runtime exception (mobile Safari JS error, a failed dynamic
  // import) throws to window.onerror / unhandledrejection and otherwise leaves
  // zero trace in a bug report. Push those into the same ring buffer so a
  // "nothing happened" report still carries the exception that caused it.
  if (typeof window !== 'undefined') {
    window.addEventListener('error', (event) => {
      const where = event.filename
        ? ` (${event.filename}:${event.lineno ?? '?'}:${event.colno ?? '?'})`
        : '';
      const detail = event.error?.stack || event.message || 'unknown error';
      const message = `[uncaught] ${detail}${where}`;
      _push('error', [message]);
      _sendClientErrorBeacon(message);
    });

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const detail = reason instanceof Error
        ? (reason.stack || `${reason.name}: ${reason.message}`)
        : String(reason);
      const message = `[unhandledrejection] ${detail}`;
      _push('error', [message]);
      _sendClientErrorBeacon(message);
    });
  }
}

// T7510 frustration-signal tier 2: fire-and-forget POST so an uncaught client
// error lands in SERVER logs even if the user never opens "Report a problem".
// Mirrors uploadManager.js's sendUploadFailureBeacon contract: MUST NEVER throw
// or block, writes to logs only (no DB), keepalive so it survives navigation.
function _sendClientErrorBeacon(message) {
  if (_beaconCount >= MAX_BEACONS_PER_SESSION) return;
  _beaconCount++;
  try {
    apiFetch(`${API_BASE}/api/client-errors/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: message.slice(0, 1000),
        route: typeof location !== 'undefined' ? location.pathname : null,
      }),
      keepalive: true,
    }).catch(() => { /* never let the beacon break anything */ });
  } catch {
    /* never let the beacon break anything */
  }
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
