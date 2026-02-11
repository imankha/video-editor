import { forwardRef, useImperativeHandle } from 'react';
import { Download, Loader, AlertCircle } from 'lucide-react';
import { Button, Toggle, ExportProgress } from './shared';

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

  // Config/labels
  HIGHLIGHT_EFFECT_LABELS,
  EXPORT_CONFIG,
  highlightEffectType,

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
                checked ? 'dark_overlay' : 'brightness_boost'
              )}
              disabled={isCurrentlyExporting || !isHighlightEnabled}
            />
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

      {/* Extraction status message - Framing mode only */}
      {isFramingMode && hasUnextractedClips && (
        <div className="text-orange-400 text-sm bg-orange-900/20 border border-orange-800 rounded p-2 flex items-center gap-2">
          <Loader size={14} className="animate-spin" />
          <span>
            {extractingCount > 0
              ? `Extracting ${extractingCount} clip${extractingCount > 1 ? 's' : ''}...`
              : `${pendingCount} clip${pendingCount > 1 ? 's' : ''} waiting for extraction`
            }
          </span>
        </div>
      )}

      {/* Unframed clips warning - Framing mode only */}
      {isFramingMode && !hasUnextractedClips && hasUnframedClips && (
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
          : (isFramingMode ? 'Frame Video' : 'Add Overlay')
        }
      </Button>

      {/* Progress display when exporting */}
      <ExportProgress
        isExporting={isCurrentlyExporting}
        progress={displayProgress}
        progressMessage={displayMessage}
        label={isFramingMode ? "AI Upscaling" : "Overlay Export"}
      />

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
    </div>
  );
});

export default ExportButtonView;
