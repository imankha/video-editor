import { Download, Loader } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import ZoomControls from '../components/ZoomControls';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from './annotate';
import { generateClipName } from './annotate/constants/soccerTags';
import { useExportStore } from '../stores';

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

  return (
    <>
      {/* Video Metadata - Annotate mode */}
      {annotateVideoMetadata && !annotateFullscreen && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            <span className="font-semibold text-white truncate max-w-md" title={annotateVideoMetadata.fileName}>
              {annotateVideoMetadata.fileName}
            </span>
            <div className="flex space-x-6">
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
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className={`${annotateFullscreen ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen */}
        {annotateVideoUrl && !annotateFullscreen && (
          <div className="mb-6 flex gap-4 items-center">
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
          className={`${annotateFullscreen ? 'fixed inset-0 z-[100] flex flex-col bg-gray-900' : ''}`}
        >
          {/* Video Player with annotate overlays */}
          <div className={`relative bg-gray-900 ${annotateFullscreen ? 'flex-1 min-h-0' : 'rounded-lg'}`}>
            <VideoPlayer
              videoRef={videoRef}
              videoUrl={annotateVideoUrl}
              handlers={handlers}
              overlays={[
                // NotesOverlay - shows name, rating, notes for region at playhead
                (() => {
                  const regionAtPlayhead = getAnnotateRegionAtTime(currentTime);
                  if (!regionAtPlayhead) return null;

                  // Derive display name from rating+tags if no explicit name is set
                  const displayName = regionAtPlayhead.name ||
                    generateClipName(regionAtPlayhead.rating, regionAtPlayhead.tags);

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
                showAnnotateOverlay && (() => {
                  const existingClip = getAnnotateRegionAtTime(currentTime);
                  return (
                    <AnnotateFullscreenOverlay
                      key="annotate-fullscreen"
                      isVisible={showAnnotateOverlay}
                      currentTime={currentTime}
                      videoDuration={annotateVideoMetadata?.duration || 0}
                      existingClip={existingClip}
                      onCreateClip={onFullscreenCreateClip}
                      onUpdateClip={onFullscreenUpdateClip}
                      onResume={onOverlayResume}
                      onClose={onOverlayClose}
                    />
                  );
                })(),
              ].filter(Boolean)}
              zoom={zoom}
              panOffset={panOffset}
              onZoomChange={onZoomChange}
              onPanChange={onPanChange}
              isFullscreen={annotateFullscreen}
              clipRating={getAnnotateRegionAtTime(currentTime)?.rating ?? null}
            />

            {/* Annotate Controls */}
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
              onAddClip={onAddClip}
            />
          </div>

          {/* Annotate Mode Timeline - visible in fullscreen */}
          <div className={`${annotateFullscreen ? 'bg-gray-900/95 border-t border-gray-700 px-4 py-2' : 'mt-6'}`}>
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
        </div>

        {/* Export Section - hidden in fullscreen */}
        {!annotateFullscreen && (
        <div className="mt-6">
          <div className="space-y-3">
            {/* Export Settings */}
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
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
                    <span className="text-sm text-gray-300">Uploading video to server...</span>
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
                  <div className="text-xs text-gray-500 mt-1">
                    {(uploadProgress.loaded / (1024 * 1024)).toFixed(1)} MB / {(uploadProgress.total / (1024 * 1024)).toFixed(1)} MB
                  </div>
                </div>
              )}

              {/* Progress bar (shown during export) */}
              {exportProgress && (
                <div className="bg-gray-800 rounded-lg p-3 mb-2">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">{exportProgress.message}</span>
                    {exportProgress.total > 0 && (
                      <span className="text-xs text-gray-500">
                        {Math.round((exportProgress.current / exportProgress.total) * 100)}%
                      </span>
                    )}
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        exportProgress.done ? 'bg-green-500' : 'bg-blue-500'
                      }`}
                      style={{
                        width: exportProgress.total > 0
                          ? `${(exportProgress.current / exportProgress.total) * 100}%`
                          : '0%'
                      }}
                    />
                  </div>
                  {exportProgress.phase === 'clips' && (
                    <div className="text-xs text-gray-500 mt-1">
                      {exportProgress.current > 0 && 'Using cache for unchanged clips'}
                    </div>
                  )}
                </div>
              )}

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
