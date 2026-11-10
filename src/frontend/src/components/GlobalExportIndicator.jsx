import { useState, useEffect, useMemo, useRef } from 'react';
import { Download, Check, X, ChevronUp, ChevronDown, Loader, Clock } from 'lucide-react';
import { useExportStore } from '../stores/exportStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { toast } from './shared';
import { ExportStatus } from '../constants/exportStatus';
import { useWebShare } from '../hooks/useWebShare';
import { track } from '../utils/analytics';
import { EXPORT_JOBS, EXPORT_PROGRESS, ERROR_COPY, SHARE_COPY } from '../config/displayNames';
import { exportProgressLabel } from '../utils/exportProgressPresentation';
import { ExportTooLargeModal } from './ExportTooLargeModal';
import { exportFailureCopy, userErrorMessage } from '../utils/userError';

/**
 * T9540: resolve the stage vocabulary for an export by its `type` ('framing' | 'overlay').
 * Annotate/unknown types have no render-stage vocabulary — callers fall back to generic copy.
 */
function jobVocab(exp) {
  return EXPORT_JOBS[exp?.type] || null;
}

/**
 * T9540 (N37): the honest progress line for an export row, friendly phase copy only
 * (T12120: no counter; the bar already shows percent). Falls back to a plain
 * "Processing..." only when there's truly nothing to show.
 */
function progressLine(exp) {
  const resolved = exportProgressLabel(exp?.progress?.phase, exp?.progress?.message, exp?.type);
  return resolved ? resolved.primary : 'Processing...';
}

// T8510: honesty rules for the linear ETA extrapolation below. Once an estimate's
// promised completion time has passed by this grace period, the number is a lie -
// switch to stage wording instead of a frozen countdown.
export const ETA_BUST_GRACE_MS = 15000;
// T8510: a near-done estimate is never shown while percent has been frozen this long.
export const ETA_STALL_MS = 30000;

// T14860: measured 2026-11-03 sample (encode 2.5s + upload 4.1s + detect-players 19.7s =
// 26.3s), rounded up -- the fixed tail added after the AI-upscale frame loop ends, since
// those phases don't report their own frame counts. Static approximation until there are
// enough completed jobs to track a real rolling median server-side.
export const POST_UPSCALE_TAIL_SECONDS = 30;

// T14860: the only phases that report a numeric "frame i/N" count are the AI-upscale
// loop (both single-clip "AI upscaling frame X/Y" and multi-clip "Clip N: frame X/Y" --
// see app/modal_functions/video_processing.py). Before this appears, progress is not
// evenly paced (init/download/model-load vary wildly), so there is nothing honest to
// extrapolate from yet.
function parseFrameProgress(message) {
  const match = /(\d+)\s*\/\s*(\d+)/.exec(message || '');
  if (!match) return null;
  const frame = parseInt(match[1], 10);
  const totalFrames = parseInt(match[2], 10);
  if (!totalFrames || frame <= 0) return null;
  return { frame, totalFrames };
}

/**
 * Get display label for an export.
 * For annotate exports, shows game name. For others, shows project name.
 * T8510: the record now carries the reel name from the export click
 * (exportStore.startExport); the fallback is a safety net and must never
 * surface an internal id.
 */
export function getExportLabel(exp) {
  if (exp.type === 'annotate') {
    return exp.gameName || 'Play';
  }
  return exp.projectName || 'Your highlight';
}

/**
 * Calculate ETA for an export from the measured per-frame rate of THIS job.
 * Returns null until a frame count has appeared in the message AND a second
 * frame sample has arrived (one sample alone gives no rate to measure).
 *
 * T14860: replaces the old "elapsed * (100-percent)/percent" extrapolation, which
 * assumed every percentage point takes the same wall-clock time -- it does not: the
 * early non-upscale phases (init/download/model-load) take a near-fixed few seconds
 * regardless of clip length, so extrapolating from them at 5% overclaimed "Less than
 * a minute remaining" on an 8s clip that actually took 131s.
 *
 * @param {Object} exp - Export object with startedAt and progress
 * @param {{ frame: number, at: number } | undefined} frameTrack - the FIRST frame
 *   sample seen for this export (fixed once set), so the rate is measured over the
 *   whole observed window rather than just the last tick.
 * @returns {{ seconds: number, formatted: string } | null}
 */
