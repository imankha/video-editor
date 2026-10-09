import { useState } from 'react';
import { useExportStore } from '../../stores/exportStore';

const LIVE = ['pending', 'processing'];

/**
 * T12270: pure export-job status for one project and export type, read from the
 * same exportStore.activeExports source Annotate uses (isFramingExportInProgress).
 * 'processing' | 'failed' | 'complete' | 'none'. In-flight beats a stale error;
 * an error beats a stale complete.
 */
export function exportJobStatus(activeExports, projectId, type) {
  if (projectId == null) return 'none';
  const mine = Object.values(activeExports || {}).filter((e) => String(e.projectId) === String(projectId) && e.type === type);
  if (mine.some((e) => LIVE.includes(e.status))) return 'processing';
  if (mine.some((e) => e.status === 'error')) return 'failed';
  if (mine.some((e) => e.status === 'complete')) return 'complete';
  return 'none';
}

/**
 * Guide job status for a screen: adds 'finishing' (this mount saw the job run and it
 * has completed, but the ready panel is not up yet). Derived in render, never stored
 * to a backend; `sawJob` is memory-only view state (set-during-render, no effect).
 */
export function useExportJobStatus(projectId, type, { ready = false } = {}) {
  const activeExports = useExportStore((s) => s.activeExports);
  const raw = exportJobStatus(activeExports, projectId, type);
  const [sawJob, setSawJob] = useState(false);
  if (raw === 'processing' && !sawJob) setSawJob(true);
  if (ready) return 'ready';
  if (raw === 'complete') return sawJob ? 'finishing' : 'none';
  return raw;
}
