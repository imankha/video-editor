/**
 * Export status constants - must match backend ExportStatus enum in app/constants.py
 */
export const ExportStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

export default ExportStatus;
