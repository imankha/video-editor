import { forwardRef, useImperativeHandle } from 'react';
import { Download, Loader, AlertCircle, Check } from 'lucide-react';
import { Button, Toggle, ExportProgress } from './shared';
import { HighlightColor, HIGHLIGHT_COLOR_ORDER, HIGHLIGHT_COLOR_LABELS } from '../constants/highlightColors';
import { HighlightEffect } from '../constants/highlightEffects';
import { BuyCreditsModal } from './BuyCreditsModal';

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
  disconnected,
  isFramingMode,
  isDarkOverlay,

  // Clip extraction status
  hasUnextractedClips,
  extractingCount,
  pendingCount,
  hasUnframedClips,
  unframedCount,
  totalExtractedClips,
  isMultiClipMode,

  // Button state
  isButtonDisabled,
  buttonTitle,

  // Toggle values
  includeAudio,
  isHighlightEnabled,

  // Handlers
  onExport,
  onAudioToggle,
  onHighlightEffectTypeChange,
  onHighlightColorChange,

  // Config/labels
  HIGHLIGHT_EFFECT_LABELS,
  EXPORT_CONFIG,
  highlightEffectType,
  highlightColor,

  // T530: Credit system
  showInsufficientCredits,
  onCloseInsufficientCredits,
  // T525: Stripe purchase
  showBuyCredits,
  onOpenBuyCredits,
  onCloseBuyCredits,

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
      {/* Export Settings */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="text-sm font-medium text-gray-300 mb-3">
          {isFramingMode ? 'Framing Settings' : 'Overlay Settings'}
        </div>

        {/* Audio Toggle - Framing mode only */}
        {isFramingMode && (
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
        )}

        {/* Highlight Effect Style - Overlay mode only */}
        {!isFramingMode && (
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Highlight Effect</span>
              <span className="text-xs text-gray-400">
                {!isHighlightEnabled
                  ? 'Enable highlight layer'
                  : HIGHLIGHT_EFFECT_LABELS?.[highlightEffectType] || highlightEffectType}
              </span>
            </div>

            <Toggle
              checked={isDarkOverlay}
              onChange={(checked) => onHighlightEffectTypeChange?.(
                checked ? HighlightEffect.DARK_OVERLAY : HighlightEffect.BRIGHTNESS_BOOST
              )}
              disabled={isCurrentlyExporting || !isHighlightEnabled}
            />
          </div>
        )}

        {/* Highlight Color - Overlay mode with Bright Inside effect only */}
        {!isFramingMode && !isDarkOverlay && (
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Highlight Color</span>
              <span className="text-xs text-gray-400">
                {HIGHLIGHT_COLOR_LABELS[highlightColor] || 'Yellow'}
              </span>
            </div>

            <div className="flex gap-1.5">
              {HIGHLIGHT_COLOR_ORDER.map((color) => {
                const isNone = color === 'none';
                const isColorValue = color && !isNone;
                return (
                  <button
                    key={color}
                    onClick={() => onHighlightColorChange?.(color)}
                    disabled={isCurrentlyExporting || !isHighlightEnabled}
                    className={`
                      w-6 h-6 rounded-full border-2 transition-all
                      flex items-center justify-center
                      ${highlightColor === color
                        ? 'border-white ring-2 ring-white/30'
                        : 'border-gray-600 hover:border-gray-400'}
                      ${(isCurrentlyExporting || !isHighlightEnabled) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
                    `}
                    style={{
                      backgroundColor: isColorValue ? color : 'transparent',
                      backgroundImage: isNone ? 'linear-gradient(135deg, transparent 45%, #ef4444 45%, #ef4444 55%, transparent 55%)' : 'none'
                    }}
                    title={HIGHLIGHT_COLOR_LABELS[color]}
                  >
                    {highlightColor === color && isColorValue && (
                      <Check size={12} className="text-gray-800" strokeWidth={3} />
                    )}
                    {highlightColor === color && isNone && (
                      <Check size={12} className="text-white" strokeWidth={3} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Export Info */}
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
          {isFramingMode
            ? `Renders crop/trim/speed with AI upscaling at ${EXPORT_CONFIG?.targetFps || 30}fps`
            : `Applies highlight overlay (H.264)`
          }
        </div>
      </div>

      {/* T740: Extraction status message removed — extraction merged into framing export */}

      {/* Unframed clips warning - Framing mode only */}
      {isFramingMode && hasUnframedClips && (
        <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-700 rounded p-2 flex items-center gap-2">
          <AlertCircle size={14} />
          <span>
            {isMultiClipMode
              ? (unframedCount === totalExtractedClips
                  ? 'No clips have been framed yet. Add crop keyframes to each clip.'
                  : `${unframedCount} of ${totalExtractedClips} clip${unframedCount > 1 ? 's' : ''} need${unframedCount === 1 ? 's' : ''} framing. Select and add crop keyframes.`)
              : 'Add crop keyframes to frame this clip.'
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
            ? (hasUnframedClips && isMultiClipMode
              ? `Frame Video (${totalExtractedClips - unframedCount}/${totalExtractedClips})`
              : 'Frame Video')
            : 'Add Overlay'
        }
      </Button>

      {/* Progress display when exporting */}
      <ExportProgress
        isExporting={isCurrentlyExporting}
        progress={displayProgress}
        progressMessage={displayMessage}
        label={isFramingMode ? "AI Upscaling" : "Overlay Export"}
      />

      {/* Disconnected state - recoverable, not an error */}
      {disconnected && !error && (
        <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-800 rounded p-2 flex items-center gap-2">
          <Loader size={14} className="animate-spin" />
          <span>Connection lost — export continues on server. Reconnecting...</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Success message */}
      {displayProgress === 100 && !isCurrentlyExporting && (
        <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded p-2">
          Export complete! Video downloaded.
        </div>
      )}

      {/* T525: Buy Credits Modal (merged with insufficient credits info) */}
      {showBuyCredits && (
        <BuyCreditsModal
          onClose={() => { onCloseBuyCredits(); onCloseInsufficientCredits(); }}
          insufficientCredits={showInsufficientCredits}
        />
      )}
    </div>
  );
});

export default ExportButtonView;
