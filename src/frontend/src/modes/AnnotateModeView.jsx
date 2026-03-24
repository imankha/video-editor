import { useRef } from 'react';
import { Download, Loader } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import ZoomControls from '../components/ZoomControls';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from './annotate';
import { generateClipName } from './annotate/constants/soccerTags';
import { useExportStore } from '../stores';
import { ExportProgress } from '../components/shared';

/**
 * AnnotateModeView - Complete view for Annotate mode
 *
 * This component contains all annotate-specific JSX that was previously in App.jsx.
 * It receives state and handlers as props from App.jsx.
 *
 * @see DECOMPOSITION_ANALYSIS.md for refactoring context
 */
export function AnnotateModeView({
  // Video state
  videoRef,
  annotateVideoUrl,
  annotateVideoMetadata,
  annotateContainerRef,
  currentTime,
  duration,
  isPlaying,
  isLoading = false,
  isVideoElementLoading = false,
  loadingProgress = null,
  loadingElapsedSeconds = 0,
  error = null,
  handlers,

  // Fullscreen state
  annotateFullscreen,
  showAnnotateOverlay,

  // Playback
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,
  annotatePlaybackSpeed,
  onSpeedChange,

  // Clips/regions
  annotateRegionsWithLayout,
  annotateSelectedRegionId,
  hasAnnotateClips,

  // Handlers
  onSelectRegion,
  onDeleteRegion,
  onToggleFullscreen,
  onAddClip,
  getAnnotateRegionAtTime,
  getAnnotateExportData,

  // Fullscreen overlay handlers
  onFullscreenCreateClip,
  onFullscreenUpdateClip,
  onOverlayResume,
  onOverlayClose,

  // Layer selection
  annotateSelectedLayer,
  onLayerSelect,

  // Export state (exportProgress is read directly from store for reactivity)
  isCreatingAnnotatedVideo,
  isUploadingGameVideo,
  uploadProgress,

  // Export handlers
  onCreateAnnotatedVideo,

  // Zoom (for video player)
  zoom,
  panOffset,
  onZoomChange,
  onPanChange,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  MIN_ZOOM,
  MAX_ZOOM,
}) {
  // Read exportProgress directly from store for proper reactivity during SSE updates
  const { exportProgress } = useExportStore();

  // Freeze existingClip when overlay opens so handle dragging (which seeks the
  // playhead in/out of clip regions) doesn't toggle existingClip and reset handles.
  // Must be computed during render (not in useEffect) so it's available on the
  // first render when the overlay appears.
  const frozenExistingClipRef = useRef(null);
  const wasOverlayOpenRef = useRef(false);
  if (showAnnotateOverlay && !wasOverlayOpenRef.current) {
    // Overlay just opened — capture the clip at current playhead, or the selected clip
    frozenExistingClipRef.current = getAnnotateRegionAtTime(currentTime)
      || (annotateSelectedRegionId ? annotateRegionsWithLayout?.find(r => r.id === annotateSelectedRegionId) : null);
  }
  wasOverlayOpenRef.current = showAnnotateOverlay;

  return (
    <>
      {/* Video Metadata - Annotate mode (hidden on mobile) */}
      {annotateVideoMetadata && !annotateFullscreen && (
        <div className="hidden sm:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 sm:p-4 border border-white/20">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-300">
            <span>
              <span className="text-gray-400">Resolution:</span>{' '}
              {annotateVideoMetadata.resolution}
            </span>
            <span>
              <span className="text-gray-400">Format:</span>{' '}
              {annotateVideoMetadata.format?.toUpperCase() || 'MP4'}
            </span>
            <span>
              <span className="text-gray-400">Size:</span>{' '}
              {annotateVideoMetadata.sizeFormatted || `${(annotateVideoMetadata.size / (1024 * 1024)).toFixed(2)} MB`}
            </span>
            {uploadProgress && (
              <span className="flex items-center gap-2 ml-auto">
                <span className="text-blue-400">Uploading… {uploadProgress.percent}%</span>
                <span className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <span
                    className="block h-full bg-blue-500 transition-all duration-300 rounded-full"
                    style={{ width: `${uploadProgress.percent}%` }}
                  />
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* Compact upload indicator when no metadata bar is visible */}
      {uploadProgress && (!annotateVideoMetadata || annotateFullscreen) && (
        <div className="hidden sm:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 sm:p-4 border border-white/20">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-blue-400">Uploading… {uploadProgress.percent}%</span>
            <span className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <span
                className="block h-full bg-blue-500 transition-all duration-300 rounded-full"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </span>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className={`${annotateFullscreen ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-2 sm:p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen and on mobile */}
        {annotateVideoUrl && !annotateFullscreen && (
          <div className="hidden sm:flex mb-6 gap-4 items-center">
            <div className="ml-auto">
              <ZoomControls
                zoom={zoom}
                onZoomIn={onZoomIn}
                onZoomOut={onZoomOut}
                onResetZoom={onResetZoom}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
              />
            </div>
          </div>
        )}

        {/* Fullscreen container - uses fixed positioning for fullscreen */}
        <div
          ref={annotateContainerRef}
          className={`${annotateFullscreen ? 'fixed inset-0 z-[100] bg-gray-900 flex flex-col' : ''}`}
        >
          {/* Video Player with annotate overlays */}
          <div className={`relative bg-gray-900 ${annotateFullscreen ? '' : 'rounded-lg'}`}>
            {/* In fullscreen: aspect-ratio wrapper constrains video height */}
            <div
              className={annotateFullscreen ? 'relative w-full' : 'contents'}
              style={annotateFullscreen ? {
                maxHeight: 'calc(100vh - 180px)',
                aspectRatio: `${annotateVideoMetadata?.width || 16} / ${annotateVideoMetadata?.height || 9}`
              } : undefined}
            >
              <VideoPlayer
                videoRef={videoRef}
                videoUrl={annotateVideoUrl}
                handlers={handlers}
                isLoading={isLoading}
                isVideoElementLoading={isVideoElementLoading}
                loadingProgress={loadingProgress}
                loadingElapsedSeconds={loadingElapsedSeconds}
                error={error}
                loadingMessage="Loading video..."
                overlays={[
                  // NotesOverlay - shows name, rating, notes for region at playhead
                  // Hidden while the Add/Edit Clip panel is open to prevent layout jumps during scrub
                  !showAnnotateOverlay && (() => {
                    const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);
                    if (!regionAtPlayhead) return null;

                    // Derive display name from rating+tags if no explicit name is set
                    const displayName = regionAtPlayhead.name ||
                      generateClipName(regionAtPlayhead.rating, regionAtPlayhead.tags, regionAtPlayhead.notes);

                    return (displayName || regionAtPlayhead.notes) ? (
                      <NotesOverlay
                        key="annotate-notes"
                        name={displayName}
                        notes={regionAtPlayhead.notes}
                        rating={regionAtPlayhead.rating}
                        isVisible={true}
                        isFullscreen={annotateFullscreen}
                      />
                    ) : null;
                  })(),
                  // AnnotateFullscreenOverlay - appears when paused in fullscreen
                  // Uses frozenExistingClipRef so seeking during scrub doesn't toggle edit/create mode
                  showAnnotateOverlay && (() => {
                    return (
                      <AnnotateFullscreenOverlay
                        key="annotate-fullscreen"
                        isVisible={showAnnotateOverlay}
                        currentTime={currentTime}
                        videoDuration={annotateVideoMetadata?.duration || 0}
                        existingClip={frozenExistingClipRef.current}
                        onCreateClip={onFullscreenCreateClip}
                        onUpdateClip={onFullscreenUpdateClip}
                        onResume={onOverlayResume}
                        onClose={onOverlayClose}
                        onSeek={seek}
                        videoRef={videoRef}
                      />
                    );
                  })(),
                ].filter(Boolean)}
                zoom={zoom}
                panOffset={panOffset}
                onZoomChange={onZoomChange}
                onPanChange={onPanChange}
                isFullscreen={annotateFullscreen}
                clipRating={showAnnotateOverlay ? null : (getAnnotateRegionAtTime(currentTime)?.rating ?? null)}
              />
            </div>

            {/* Controls - in flow for both modes, right below video */}
            <div className={annotateFullscreen ? 'w-full shrink-0' : ''}>
              <AnnotateControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={annotateVideoMetadata?.duration || duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
                playbackSpeed={annotatePlaybackSpeed}
                onSpeedChange={onSpeedChange}
                isFullscreen={annotateFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                onAddClip={(!annotateFullscreen && annotateSelectedRegionId) || showAnnotateOverlay ? null : onAddClip}
                isEditMode={annotateFullscreen && !showAnnotateOverlay && !!annotateSelectedRegionId}
                videoRef={videoRef}
              />
            </div>

            {/* Fullscreen timeline - right below controls */}
            {annotateFullscreen && (
              <div className="w-full shrink-0 bg-gray-900/95 border-t border-gray-700 px-4 py-1">
                <AnnotateMode
                  currentTime={currentTime}
                  duration={annotateVideoMetadata?.duration || 0}
                  isPlaying={isPlaying}
                  onSeek={seek}
                  regions={annotateRegionsWithLayout}
                  selectedRegionId={annotateSelectedRegionId}
                  onSelectRegion={onSelectRegion}
                  onDeleteRegion={onDeleteRegion}
                  selectedLayer={annotateSelectedLayer}
                  onLayerSelect={onLayerSelect}
                />
              </div>
            )}
          </div>

          {/* Annotate Mode Timeline - non-fullscreen */}
          {!annotateFullscreen && (
            <div className="mt-6">
              <AnnotateMode
                currentTime={currentTime}
                duration={annotateVideoMetadata?.duration || 0}
                isPlaying={isPlaying}
                onSeek={seek}
                regions={annotateRegionsWithLayout}
                selectedRegionId={annotateSelectedRegionId}
                onSelectRegion={onSelectRegion}
                onDeleteRegion={onDeleteRegion}
                selectedLayer={annotateSelectedLayer}
                onLayerSelect={onLayerSelect}
              />
            </div>
          )}
        </div>

        {/* Export Section - hidden in fullscreen */}
        {!annotateFullscreen && (
        <div className="mt-3 sm:mt-6">
          <div className="space-y-3">
            {/* Export Settings (hidden on mobile) */}
            <div className="hidden sm:block bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
              <div className="text-sm font-medium text-gray-300 mb-3">
                Annotate Settings
              </div>
              <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
                Extracts marked clips and loads them into Framing mode
              </div>
            </div>

            {/* Export buttons */}
            <div className="space-y-2">
              {/* Upload progress bar (shown during video upload) */}
              {uploadProgress && (
                <div className="bg-gray-800 rounded-lg p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">
                      {uploadProgress.message || 'Uploading video...'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {uploadProgress.percent}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${uploadProgress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Progress bar (shown during export) - uses same component as framing/overlay */}
              <ExportProgress
                isExporting={!!exportProgress}
                progress={exportProgress?.total > 0 ? Math.round((exportProgress.current / exportProgress.total) * 100) : 0}
                progressMessage={exportProgress?.message}
                label="Creating Video"
              />

              {/* Create Annotated Video - stays on screen */}
              <button
                onClick={() => onCreateAnnotatedVideo(getAnnotateExportData())}
                disabled={!hasAnnotateClips || isCreatingAnnotatedVideo || isUploadingGameVideo}
                className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  !hasAnnotateClips || isCreatingAnnotatedVideo || isUploadingGameVideo
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                {isUploadingGameVideo ? (
                  <>
                    <Loader className="animate-spin" size={18} />
                    <span>Uploading video...</span>
                  </>
                ) : isCreatingAnnotatedVideo ? (
                  <>
                    <Loader className="animate-spin" size={18} />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    <span>Create Annotated Video</span>
                  </>
                )}
              </button>

              {/* Note: Clips are now saved in real-time to the library as you annotate */}
              <p className="text-xs text-gray-500 text-center">
                Clips are automatically saved to your library as you annotate
              </p>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  );
}
