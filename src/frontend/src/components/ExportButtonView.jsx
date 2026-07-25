import { forwardRef, useImperativeHandle, lazy, Suspense } from 'react';
import { Download, Loader, AlertCircle } from 'lucide-react';
import { Button, Toggle } from './shared';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));
import { SECTION_NAMES } from '../config/displayNames';

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
  isExternallyExporting,
  displayProgress,
  displayMessage,
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

  // Toggle values
  includeAudio,

  // Handlers
  onExport,
  onRetryConnection,
  onDismissExport,
  onAudioToggle,

  // Config/labels
  EXPORT_CONFIG,

  // T530: Credit system
  showInsufficientCredits,
  onCloseInsufficientCredits,
  // T525/T526: Stripe purchase
  showBuyCredits,
  onOpenBuyCredits,
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

  return (
    <div className="space-y-3">
      {/* Framing Settings — Overlay tuning lives in <OverlaySettingsCard> now (T5676),
          rendered beside the aspect-fit video by OverlayModeView. */}
      {isFramingMode && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
          <div className="text-sm font-medium text-gray-300 mb-3">Framing Settings</div>

          {/* Audio Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Audio</span>
              <span className="text-xs text-gray-400">
                {includeAudio ? 'Include audio in export' : 'Export video only'}
              </span>
            </div>
            <Toggle
              checked={includeAudio}
              onChange={onAudioToggle}
              disabled={isCurrentlyExporting}
            />
          </div>

          {/* Export Info */}
          <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
            {`Renders crop/trim/speed with AI upscaling at ${EXPORT_CONFIG?.targetFps || 30}fps`}
          </div>
        </div>
      )}

      {/* T740: Extraction status message removed — extraction merged into framing export */}

      {/* Unframed clips warning - Framing mode only */}
      {isFramingMode && hasUnframedClips && (
        <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-700 rounded p-2 flex items-center gap-2">
          <AlertCircle size={14} />
          <span>
            {isMultiClipMode
              ? (unframedCount === totalExtractedClips
                  ? (totalExtractedClips === 1
                      ? 'This clip has not been framed yet.'
                      : 'No clips have been framed yet.')
                  : `${unframedCount} of ${totalExtractedClips} clip${unframedCount > 1 ? 's' : ''} need${unframedCount === 1 ? 's' : ''} framing. Select and add crop keyframes.`)
              : 'This clip has not been framed yet.'
            }
          </span>
        </div>
      )}

      {/* Single Export button for both modes */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        icon={isCurrentlyExporting ? Loader : Download}
        onClick={onExport}
        disabled={isButtonDisabled}
        className={isCurrentlyExporting ? '[&>svg]:animate-spin' : ''}
        title={buttonTitle}
      >
        {isCurrentlyExporting
          ? (isExternallyExporting && !isExporting ? 'Export in progress...' : 'Exporting...')
          : isFramingMode
            ? (hasUnframedClips && isMultiClipMode && totalExtractedClips > 1
              ? `Export (${totalExtractedClips - unframedCount}/${totalExtractedClips})`
              : 'Export')
            : 'Add Spotlight'
        }
      </Button>

      {/* Disconnected state - recoverable, not an error */}
      {disconnected && !error && (
        <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-800 rounded p-2">
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
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Persistent failed export from store (survives navigation) */}
      {!error && failedExport && (
        <div className="text-orange-400 text-sm bg-orange-900/20 border border-orange-800 rounded p-2">
          Export failed: {failedExport.error || 'Unknown error'}
        </div>
      )}

      {/* Success message */}
      {displayProgress === 100 && !isCurrentlyExporting && (
        <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded p-2">
          {`Export complete! View in ${SECTION_NAMES.LIBRARY}.`}
        </div>
      )}

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
    </div>
  );
});

export default ExportButtonView;
