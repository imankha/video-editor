import { EXPORT_PROGRESS } from '../config/displayNames';

/**
 * T9540 (N37): map a backend export-progress payload to honest user copy.
 *
 * The render pipeline emits engineering strings ("Detecting players", "frame 150/180",
 * "Processing frames...") as the WS `message`, and several of them are baked into the
 * Modal image (which needs a redeploy to change). Rather than rename them at 6+ sources,
 * we map the STABLE backend `phase` (from `make_progress_data`, the single payload
 * builder) to the four N37 phrases on the client — the same pattern uploadPresentation.js
 * uses for the upload states. A phase we don't recognize falls back to keyword-matching
 * the raw message, and a truly unknown one shows the raw message (no worse than today).
 *
 * T12120: counters ("150/180") are never shown; the bar already shows percent.
 *
 * Pure and side-effect-free so it can be unit-tested and called from any render.
 *
 * @param {string} [phase]   backend phase field (init/download/processing/upload/...)
 * @param {string} [message] raw backend message (used for fallback inference)
 * @param {string} [type]    export type ('framing' | 'overlay'); overlay renders as the spotlight job
 * @returns {{ primary: string } | null} null when there's nothing to show
 */
export function exportProgressLabel(phase, message, type) {
  const p = (phase || '').toLowerCase();
  const msg = message || '';

  let primary = PHASE_TO_COPY[p] || null;

  // Fallback: unknown/absent phase — infer from the message keywords so legacy or
  // ad-hoc phases still read cleanly.
  if (!primary) primary = inferFromMessage(msg);

  // Last resort: show the raw message rather than nothing (never worse than pre-T9540).
  if (!primary) {
    const trimmed = msg.trim();
    return trimmed ? { primary: trimmed } : null;
  }

  if (type === 'overlay' && primary === EXPORT_PROGRESS.RENDERING) {
    primary = EXPORT_PROGRESS.RENDERING_SPOTLIGHT;
  }
  return { primary };
}

// Stable backend phases (app/constants.py ExportPhase + the ad-hoc progress_callback
// phases used across the export routers / local_processors / Modal functions).
const PHASE_TO_COPY = {
  init: EXPORT_PROGRESS.PREPARING,
  queued: EXPORT_PROGRESS.PREPARING,
  validating: EXPORT_PROGRESS.PREPARING,
  download: EXPORT_PROGRESS.PREPARING,
  downloading: EXPORT_PROGRESS.PREPARING,
  upload: EXPORT_PROGRESS.UPLOADING,
  uploading: EXPORT_PROGRESS.UPLOADING,
  processing: EXPORT_PROGRESS.RENDERING,
  modal_processing: EXPORT_PROGRESS.RENDERING,
  rendering: EXPORT_PROGRESS.RENDERING,
  analyzing: EXPORT_PROGRESS.RENDERING,
  upscaling: EXPORT_PROGRESS.ENHANCING,
  ai_upscale: EXPORT_PROGRESS.ENHANCING,
  detecting_players: EXPORT_PROGRESS.UPLOADING,
};

function inferFromMessage(message) {
  const m = message.toLowerCase();
  if (!m) return null;
  if (m.includes('detect') || m.includes('player')) return EXPORT_PROGRESS.UPLOADING;
  if (m.includes('upload')) return EXPORT_PROGRESS.UPLOADING;
  if (m.includes('download') || m.includes('prepar') || m.includes('validat') || m.includes('hash')) {
    return EXPORT_PROGRESS.PREPARING;
  }
  if (m.includes('upscal')) return EXPORT_PROGRESS.ENHANCING;
  if (m.includes('render') || m.includes('process') || m.includes('frame') || m.includes('encod')) {
    return EXPORT_PROGRESS.RENDERING;
  }
  if (m.includes('starting')) return EXPORT_PROGRESS.PREPARING;
  return null;
}
