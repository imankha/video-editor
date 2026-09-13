import { forwardRef, useImperativeHandle, lazy, Suspense } from 'react';
import { Download, Loader, AlertCircle } from 'lucide-react';
import ActionBand from './ActionBand';
import PrimaryCta from './PrimaryCta';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));
import { SECTION_NAMES, EXPORT_JOBS, CREDITS } from '../config/displayNames';
import { HIGH_FPS_THRESHOLD } from '../constants/exportFps';
import { formatLength, PRECISION } from '../utils/timeFormat';

/**
 * ExportButtonView - Pure presentational component for export UI
 *
 * This component follows the MVC pattern:
 * - Screen: owns hooks and data fetching
 * - Container: handles state logic, event handlers, business logic
 * - View: presentational only, receives props (this component)
 *
 * @param {Object} props - All state and handlers from ExportButtonContainer
 */
const ExportButtonView = forwardRef(function ExportButtonView({
  // Display state
  isCurrentlyExporting,
  isExporting,
  // T9540: isExternallyExporting no longer changes the CTA copy (one stage, one label from
  // EXPORT_JOBS) — the container still owns the external-vs-own distinction for other state.
  displayProgress,
  error,
  failedExport,
  disconnected,
  reconnectionFailed,
  retrying,
  isFramingMode,

  // Clip status
  hasUnframedClips,
  unframedCount,
  totalExtractedClips,
  isMultiClipMode,

  // Button state
  isButtonDisabled,
  buttonTitle,

  // Handlers
  onExport,
  onRetryConnection,
  onDismissExport,

  // T530: Credit system
  showInsufficientCredits,
  onCloseInsufficientCredits,
  // T5790: pre-flight credit-cost estimate (Framing only)
  estimatedCredits = null,
  // T9480: the exact seconds behind estimatedCredits (AC3 disclosure)
  estimatedSeconds = null,
  insufficientForEstimate = false,
  creditBalance = 0,
  // T8280: source fps, for the high-fps 30fps-choice note (Option B-simple)
  sourceFps = null,
  // T525/T526: Stripe purchase
  showBuyCredits,
  onCloseBuyCredits,
  onPaymentSuccess,

  // Refs for external triggering
  handleExportRef,
}, ref) {

  // Expose triggerExport method to parent via ref
  useImperativeHandle(ref, () => ({
    triggerExport: () => handleExportRef?.current?.(),
    isExporting,
    isCurrentlyExporting
  }), [isExporting, isCurrentlyExporting, handleExportRef]);

  // T9270: the export UI is now a full-width ActionBand. The primary CTA is the one
  // saturated element (centered, fixed 56px box — never resizes with the rail). The
  // LEFT status cell carries progress / failed-retry / disabled-reason (preserving
  // T8510's "reason next to the button" property); the RIGHT cost cell carries the
  // credit estimate + high-fps note. The Focus audio toggle + build blurb now live in
  // the settings rail's Reel group (desktop) / mobile drawer, not in this component.

  // T9540: button / in-progress copy resolve from the ONE EXPORT_JOBS table, keyed on
  // the export stage (framing = AI Focus render, overlay = effects render), so the button
  // names the same object+stage as the job list, toast and completion message.
  const job = EXPORT_JOBS[isFramingMode ? 'framing' : 'overlay'];

  const ctaLabel = isCurrentlyExporting
    ? job.inProgress
    : isFramingMode
      ? (hasUnframedClips && isMultiClipMode && totalExtractedClips > 1
        ? `${job.action} (${totalExtractedClips - unframedCount}/${totalExtractedClips})`
        : job.action)
      : job.action;

  // LEFT status cell — progress / disconnected / error / failed / success / disabled
  // reason. Rendered in priority order but each independent block is preserved so the
  // existing testids and copy are byte-identical.
  const statusCell = (
    <>
      {/* Unframed clips warning + disabled reason (T8510) */}
      {isFramingMode && hasUnframedClips && !isCurrentlyExporting && (
        <div
          data-testid="export-unframed-caption"
          className="flex items-center gap-1.5 text-xs text-amber-400"
        >
          <AlertCircle size={12} className="shrink-0" />
          <span>
            {(isMultiClipMode && totalExtractedClips > 1
              ? 'Set at least one focus point on every clip to export'
              : 'Set at least one focus point to export')}
          </span>
        </div>
      )}

      {/* Disconnected state - recoverable, not an error */}
      {disconnected && !error && (
        <div className="text-amber-400 text-xs bg-amber-900/20 border border-amber-800 rounded p-2 w-full">
          {reconnectionFailed ? (
            <>
              <div className="flex items-center gap-2">
                <Loader size={14} className="animate-spin" />
                <span>Monitoring export via server polling...</span>
              </div>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={onRetryConnection}
                  disabled={retrying}
                  className="px-3 py-1 text-xs bg-amber-800/50 hover:bg-amber-700/50 border border-amber-700 rounded transition-colors disabled:opacity-50 flex items-center gap-1.5"
                >
                  {retrying && <Loader size={10} className="animate-spin" />}
                  {retrying ? 'Checking...' : 'Check status'}
                </button>
                <button
                  onClick={onDismissExport}
                  className="px-3 py-1 text-xs bg-gray-800/50 hover:bg-gray-700/50 border border-gray-600 rounded transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Loader size={14} className="animate-spin" />
                <span>Connection lost — export continues on server. Reconnecting...</span>
              </div>
              <button
                onClick={onRetryConnection}
                disabled={retrying}
                className="mt-2 px-3 py-1 text-xs bg-amber-800/50 hover:bg-amber-700/50 border border-amber-700 rounded transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {retrying && <Loader size={10} className="animate-spin" />}
                {retrying ? 'Checking...' : 'Retry connection'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded p-2 w-full">
          {error}
        </div>
      )}

      {/* Persistent failed export from store (survives navigation) */}
      {!error && failedExport && (
        <div className="text-orange-400 text-xs bg-orange-900/20 border border-orange-800 rounded p-2 w-full">
          Export failed: {failedExport.error || 'Unknown error'}
        </div>
      )}

      {/* Success message — N21: names the stage that finished (AI Focus / Clip) */}
      {displayProgress === 100 && !isCurrentlyExporting && (
        <div className="text-green-400 text-xs bg-green-900/20 border border-green-800 rounded p-2 w-full">
          {`${job.completed}. Find it in ${SECTION_NAMES.LIBRARY}.`}
        </div>
      )}
    </>
  );

  // RIGHT cost cell — credit estimate + high-fps note (Framing only), or the
  // T9540/Q1 backend-confirmed free-cost caption (Overlay effects render is $0).
  const costCell = (
    <>
      {/* T9540 (Q1): the effects render charges zero credits — say so honestly. */}
      {!isFramingMode && !isCurrentlyExporting && (
        <div
          data-testid="export-free-cost-note"
          className="flex items-center gap-1.5 text-xs text-gray-400"
        >
          <span>{EXPORT_JOBS.overlay.costNote}</span>
        </div>
      )}

      {/* T5790: pre-flight credit-cost estimate — Framing only. */}
      {isFramingMode && !isCurrentlyExporting && estimatedCredits != null && (
        <div
          data-testid="export-credit-estimate"
          className={`flex items-center gap-1.5 text-xs ${
            insufficientForEstimate ? 'text-amber-400' : 'text-gray-400'
          }`}
        >
          {insufficientForEstimate && <AlertCircle size={12} />}
          <span>
            {`~${estimatedCredits} credit${estimatedCredits === 1 ? '' : 's'} · balance ${creditBalance}`}
            {insufficientForEstimate ? ' — add credits to export' : ''}
          </span>
        </div>
      )}

      {/* T9480 (AC3): a second, muted disclosure line — ONLY when rounding
          actually changed the number, i.e. the whole-second reading differs
          NUMERICALLY from the tenth-second reading (compared via the 'plain'
          style so "6.0s -> 6" -- same number, no real rounding -- stays
          noise-free, while "6.5s -> 7" gets the disclosure). The disclosed
          integer is never re-derived: it's the SAME estimatedCredits shown above. */}
      {isFramingMode && !isCurrentlyExporting && estimatedCredits != null && estimatedSeconds != null &&
        Number(formatLength(estimatedSeconds, PRECISION.SECOND, { style: 'plain' })) !==
          Number(formatLength(estimatedSeconds, PRECISION.TENTH, { style: 'plain' })) && (
        <div data-testid="export-billable-disclosure" className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>{CREDITS.billableLine(estimatedSeconds, estimatedCredits)}</span>
        </div>
      )}

      {/* T8280: static note when the source is high-fps. */}
      {isFramingMode && !isCurrentlyExporting && estimatedCredits != null &&
        sourceFps != null && sourceFps >= HIGH_FPS_THRESHOLD && (
        <div
          data-testid="export-high-fps-note"
          className="flex items-center gap-1.5 text-xs text-gray-400"
        >
          <span>
            {`Recorded at ${sourceFps}fps — exported at 30fps for a smaller, cheaper file.`}
          </span>
        </div>
      )}
    </>
  );

  return (
    <>
      <ActionBand
        status={statusCell}
        cta={
          <PrimaryCta
            accent={isFramingMode ? 'focus' : 'overlay'}
            icon={isCurrentlyExporting ? Loader : Download}
            iconClassName={isCurrentlyExporting ? 'animate-spin' : ''}
            onClick={onExport}
            disabled={isButtonDisabled}
            title={buttonTitle}
          >
            {ctaLabel}
          </PrimaryCta>
        }
        cost={costCell}
      />

      {/* T525: Buy Credits Modal (merged with insufficient credits info) */}
      {showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            onClose={() => { onCloseBuyCredits(); onCloseInsufficientCredits(); }}
            onPaymentSuccess={onPaymentSuccess}
            insufficientCredits={showInsufficientCredits}
          />
        </Suspense>
      )}
    </>
  );
});

export default ExportButtonView;
