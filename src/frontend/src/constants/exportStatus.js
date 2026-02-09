/**
 * Export status constants - must match backend ExportStatus enum in app/constants.py
 */
export const ExportStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * Export phase constants - must match backend ExportPhase enum in app/constants.py
 *
 * SINGLE SOURCE OF TRUTH: Status is derived from phase.
 * - COMPLETE/DONE → ExportStatus.COMPLETE
 * - ERROR → ExportStatus.ERROR
 * - All others → ExportStatus.PROCESSING
 */
export const ExportPhase = {
  INIT: 'init',
  DOWNLOAD: 'download',
  PROCESSING: 'processing',
  UPLOAD: 'upload',
  FINALIZING: 'finalizing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/**
 * Derive ExportStatus from a phase string. Single source of truth.
 * @param {string} phase - The export phase
 * @returns {string} - The derived ExportStatus
 */
export function phaseToStatus(phase) {
  if (phase === ExportPhase.COMPLETE || phase === 'done') {
    return ExportStatus.COMPLETE;
  } else if (phase === ExportPhase.ERROR) {
    return ExportStatus.ERROR;
  } else {
    return ExportStatus.PROCESSING;
  }
}

/**
 * Check if a phase indicates terminal state (complete or error).
 * @param {string} phase - The export phase
 * @returns {boolean}
 */
export function isTerminalPhase(phase) {
  return phase === ExportPhase.COMPLETE || phase === 'done' || phase === ExportPhase.ERROR;
}

export default ExportStatus;
