/**
 * Unified event tracking — Cloudflare Analytics + local breadcrumb buffer.
 *
 * Every track() call appends to a local ring buffer for "Report a problem"
 * debugging context. By default, events also send to Cloudflare Analytics.
 * Pass { debugOnly: true } to skip CF and only buffer locally.
 *
 * Usage:
 *   import { track } from '../utils/analytics';
 *   track('export_started', { type: 'framing' });              // analytics + breadcrumb
 *   track('clip_select', { id: 42 }, { debugOnly: true });     // breadcrumb only
 */

import { useAuthStore } from '../stores/authStore.js';
import { useEditorStore } from '../stores/editorStore.js';
import { useProjectsStore } from '../stores/projectsStore.js';
import { useGamesDataStore } from '../stores/gamesDataStore.js';
import { useProjectDataStore } from '../stores/projectDataStore.js';
import { useVideoStore } from '../stores/videoStore.js';
import { useExportStore } from '../stores/exportStore.js';

const TOKEN = import.meta.env.VITE_CF_ANALYTICS_TOKEN;

// Inject beacon script once on module load — only when token is configured
if (TOKEN && !document.querySelector('[data-cf-beacon]')) {
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.setAttribute('data-cf-beacon', JSON.stringify({ token: TOKEN, spa: true }));
  document.head.appendChild(script);
}

// --- Breadcrumb ring buffer ---
const MAX_ENTRIES = 200;
const _buffer = [];

/**
 * Send a named event. Always buffered locally for bug reports.
 * Sent to Cloudflare Analytics unless debugOnly is true.
 *
 * @param {string} event - Event name (snake_case)
 * @param {Object} [props] - Optional key/value metadata
 * @param {Object} [options]
 * @param {boolean} [options.debugOnly] - If true, buffer only (skip CF analytics)
 */
export function track(event, props = {}, { debugOnly = false } = {}) {
  _buffer.push({
    action: event,
    detail: props,
    ts: new Date().toISOString(),
  });
  while (_buffer.length > MAX_ENTRIES) _buffer.shift();

  // T1515: keep the local breadcrumb (above) for bug reports, but never send an
  // impersonating admin's actions to analytics as if the impersonated user did them.
  if (useAuthStore.getState().impersonator) return;

  if (debugOnly || !TOKEN) return;

  if (window.zaraz?.track) {
    window.zaraz.track(event, props);
    return;
  }

  if (typeof window.__cfBeacon?.send === 'function') {
    window.__cfBeacon.send({ type: 'event', name: event, ...props });
  }
}

/**
 * Get a snapshot of the breadcrumb buffer (newest last).
 */
export function getActionLog() {
  return [..._buffer];
}

// --- Store subscriptions for automatic breadcrumbs ---
let _trackingInstalled = false;

/**
 * Subscribe to key Zustand store changes for automatic breadcrumbs.
 * Call once after app boot.
 */
export function setupActionTracking() {
  if (_trackingInstalled) return;
  _trackingInstalled = true;

  let prevMode = useEditorStore.getState().editorMode;
  useEditorStore.subscribe((state) => {
    if (state.editorMode !== prevMode) {
      track('mode_change', { from: prevMode, to: state.editorMode }, { debugOnly: true });
      prevMode = state.editorMode;
    }
  });

  let prevProjectId = useProjectsStore.getState().selectedProjectId;
  useProjectsStore.subscribe((state) => {
    if (state.selectedProjectId !== prevProjectId) {
      track('project_select', { id: state.selectedProjectId }, { debugOnly: true });
      prevProjectId = state.selectedProjectId;
    }
  });

  let prevGameId = useGamesDataStore.getState().selectedGame?.id ?? null;
  useGamesDataStore.subscribe((state) => {
    const gameId = state.selectedGame?.id ?? null;
    if (gameId !== prevGameId) {
      track('game_select', { id: gameId, name: state.selectedGame?.name }, { debugOnly: true });
      prevGameId = gameId;
    }
  });

  let prevClipId = useProjectDataStore.getState().selectedClipId;
  useProjectDataStore.subscribe((state) => {
    if (state.selectedClipId !== prevClipId) {
      track('clip_select', { id: state.selectedClipId }, { debugOnly: true });
      prevClipId = state.selectedClipId;
    }
  });

  let prevIsPlaying = useVideoStore.getState().isPlaying;
  useVideoStore.subscribe((state) => {
    if (state.isPlaying !== prevIsPlaying) {
      track('video_state', {
        isPlaying: state.isPlaying,
        currentTime: Math.round(state.currentTime * 10) / 10,
      }, { debugOnly: true });
      prevIsPlaying = state.isPlaying;
    }
  });

  let prevExportStatuses = {};
  useExportStore.subscribe((state) => {
    for (const [id, exp] of Object.entries(state.activeExports)) {
      if (prevExportStatuses[id] !== exp.status) {
        track('export_progress', { type: exp.type, status: exp.status }, { debugOnly: true });
        prevExportStatuses[id] = exp.status;
      }
    }
  });
}
