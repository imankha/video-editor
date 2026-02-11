import { forwardRef } from 'react';
import ExportButtonView from './ExportButtonView';
import { ExportButtonContainer, HIGHLIGHT_EFFECT_LABELS, EXPORT_CONFIG } from '../containers/ExportButtonContainer';

/**
 * ExportButton component - handles video export with AI upscaling
 *
 * This component follows the MVC pattern:
 * - ExportButtonContainer: All business logic (API calls, state management, validation)
 * - ExportButtonView: Presentational only (renders UI based on props)
 * - ExportButton: Wrapper that combines container + view (for backward compatibility)
 *
 * Behavior varies by mode:
 * - Framing mode: Shows audio toggle, exports and transitions to Overlay mode
 * - Overlay mode: Shows highlight effect toggle, exports final video with download
 *
 * Multi-clip support:
 * - When clips array is provided, exports all clips with transitions
 * - Each clip has its own segments and crop keyframes
 * - Global aspect ratio and transition settings apply to all clips
 */
const ExportButton = forwardRef(function ExportButton({
  videoFile,
  cropKeyframes,
  highlightRegions = [],
  isHighlightEnabled = false,
  segmentData,
  disabled,
  includeAudio,
  onIncludeAudioChange,
  highlightEffectType,
  onHighlightEffectTypeChange,
  editorMode,
  onProceedToOverlay,
  clips = null,
  globalAspectRatio = '9:16',
  globalTransition = null,
  projectId,
  projectName,
  onExportComplete = null,
  onExportStart,
  onExportEnd,
  isExternallyExporting,
  externalProgress,
  saveCurrentClipState = null,
}, ref) {

  // Get all state and handlers from container
  const container = ExportButtonContainer({
    videoFile,
    cropKeyframes,
    highlightRegions,
    isHighlightEnabled,
    segmentData,
    disabled,
    includeAudio,
    onIncludeAudioChange,
    highlightEffectType,
    onHighlightEffectTypeChange,
    editorMode,
    onProceedToOverlay,
    clips,
    globalAspectRatio,
    globalTransition,
    projectId,
    projectName,
    onExportComplete,
    onExportStart,
    onExportEnd,
    isExternallyExporting,
    externalProgress,
    saveCurrentClipState,
  });

  // Render view with container state and handlers
  return (
    <ExportButtonView
      ref={ref}
      // Display state
      isCurrentlyExporting={container.isCurrentlyExporting}
      isExporting={container.isExporting}
      isExternallyExporting={isExternallyExporting}
      displayProgress={container.displayProgress}
      displayMessage={container.displayMessage}
      error={container.error}
      isFramingMode={container.isFramingMode}
      isDarkOverlay={container.isDarkOverlay}
      // Clip extraction status
      hasUnextractedClips={container.hasUnextractedClips}
      extractingCount={container.extractingCount}
      pendingCount={container.pendingCount}
      hasUnframedClips={container.hasUnframedClips}
      unframedCount={container.unframedCount}
      totalExtractedClips={container.totalExtractedClips}
      isMultiClipMode={container.isMultiClipMode}
      // Button state
      isButtonDisabled={container.isButtonDisabled}
      buttonTitle={container.buttonTitle}
      // Toggle values
      includeAudio={includeAudio}
      isHighlightEnabled={isHighlightEnabled}
      highlightEffectType={highlightEffectType}
      // Handlers
      onExport={container.handleExport}
      onAudioToggle={container.handleAudioToggle}
      onHighlightEffectTypeChange={onHighlightEffectTypeChange}
      // Config/labels
      HIGHLIGHT_EFFECT_LABELS={HIGHLIGHT_EFFECT_LABELS}
      EXPORT_CONFIG={EXPORT_CONFIG}
      // Refs
      handleExportRef={container.handleExportRef}
    />
  );
});

export default ExportButton;
