import { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Check, X, ChevronUp, ChevronDown, Loader, Clock } from 'lucide-react';
import { useExportStore } from '../stores/exportStore';
import { toast } from './shared';
import { ExportStatus } from '../constants/exportStatus';
import { useWebShare } from '../hooks/useWebShare';
import { track } from '../utils/analytics';
import { EXPORT_JOBS, EXPORT_PROGRESS } from '../config/displayNames';
import { exportProgressLabel } from '../utils/exportProgressPresentation';
import { ExportTooLargeModal } from './ExportTooLargeModal';

/**
 * T9540: resolve the stage vocabulary for an export by its `type` ('framing' | 'overlay').
 * Annotate/unknown types have no render-stage vocabulary — callers fall back to generic copy.
 */
function jobVocab(exp) {
  return EXPORT_JOBS[exp?.type] || null;
}

/**
 * T9540 (N37): the honest progress line for an export row — friendly phase copy with the
 * optional counter as secondary detail (e.g. "Rendering · 150/180"). Falls back to a plain
 * "Processing..." only when there's truly nothing to show.
 */
function progressLine(exp) {
  const resolved = exportProgressLabel(exp?.progress?.phase, exp?.progress?.message);
  if (!resolved) return 'Processing...';
  return resolved.detail ? `${resolved.primary} · ${resolved.detail}` : resolved.primary;
}

// T8510: honesty rules for the linear ETA extrapolation below. Once an estimate's
// promised completion time has passed by this grace period, the number is a lie -
// switch to stage wording instead of a frozen countdown.
export const ETA_BUST_GRACE_MS = 15000;
// T8510: "Less than a minute" is never shown while percent has been frozen this long.
export const ETA_STALL_MS = 30000;

/**
 * Get display label for an export.
 * For annotate exports, shows game name. For others, shows project name.
 * T8510: the record now carries the reel name from the export click
 * (exportStore.startExport); the fallback is a safety net and must never
 * surface an internal id.
 */
export function getExportLabel(exp) {
  if (exp.type === 'annotate') {
    return exp.gameName || 'Annotation';
  }
  return exp.projectName || 'Your reel';
}

/**
 * Calculate ETA for an export based on elapsed time and progress.
 * Returns null if not enough data to estimate.
 *
 * @param {Object} exp - Export object with startedAt and progress
 * @returns {{ seconds: number, formatted: string } | null}
 */
