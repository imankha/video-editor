import { useMemo } from 'react';
import { Play } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import ZoomControls from '../components/ZoomControls';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from './annotate';
import PlaybackControls from './annotate/components/PlaybackControls';
import { generateClipName } from './annotate/constants/soccerTags';

/**
 * AnnotateModeView - Complete view for Annotate mode
 *
 * Two sub-modes:
 * 1. Annotating (default) — normal video player, timeline, clip editing
 * 2. Playback — dual-video ping-pong, virtual timeline, NotesOverlay per clip
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
  onTimelineSeek, // Seek + close overlay if target outside clips (timeline gesture)
  annotatePlaybackSpeed,
  onSpeedChange,

  // Clips/regions
  annotateRegionsWithLayout,
  annotateSelectedRegionId,
  hasAnnotateClips,
  clipRegions,
  isEditMode,

  // Handlers
  onSelectRegion,
  onDeleteRegion,
  onToggleFullscreen,
  onAddClip,
  getAnnotateRegionAtTime,

  // Fullscreen overlay handlers
  onFullscreenCreateClip,
  onFullscreenUpdateClip,
  onOverlayResume,
  onOverlayClose,

  // Layer selection
  annotateSelectedLayer,
  onLayerSelect,

  // Upload state
  isUploadingGameVideo,
  uploadProgress,

  // T710: Annotation playback
  playback,

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
  // Derive existingClip from state machine's selectedRegionId.
  // EDITING(clipId) keeps the ID stable during scrub, so no frozen ref needed.
  const existingClip = useMemo(() => {
    if (!annotateSelectedRegionId || !showAnnotateOverlay) return null;
    return clipRegions?.find(r => r.id === annotateSelectedRegionId) || null;
  }, [annotateSelectedRegionId, showAnnotateOverlay, clipRegions]);

  const isPlaybackMode = playback?.isPlaybackMode;

  // In playback mode, find the active clip for NotesOverlay
  const activePlaybackClip = useMemo(() => {
    if (!isPlaybackMode || !playback?.activeClipId) return null;
    return clipRegions?.find(r => r.id === playback.activeClipId) || null;
  }, [isPlaybackMode, playback?.activeClipId, clipRegions]);

  // --- PLAYBACK MODE ---
  if (isPlaybackMode && playback) {
    const activeLabel = playback.activeVideoLabel;

    return (
      <div className="bg-white/10 backdrop-blur-lg rounded-lg p-2 sm:p-6 border border-white/20">
        {/* Dual video container — only one visible at a time */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden">
          <div className="relative h-[40vh] sm:h-[60vh]">
            {/* Video A */}
            <video
              ref={playback.videoARef}
              className="absolute inset-0 w-full h-full object-contain"
              style={{
                opacity: activeLabel === 'A' ? 1 : 0,
                transition: `opacity ${80}ms ease-in-out`,
                zIndex: activeLabel === 'A' ? 2 : 1,
              }}
              playsInline
              preload="auto"
            />
            {/* Video B */}
            <video
              ref={playback.videoBRef}
              className="absolute inset-0 w-full h-full object-contain"
              style={{
                opacity: activeLabel === 'B' ? 1 : 0,
                transition: `opacity ${80}ms ease-in-out`,
                zIndex: activeLabel === 'B' ? 2 : 1,
              }}
              playsInline
              preload="auto"
            />

            {/* NotesOverlay for active clip */}
            {activePlaybackClip && (() => {
              const displayName = activePlaybackClip.name ||
                generateClipName(activePlaybackClip.rating, activePlaybackClip.tags, activePlaybackClip.notes);
              return (displayName || activePlaybackClip.notes) ? (
                <NotesOverlay
                  key="playback-notes"
                  name={displayName}
                  notes={activePlaybackClip.notes}
                  rating={activePlaybackClip.rating}
                  isVisible={true}
                  isFullscreen={false}
                />
              ) : null;
            })()}
          </div>
        </div>

        {/* Playback Controls */}
        <PlaybackControls
          isPlaying={playback.isPlaying}
          virtualTime={playback.virtualTime}
          totalVirtualDuration={playback.timeline?.totalVirtualDuration || 0}
          segments={playback.timeline?.segments}
          activeClipId={playback.activeClipId}
          onTogglePlay={playback.togglePlay}
          onSeek={playback.seekVirtual}
          onExitPlayback={playback.exitPlaybackMode}
        />
      </div>
    );
  }

  // --- ANNOTATING MODE (default) ---
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
                  // NotesOverlay - shows name, rating, notes for the active clip.
                  !showAnnotateOverlay && (() => {
                    const selectedRegion = annotateSelectedRegionId
                      && clipRegions.find(r => r.id === annotateSelectedRegionId);
                    const region = selectedRegion || getAnnotateRegionAtTime(currentTime);
                    if (!region) return null;

                    const displayName = region.name ||
                      generateClipName(region.rating, region.tags, region.notes);

                    return (displayName || region.notes) ? (
                      <NotesOverlay
                        key="annotate-notes"
                        name={displayName}
                        notes={region.notes}
                        rating={region.rating}
                        isVisible={true}
                        isFullscreen={annotateFullscreen}
                      />
                    ) : null;
                  })(),
                  // AnnotateFullscreenOverlay
                  showAnnotateOverlay && (() => {
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
                onAddClip={onAddClip}
                isEditMode={isEditMode}
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
                  onSeek={onTimelineSeek || seek}
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
                onSeek={onTimelineSeek || seek}
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

        {/* Play Annotations button - replaces old "Create Annotated Video" */}
        {!annotateFullscreen && (
          <div className="mt-3 sm:mt-6">
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

              <button
                onClick={() => playback?.enterPlaybackMode()}
                disabled={!hasAnnotateClips || isUploadingGameVideo}
                className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  !hasAnnotateClips || isUploadingGameVideo
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                }`}
              >
                <Play size={18} />
                <span>Play Annotations</span>
              </button>

              <p className="text-xs text-gray-500 text-center">
                Clips are automatically saved to your library as you annotate
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