export function calculateETA(exp, frameTrack) {
  if (!exp.startedAt) return null;

  const frameProgress = parseFrameProgress(exp.progress?.message);
  if (!frameProgress || !frameTrack) return null;

  const elapsedSinceFirstMs = Date.now() - frameTrack.at;
  const framesSinceFirst = frameProgress.frame - frameTrack.frame;
  if (framesSinceFirst <= 0 || elapsedSinceFirstMs <= 0) return null;

  const msPerFrame = elapsedSinceFirstMs / framesSinceFirst;
  const remainingFrames = frameProgress.totalFrames - frameProgress.frame;
  if (remainingFrames < 0) return null;

  const remainingMs = remainingFrames * msPerFrame + POST_UPSCALE_TAIL_SECONDS * 1000;
  // Round up to the next 30s -- an honest estimate rounds toward "longer", never shorter.
  const remainingSeconds = Math.ceil(remainingMs / 1000 / 30) * 30;

  return { seconds: remainingSeconds, formatted: formatRemaining(remainingSeconds) };
}

function formatRemaining(seconds) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `About ${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * T8510: decide what the ETA slot should show, honestly.
 *
 * Pure derivation from timestamps (no persistence): `deadlines` maps exportId to
 * the epoch-ms completion time the FIRST estimate promised, `percentTracks` maps
 * exportId to { percent, changedAt } for stall detection, `frameTracks` maps exportId
 * to the FIRST { frame, at } sample seen (T14860, feeds calculateETA's rate). All
 * three are component-local bookkeeping (refs), updated in an effect as progress arrives.
 *
 * Returns null (no trustworthy estimate — too little data, i.e. frames aren't flowing
 * yet), or { stale, formatted, fallbackText }:
 * - stale=false: the live estimate holds (`formatted`)
 * - stale=true: the estimate broke its promise (deadline exceeded by ETA_BUST_GRACE_MS)
 *   or percent has been frozen past ETA_STALL_MS while the estimate reads under a minute.
 *
 * T9900: consumers now render the estimate slot via `etaSlotText`, which shows a number
 * only when stale=false and otherwise the honest "Time remaining varies." fallback — the
 * real stage line (`progressLine`) is rendered on its OWN line alongside it. `fallbackText`
 * (the stage copy) is retained on the return object for T8510's direct unit tests.
 *
 * T15530: `minSecondsTracks` (exportId -> lowest remainingSeconds ever computed for that
 * export) clamps the displayed number so it never climbs back up. `calculateETA` measures
 * its rate as an AVERAGE from the first frame sample to the current one, so a later slowdown
 * can make the recomputed remaining-time read higher than an earlier, truer call did even
 * though less time is actually left — the observed "4, 3, 2, 3, 2 minutes" bug. Optional so
 * existing callers that don't track minimums keep their prior (unclamped) behavior.
 */
export function resolveEtaDisplay(exp, now, deadlines, percentTracks, frameTracks, minSecondsTracks) {
  const eta = calculateETA(exp, frameTracks?.get(exp.exportId));
  if (!eta) return null;

  let { seconds, formatted } = eta;
  if (minSecondsTracks) {
    const priorMin = minSecondsTracks.get(exp.exportId);
    if (priorMin != null && priorMin < seconds) {
      seconds = priorMin;
      formatted = formatRemaining(seconds);
    } else {
      minSecondsTracks.set(exp.exportId, seconds);
    }
  }

  const deadline = deadlines.get(exp.exportId);
  const track = percentTracks.get(exp.exportId);

  const pastPromise = deadline != null && now > deadline + ETA_BUST_GRACE_MS;
  const stalledUnderMinute = seconds < 60 &&
    track != null && (now - track.changedAt) > ETA_STALL_MS;

  return {
    stale: pastPromise || stalledUnderMinute,
    formatted,
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
  // frameTrackRef (T14860): exportId -> the FIRST { frame, at } frame sample seen,
  // fixed once set so calculateETA measures this job's own rate from that point on.
  // etaMinSecondsRef (T15530): exportId -> the lowest remainingSeconds ever computed,
  // so a later rate slowdown can't make the displayed estimate climb back up.
  // nowTick re-renders once a second while exports run, so a stalled export
  // (no store updates) still gets its frozen estimate re-evaluated.
  const etaDeadlinesRef = useRef(new Map());
  const percentChangeRef = useRef(new Map());
  const frameTrackRef = useRef(new Map());
  const etaMinSecondsRef = useRef(new Map());
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
    const frameTracks = frameTrackRef.current;
    const now = Date.now();
    for (const exp of Object.values(activeExports)) {
      if (exp.status !== ExportStatus.PENDING && exp.status !== ExportStatus.PROCESSING) continue;
      const percent = exp.progress?.percent;
      const track = tracks.get(exp.exportId);
      if (!track || track.percent !== percent) {
        tracks.set(exp.exportId, { percent, changedAt: now });
      }
      if (!frameTracks.has(exp.exportId)) {
        const frameProgress = parseFrameProgress(exp.progress?.message);
        if (frameProgress) frameTracks.set(exp.exportId, { frame: frameProgress.frame, at: now });
      }
      if (!deadlines.has(exp.exportId)) {
        const eta = calculateETA(exp, frameTracks.get(exp.exportId));
        if (eta) deadlines.set(exp.exportId, now + eta.seconds * 1000);
      }
    }
    for (const id of [...deadlines.keys()]) {
      if (!activeExports[id]) deadlines.delete(id);
    }
    for (const id of [...frameTracks.keys()]) {
      if (!activeExports[id]) frameTracks.delete(id);
    }
    for (const id of [...tracks.keys()]) {
      if (!activeExports[id]) tracks.delete(id);
    }
    const minSecondsTracks = etaMinSecondsRef.current;
    for (const id of [...minSecondsTracks.keys()]) {
      if (!activeExports[id]) minSecondsTracks.delete(id);
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
        // T11970: the completion panel IS the notification when this framing job
        // belongs to the project open in Focus -- a toast would double-announce it.
        if (
          exp.type === 'framing'
          && exp.projectId === useProjectsStore.getState().selectedProjectId
          && useEditorStore.getState().editorMode === EDITOR_MODES.FRAMING
        ) return;
        const shareAction = exp.outputVideoId ? {
          label: isMobile ? 'Share' : SHARE_COPY.COPY_LINK,
          onClick: async () => {
            try {
              if (isMobile) {
                const filename = `${exp.projectName || projectLabel}-highlight.mp4`;
                const method = await share({
                  downloadId: exp.outputVideoId,
                  title: projectLabel,
                  text: `Check out my ${projectLabel} highlight!`,
                  filename,
                });
                track('share_initiated', { method, source: 'toast' });
                if (method === 'clipboard') {
                  toast.success(SHARE_COPY.LINK_COPIED, { dedupKey: 'copy-link' });
                }
              } else {
                await copyLink({ downloadId: exp.outputVideoId });
                track('share_initiated', { method: 'clipboard', source: 'toast' });
                toast.success(SHARE_COPY.LINK_COPIED, { dedupKey: 'copy-link' });
              }
            } catch (err) {
              if (err.name === 'AbortError') return;
              toast.error(userErrorMessage(err, ERROR_COPY.SHARE));
            }
          },
        } : undefined;
        // T9540 (N21): title names the STAGE that finished (Framing ready / Clip ready);
        // the message names the object instance (the reel/clip name).
        const completeVocab = jobVocab(exp);
        toast.success(completeVocab ? completeVocab.completed : 'Highlight generated', {
          message: projectLabel,
          action: shareAction,
          duration: 8000,
        });
      } else if (exp.status === ExportStatus.ERROR) {
        // T11330: an over-budget preflight rejection is surfaced by the explanatory
        // ExportTooLargeModal (below), not a toast that scrolls away — skip the generic toast.
        if (exp.budgetRejection) return;
        console.error('[GlobalExportIndicator] export failed:', exp.error);
        toast.error(exportFailureCopy(exp), { message: projectLabel, duration: 8000 });
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
    return resolveEtaDisplay(primaryExport, nowTick, etaDeadlinesRef.current, percentChangeRef.current, frameTrackRef.current, etaMinSecondsRef.current);
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
      {/* T14230: below lg the editors' action band spans the full width, so the card docks
          ABOVE it (ActionBand / CtaBar publish its height as --cta-bar-h; unset off-editor)
          instead of covering Generate / Add text / Trim. lg+ keeps the bottom-4 slot. */}
      <div className="fixed bottom-4 max-lg:bottom-[calc(var(--cta-bar-h,0px)+1rem)] right-4 z-50" data-testid="global-export-indicator">
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
                {processingExports.length} Highlight{processingExports.length !== 1 ? 's' : ''} Generating
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
                        {jobVocab(exp) ? jobVocab(exp).jobNoun : `${exp.type} generation`}
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
                        {etaSlotText(resolveEtaDisplay(exp, nowTick, etaDeadlinesRef.current, percentChangeRef.current, frameTrackRef.current, etaMinSecondsRef.current))}
                      </span>
                    </div>
                  </div>
                )}

                {/* Error message */}
                {exp.status === ExportStatus.ERROR && exp.error && (
                  <div className="mt-2 text-xs text-red-400 truncate">
                    {exportFailureCopy(exp)}
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