export function calculateETA(exp) {
  if (!exp.startedAt || !exp.progress?.percent) return null;

  const percent = exp.progress.percent;
  // Need at least 5% progress to have a meaningful estimate
  if (percent < 5 || percent >= 100) return null;

  const startedAt = new Date(exp.startedAt).getTime();
  const now = Date.now();
  const elapsedMs = now - startedAt;

  // Calculate remaining time: elapsed * (remaining / completed)
  const remainingPercent = 100 - percent;
  const remainingMs = (elapsedMs / percent) * remainingPercent;
  const remainingSeconds = Math.round(remainingMs / 1000);

  // Format the time remaining
  let formatted;
  if (remainingSeconds < 60) {
    formatted = 'Less than a minute';
  } else if (remainingSeconds < 120) {
    formatted = 'About 1 minute';
  } else if (remainingSeconds < 3600) {
    const minutes = Math.round(remainingSeconds / 60);
    formatted = `About ${minutes} minutes`;
  } else {
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.round((remainingSeconds % 3600) / 60);
    formatted = minutes > 0 ? `${hours}h ${minutes}m` : `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  return { seconds: remainingSeconds, formatted };
}

/**
 * T8510: decide what the ETA slot should show, honestly.
 *
 * Pure derivation from timestamps (no persistence): `deadlines` maps exportId to
 * the epoch-ms completion time the FIRST estimate promised, `percentTracks` maps
 * exportId to { percent, changedAt } for stall detection. Both are component-local
 * bookkeeping (refs), updated in an effect as progress arrives.
 *
 * Returns null (no trustworthy estimate — too little data), or { stale, formatted,
 * fallbackText }:
 * - stale=false: the live estimate holds (`formatted`)
 * - stale=true: the estimate broke its promise (deadline exceeded by ETA_BUST_GRACE_MS)
 *   or percent has been frozen past ETA_STALL_MS while the estimate reads under a minute.
 *
 * T9900: consumers now render the estimate slot via `etaSlotText`, which shows a number
 * only when stale=false and otherwise the honest "Time remaining varies." fallback — the
 * real stage line (`progressLine`) is rendered on its OWN line alongside it. `fallbackText`
 * (the stage copy) is retained on the return object for T8510's direct unit tests.
 */
export function resolveEtaDisplay(exp, now, deadlines, percentTracks) {
  const eta = calculateETA(exp);
  if (!eta) return null;

  const deadline = deadlines.get(exp.exportId);
  const track = percentTracks.get(exp.exportId);

  const pastPromise = deadline != null && now > deadline + ETA_BUST_GRACE_MS;
  const stalledUnderMinute = eta.seconds < 60 &&
    track != null && (now - track.changedAt) > ETA_STALL_MS;

  return {
    stale: pastPromise || stalledUnderMinute,
    formatted: eta.formatted,
    // T9540: honest stage copy (not the raw engineering message) when the estimate busts.
    fallbackText: progressLine(exp),
  };
}

/**
 * T9900: the honest text for the estimate slot — never blank, never a frozen/fabricated
 * countdown. A trustworthy live estimate reads "About 1 minute remaining"; anything else
 * (too little data yet — `display` is null — or an estimate that broke its own promise —
 * `display.stale`) reads the "Time remaining varies." fallback. The real stage line always
 * renders alongside this, so the user still sees what is happening.
 */
export function etaSlotText(display) {
  if (!display || display.stale) return EXPORT_PROGRESS.ETA_VARIES;
  return `${display.formatted} remaining`;
}

/**
 * GlobalExportIndicator - Persistent indicator for active exports
 *
 * TRUE MVC ARCHITECTURE:
 * - Store is populated from backend via useExportRecovery on app load
 * - WebSocket pushes real-time updates to store
 * - This component simply renders what's in the store
 * - NO polling/sync needed - WebSocket handles everything
 *
 * @see PARALLEL_EXPORT_PLAN.md for architecture details
 */

// Module-level Set — persists across StrictMode remounts and shared across all instances
const toastedExports = new Set();

export function GlobalExportIndicator() {
  const [isExpanded, setIsExpanded] = useState(false);
  // T11330: exportIds whose over-budget popup the user has dismissed (local, session-scoped).
  const [dismissedBudgetIds, setDismissedBudgetIds] = useState(() => new Set());
  const { isMobile, share, copyLink } = useWebShare();

  // Get export state from store (updated via WebSocket)
  const activeExports = useExportStore((state) => state.activeExports);
  const removeExport = useExportStore((state) => state.removeExport);

  // Filter to get only processing exports
  const processingExports = Object.values(activeExports).filter(
    (exp) => exp.status === ExportStatus.PENDING || exp.status === ExportStatus.PROCESSING
  );

  // T8510: display-only ETA-honesty bookkeeping (never persisted).
  // etaDeadlinesRef: exportId -> epoch-ms deadline the first estimate promised.
  // percentChangeRef: exportId -> { percent, changedAt } for stall detection.
  // nowTick re-renders once a second while exports run, so a stalled export
  // (no store updates) still gets its frozen estimate re-evaluated.
  const etaDeadlinesRef = useRef(new Map());
  const percentChangeRef = useRef(new Map());
  const [nowTick, setNowTick] = useState(() => Date.now());
  const hasProcessingExports = processingExports.length > 0;

  useEffect(() => {
    if (!hasProcessingExports) return undefined;
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [hasProcessingExports]);

  useEffect(() => {
    const deadlines = etaDeadlinesRef.current;
    const tracks = percentChangeRef.current;
    const now = Date.now();
    for (const exp of Object.values(activeExports)) {
      if (exp.status !== ExportStatus.PENDING && exp.status !== ExportStatus.PROCESSING) continue;
      const percent = exp.progress?.percent;
      const track = tracks.get(exp.exportId);
      if (!track || track.percent !== percent) {
        tracks.set(exp.exportId, { percent, changedAt: now });
      }
      if (!deadlines.has(exp.exportId)) {
        const eta = calculateETA(exp);
        if (eta) deadlines.set(exp.exportId, now + eta.seconds * 1000);
      }
    }
    for (const id of [...deadlines.keys()]) {
      if (!activeExports[id]) deadlines.delete(id);
    }
    for (const id of [...tracks.keys()]) {
      if (!activeExports[id]) tracks.delete(id);
    }
  }, [activeExports]);

  // Show toast notification when export completes (exactly once per export)
  useEffect(() => {
    Object.values(activeExports).forEach((exp) => {
      if (exp.status !== ExportStatus.COMPLETE && exp.status !== ExportStatus.ERROR) return;
      if (toastedExports.has(exp.exportId)) return;

      // Only toast for recent completions (not old ones from store hydration)
      const completedTime = new Date(exp.completedAt).getTime();
      if (Date.now() - completedTime > 10000) return;

      // Mark as toasted BEFORE showing — prevents any re-render race
      toastedExports.add(exp.exportId);

      const projectLabel = getExportLabel(exp);
      if (exp.status === ExportStatus.COMPLETE) {
        const shareAction = exp.outputVideoId ? {
          label: isMobile ? 'Share' : 'Copy Link',
          onClick: async () => {
            try {
              if (isMobile) {
                const filename = `${exp.projectName || projectLabel}-highlight.mp4`;
                const method = await share({
                  downloadId: exp.outputVideoId,
                  title: projectLabel,
                  text: `Check out my ${projectLabel} highlight reel!`,
                  filename,
                });
                track('share_initiated', { method, source: 'toast' });
                if (method === 'clipboard') {
                  toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
                }
              } else {
                await copyLink({ downloadId: exp.outputVideoId });
                track('share_initiated', { method: 'clipboard', source: 'toast' });
                toast.success('Link copied to clipboard', { dedupKey: 'copy-link' });
              }
            } catch (err) {
              if (err.name === 'AbortError') return;
              toast.error('Share failed', { message: err.message });
            }
          },
        } : undefined;
        // T9540 (N21): title names the STAGE that finished (Framing ready / Clip ready);
        // the message names the object instance (the reel/clip name).
        const completeVocab = jobVocab(exp);
        toast.success(completeVocab ? completeVocab.completed : 'Export complete', {
          message: projectLabel,
          action: shareAction,
          duration: 8000,
        });
      } else if (exp.status === ExportStatus.ERROR) {
        // T11330: an over-budget preflight rejection is surfaced by the explanatory
        // ExportTooLargeModal (below), not a toast that scrolls away — skip the generic toast.
        if (exp.budgetRejection) return;
        toast.error('Export failed', {
          message: `${projectLabel} - ${exp.error || 'An error occurred during export'}`,
          duration: 8000,
        });
      }
    });
  }, [activeExports]);

  // Clean up old toasted export IDs
  useEffect(() => {
    const interval = setInterval(() => {
      toastedExports.forEach((id) => {
        if (!activeExports[id]) toastedExports.delete(id);
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [activeExports]);

  // Get the most recent processing export for the mini view
  const primaryExport = processingExports.sort(
    (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
  )[0];

  // Calculate ETA display for primary export (recalculate on progress changes AND
  // on the 1s tick, so a stalled estimate flips to stage wording without new data)
  const primaryETA = useMemo(() => {
    if (!primaryExport) return null;
    return resolveEtaDisplay(primaryExport, nowTick, etaDeadlinesRef.current, percentChangeRef.current);
  }, [primaryExport, nowTick]);

  // T11330: the most recent over-budget-rejected export still awaiting its explanatory
  // popup. The rejected export is ERRORED (not processing), so this must be resolved and
  // rendered BEFORE the "no processing exports" early-return below, or the popup that Bug 58p
  // needs would never appear. Dismissal is tracked locally (the errored row stays in the store
  // so the indicator list still shows the failure) to keep the popup from reappearing.
  const budgetRejectedExport = useMemo(() => {
    const rejected = Object.values(activeExports).filter(
      (exp) => exp.status === ExportStatus.ERROR && exp.budgetRejection && !dismissedBudgetIds.has(exp.exportId)
    );
    if (rejected.length === 0) return null;
    return rejected.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
  }, [activeExports, dismissedBudgetIds]);

  const budgetModal = budgetRejectedExport ? (
    <ExportTooLargeModal
      isOpen
      rejection={budgetRejectedExport.budgetRejection}
      projectName={getExportLabel(budgetRejectedExport)}
      onDismiss={() => setDismissedBudgetIds((prev) => new Set(prev).add(budgetRejectedExport.exportId))}
    />
  ) : null;

  // Don't render the indicator card if no active exports — but still surface a pending
  // budget-rejection popup (the rejected export is errored, never "processing").
  if (processingExports.length === 0) {
    return budgetModal;
  }

  const handleDismiss = (exportId) => {
    removeExport(exportId);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'complete':
        return <Check className="w-4 h-4 text-green-400" />;
      case 'error':
        return <X className="w-4 h-4 text-red-400" />;
      default:
        return <Loader className="w-4 h-4 text-blue-400 animate-spin" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete':
        return 'bg-green-500/20 border-green-500/50';
      case 'error':
        return 'bg-red-500/20 border-red-500/50';
      default:
        return 'bg-blue-500/20 border-blue-500/50';
    }
  };

  return (
    <>
      {budgetModal}
      <div className="fixed bottom-4 right-4 z-50">
      {/* Main indicator card */}
      <div
        className={`bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden transition-all duration-200 max-w-[calc(100vw-2rem)] ${
          isExpanded ? 'w-80' : 'w-64'
        }`}
      >
        {/* Header - always visible */}
        <div
          className="flex items-center justify-between px-4 py-3 bg-gray-700/50 cursor-pointer hover:bg-gray-700/70"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative shrink-0">
              <Download className="w-5 h-5 text-blue-400" />
              {processingExports.length > 0 && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-white">
                {processingExports.length} Export{processingExports.length !== 1 ? 's' : ''} Active
              </div>
              {primaryExport && (
                // T9900: give the object name, stage, percent and estimate their own lines
                // so they WRAP instead of being ellipsis-clipped on one fixed-width row —
                // the stage and estimate stay readable at 699px and 200% zoom once the
                // announcing toast has dismissed (evidence E19).
                <div className="text-xs text-gray-400 space-y-0.5">
                  <div className="truncate">{getExportLabel(primaryExport)}</div>
                  <div className="break-words">
                    {progressLine(primaryExport)}
                    {primaryExport.progress?.percent >= 0 ? ` · ${primaryExport.progress.percent}%` : ''}
                  </div>
                  <div className="text-gray-500 break-words">{etaSlotText(primaryETA)}</div>
                </div>
              )}
            </div>
          </div>
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          ) : (
            <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" />
          )}
        </div>

        {/* Progress bar for primary export */}
        {primaryExport && (
          <div className="h-1 bg-gray-700 overflow-hidden">
            {primaryExport.progress?.percent >= 0 ? (
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${primaryExport.progress.percent}%` }}
              />
            ) : (
              <div className="h-full bg-blue-500 animate-pulse w-full opacity-50" />
            )}
          </div>
        )}

        {/* Expanded view - list of all exports */}
        {isExpanded && (
          <div className="max-h-64 overflow-y-auto">
            {Object.values(activeExports).map((exp) => (
              <div
                key={exp.exportId}
                className={`px-4 py-3 border-t border-gray-700 ${getStatusColor(exp.status)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {getStatusIcon(exp.status)}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-white">
                        {jobVocab(exp) ? jobVocab(exp).jobNoun : `${exp.type} export`}
                      </div>
                      <div className="text-xs text-gray-400 truncate">
                        {getExportLabel(exp)}
                      </div>
                    </div>
                  </div>
                  {(exp.status === ExportStatus.COMPLETE || exp.status === ExportStatus.ERROR) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDismiss(exp.exportId);
                      }}
                      className="p-1 hover:bg-gray-600 rounded"
                    >
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                {(exp.status === ExportStatus.PENDING || exp.status === ExportStatus.PROCESSING) && (
                  <div className="mt-2">
                    <div className="flex justify-between gap-2 text-xs text-gray-400 mb-1">
                      <span className="min-w-0 break-words">{progressLine(exp)}</span>
                      <span className="shrink-0">{exp.progress?.percent >= 0 ? `${exp.progress.percent}%` : ''}</span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      {exp.progress?.percent >= 0 ? (
                        <div
                          className="h-full bg-blue-500 transition-all duration-300"
                          style={{ width: `${exp.progress.percent}%` }}
                        />
                      ) : (
                        <div className="h-full bg-blue-500 animate-pulse w-full opacity-50" />
                      )}
                    </div>
                    {/* ETA display — the stage message already renders above this row, so
                        the estimate slot carries only an honest remaining time or the
                        "Time remaining varies." fallback (never blank, never frozen). */}
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-500">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span className="min-w-0 break-words">
                        {etaSlotText(resolveEtaDisplay(exp, nowTick, etaDeadlinesRef.current, percentChangeRef.current))}
                      </span>
                    </div>
                  </div>
                )}

                {/* Error message */}
                {exp.status === ExportStatus.ERROR && exp.error && (
                  <div className="mt-2 text-xs text-red-400 truncate">
                    {exp.error}
                  </div>
                )}

                {/* Completion message — N21: name the stage that finished */}
                {exp.status === ExportStatus.COMPLETE && (
                  <div className="mt-2 text-xs text-green-400">
                    {jobVocab(exp) ? jobVocab(exp).completed : 'Completed'} · {new Date(exp.completedAt).toLocaleTimeString()}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      </div>
    </>
  );
}

export default GlobalExportIndicator;
