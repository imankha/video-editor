import { Minimize } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { Controls } from '../components/Controls';
import ZoomControls from '../components/ZoomControls';
import ExportButton from '../components/ExportButton';
import { Button } from '../components/shared';
import { FramingMode, CropOverlay } from './framing';

/**
 * FramingModeView - Complete view for Framing mode
 *
 * This component contains all framing-specific JSX that was previously in App.jsx.
 * It receives state and handlers as props from App.jsx.
 *
 * @see DECOMPOSITION_ANALYSIS.md for refactoring context
 */
export function FramingModeView({
  // Video state
  videoRef,
  videoUrl,
  metadata,
  videoFile,
  clipTitle,
  clipTags = [],
  currentTime,
  duration,
  isPlaying,
  isLoading,
  isProjectLoading = false,
  loadingStage = null,
  error,
  handlers,

  // Fullscreen
  fullscreenContainerRef,
  isFullscreen,
  onToggleFullscreen,

  // File handling
  onFileSelect,

  // Playback controls
  togglePlay,
  stepForward,
  stepBackward,
  restart,
  seek,

  // Crop state
  currentCropState,
  aspectRatio,
  keyframes,
  framerate,
  selectedCropKeyframeIndex,
  copiedCrop,
  dragCrop,

  // Crop handlers
  onCropChange,
  onCropComplete,
  onKeyframeClick,
  onKeyframeDelete,
  onCopyCrop,
  onPasteCrop,

  // Zoom state
  zoom,
  panOffset,
  MIN_ZOOM,
  MAX_ZOOM,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onZoomByWheel,
  onPanChange,

  // Timeline zoom
  timelineZoom,
  timelineScrollPosition,
  onTimelineZoomByWheel,
  onTimelineScrollPositionChange,
  getTimelineScale,

  // Segments
  segments,
  segmentBoundaries,
  segmentVisualLayout,
  visualDuration,
  trimRange,
  trimHistory,
  onAddSegmentBoundary,
  onRemoveSegmentBoundary,
  onSegmentSpeedChange,
  onSegmentTrim,
  onDetrimStart,
  onDetrimEnd,
  sourceTimeToVisualTime,
  visualTimeToSourceTime,

  // Layers
  selectedLayer,
  onLayerSelect,

  // Clips
  hasClips,
  clipsWithCurrentState,
  globalAspectRatio,
  globalTransition,

  // Export
  exportButtonRef,
  getFilteredKeyframesForExport,
  getSegmentExportData,
  includeAudio,
  onIncludeAudioChange,
  onProceedToOverlay,
  onExportComplete,
  saveCurrentClipState,  // For backend-authoritative export

  // Context
  cropContextValue,
}) {
  return (
    <>
      {/* Error Message */}
      {error && (
        <div className="mb-6 bg-red-500/20 border border-red-500 rounded-lg p-4">
          <p className="text-red-200 font-semibold mb-1">❌ Error</p>
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Video Metadata - hidden in fullscreen */}
      {metadata && !isFullscreen && (
        <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
          <div className="flex items-center justify-between text-sm text-gray-300">
            {/* Left: Title + Tags */}
            <div className="flex flex-col gap-1">
              {clipTitle && <span className="font-semibold text-white">{clipTitle}</span>}
              {clipTags?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {clipTags.map(tag => (
                    <span key={tag} className="px-2 py-0.5 bg-blue-500/30 text-blue-200 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Right: Metadata */}
            <div className="flex items-center gap-4">
              <div className="flex space-x-6">
                <span>
                  <span className="text-gray-400">Resolution:</span>{' '}
                  {metadata.width}x{metadata.height}
                </span>
                {metadata.framerate && (
                  <span>
                    <span className="text-gray-400">Framerate:</span>{' '}
                    {metadata.framerate} fps
                  </span>
                )}
                <span>
                  <span className="text-gray-400">Format:</span>{' '}
                  {metadata.format.toUpperCase()}
                </span>
                <span>
                  <span className="text-gray-400">Size:</span>{' '}
                  {(metadata.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Editor Area */}
      <div className={`${isFullscreen ? '' : 'bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20'}`}>
        {/* Controls Bar - hidden in fullscreen */}
        {videoUrl && !isFullscreen && (
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

        {/* Fullscreen container - uses fixed positioning to overlay viewport */}
        <div
          ref={fullscreenContainerRef}
          className={`${isFullscreen ? 'fixed inset-0 z-[100] flex flex-col bg-gray-900' : ''}`}
        >
          {/* Video Player with CropOverlay */}
          <div className={`relative bg-gray-900 ${isFullscreen ? 'flex-1 min-h-0' : 'rounded-lg'}`}>
            <VideoPlayer
              videoRef={videoRef}
              videoUrl={videoUrl}
              handlers={handlers}
              onFileSelect={isFullscreen ? undefined : onFileSelect}
              overlays={[
                videoUrl && currentCropState && metadata && (
                  <CropOverlay
                    key="crop"
                    videoRef={videoRef}
                    videoMetadata={metadata}
                    currentCrop={currentCropState}
                    aspectRatio={aspectRatio}
                    onCropChange={onCropChange}
                    onCropComplete={onCropComplete}
                    zoom={zoom}
                    panOffset={panOffset}
                    selectedKeyframeIndex={selectedCropKeyframeIndex}
                    isFullscreen={isFullscreen}
                  />
                ),
              ].filter(Boolean)}
              zoom={zoom}
              panOffset={panOffset}
              onZoomChange={onZoomByWheel}
              onPanChange={onPanChange}
              isFullscreen={isFullscreen}
              isLoading={isLoading || isProjectLoading}
              loadingMessage={
                loadingStage === 'clips' ? 'Loading clips...' :
                loadingStage === 'video' ? 'Loading video...' :
                loadingStage === 'working-video' ? 'Loading working video...' :
                isLoading ? 'Loading video...' : 'Loading...'
              }
            />

            {/* Fullscreen exit button - top right corner */}
            {isFullscreen && (
              <div className="absolute top-4 right-4 z-10">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Minimize}
                  iconOnly
                  onClick={onToggleFullscreen}
                  title="Exit fullscreen (Esc)"
                  className="bg-black/50 hover:bg-black/70"
                />
              </div>
            )}

            {/* Controls */}
            {videoUrl && (
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onRestart={restart}
                isFullscreen={isFullscreen}
                onToggleFullscreen={onToggleFullscreen}
              />
            )}
          </div>

          {/* Framing Mode Timeline - shown in fullscreen at bottom */}
          {videoUrl && (
          <FramingMode
            videoRef={videoRef}
            videoUrl={videoUrl}
            metadata={metadata}
            currentTime={currentTime}
            duration={duration}
            cropContextValue={cropContextValue}
            currentCropState={currentCropState}
            aspectRatio={aspectRatio}
            cropKeyframes={keyframes}
            framerate={framerate}
            selectedCropKeyframeIndex={selectedCropKeyframeIndex}
            copiedCrop={copiedCrop}
            onCropChange={onCropChange}
            onCropComplete={onCropComplete}
            onCropKeyframeClick={onKeyframeClick}
            onCropKeyframeDelete={onKeyframeDelete}
            onCropKeyframeCopy={onCopyCrop}
            onCropKeyframePaste={onPasteCrop}
            zoom={zoom}
            panOffset={panOffset}
            segments={segments}
            segmentBoundaries={segmentBoundaries}
            segmentVisualLayout={segmentVisualLayout}
            visualDuration={visualDuration || duration}
            trimRange={trimRange}
            trimHistory={trimHistory}
            onAddSegmentBoundary={onAddSegmentBoundary}
            onRemoveSegmentBoundary={onRemoveSegmentBoundary}
            onSegmentSpeedChange={onSegmentSpeedChange}
            onSegmentTrim={onSegmentTrim}
            onDetrimStart={onDetrimStart}
            onDetrimEnd={onDetrimEnd}
            sourceTimeToVisualTime={sourceTimeToVisualTime}
            visualTimeToSourceTime={visualTimeToSourceTime}
            selectedLayer={selectedLayer}
            onLayerSelect={onLayerSelect}
            onSeek={seek}
            timelineZoom={timelineZoom}
            onTimelineZoomByWheel={onTimelineZoomByWheel}
            timelineScale={getTimelineScale()}
            timelineScrollPosition={timelineScrollPosition}
            onTimelineScrollPositionChange={onTimelineScrollPositionChange}
            isPlaying={isPlaying}
            isFullscreen={isFullscreen}
          />
        )}
        </div>

        {/* Export Button - hidden in fullscreen */}
        {videoUrl && !isFullscreen && (
          <div className="mt-6">
            <ExportButton
              ref={exportButtonRef}
              videoFile={videoFile}
              cropKeyframes={getFilteredKeyframesForExport}
              highlightRegions={[]}
              isHighlightEnabled={false}
              segmentData={getSegmentExportData()}
              disabled={!videoUrl}
              includeAudio={includeAudio}
              onIncludeAudioChange={onIncludeAudioChange}
              onProceedToOverlay={onProceedToOverlay}
              clips={hasClips ? clipsWithCurrentState : null}
              globalAspectRatio={globalAspectRatio}
              globalTransition={globalTransition}
              onExportComplete={onExportComplete}
              saveCurrentClipState={saveCurrentClipState}
            />
          </div>
        )}
      </div>

      {/* Instructions when no video */}
      {!videoUrl && !isLoading && !error && (
        <div className="mt-8 text-center text-gray-400">
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="text-xl font-semibold text-white mb-4">
              Getting Started
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-2xl mb-2">📤</div>
                <h3 className="font-semibold text-white mb-1">1. Upload</h3>
                <p>Upload your game footage to get started</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-2xl mb-2">✂️</div>
                <h3 className="font-semibold text-white mb-1">2. Trim</h3>
                <p>Cut out the boring parts and keep only the action</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-2xl mb-2">🎯</div>
                <h3 className="font-semibold text-white mb-1">3. Zoom</h3>
                <p>Follow your player with dynamic crop keyframes</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-2xl mb-2">🐌</div>
                <h3 className="font-semibold text-white mb-1">4. Slow-Mo</h3>
                <p>Create slow motion segments for key moments</p>
              </div>
              <div className="bg-white/5 rounded-lg p-4">
                <div className="text-2xl mb-2">🚀</div>
                <h3 className="font-semibold text-white mb-1">5. Export</h3>
                <p>Play the video to make sure it's perfect and hit export to leverage AI Upscale</p>
              </div>
            </div>
            <div className="mt-6 text-xs text-gray-500">
              <p>Supported formats: MP4, MOV, WebM</p>
              <p>Maximum file size: 4GB</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
