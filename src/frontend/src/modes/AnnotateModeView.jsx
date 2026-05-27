import { useMemo, useState, useCallback, useEffect } from 'react';
import { Play, Share2, ArrowLeft } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { VideoLoadingOverlay } from '../components/shared/VideoLoadingOverlay';
import ZoomControls from '../components/ZoomControls';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from './annotate';
import PlaybackControls from './annotate/components/PlaybackControls';
import { generateClipName } from '../utils/clipDisplayName';
import { formatFileSize } from '../utils/fileValidation';

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
  isUrlExpiredError = () => false,
  onRetryVideo,
  handlers,

  // Fullscreen state
  annotateFullscreen,
  showAnnotateOverlay,

  // Playback
  togglePlay,
  stepForward,
  stepBackward,
  seekBackward,
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

  // T710: Annotation playback
  playback,
  lockScrub,
  unlockScrub,

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
  // T2750: Multi-video scrub
  multiVideo,
  boundaryOffsets,
  // T2820: Share with tagged players
  onShare,
  hasUnsentShares,
  teammateSuggestions = [],
  // T2905: Share annotated playback
  onSharePlayback,
}) {
  // Derive existingClip from state machine's selectedRegionId.
  // EDITING(clipId) keeps the ID stable during scrub, so no frozen ref needed.
  const existingClip = useMemo(() => {
    if (!annotateSelectedRegionId || !showAnnotateOverlay) return null;
    return clipRegions?.find(r => r.id === annotateSelectedRegionId) || null;
  }, [annotateSelectedRegionId, showAnnotateOverlay, clipRegions]);

  const isPlaybackMode = playback?.isPlaybackMode;

  // Playback fullscreen — independent from annotate fullscreen (CSS fixed positioning)
  const [playbackFullscreen, setPlaybackFullscreen] = useState(false);
  const togglePlaybackFullscreen = useCallback(() => {
    setPlaybackFullscreen(prev => !prev);
  }, []);
  // Exit fullscreen when leaving playback mode — sync active clip back to annotate selection
  const handleExitPlayback = useCallback(() => {
    const lastClipId = playback?.activeClipId;
    setPlaybackFullscreen(false);
    playback?.exitPlaybackMode();
    // Select the last-playing clip in annotate mode so sidebar stays in sync.
    // Lock scrub to suppress auto-deselect while the annotate video seeks to
    // the clip's start time (seek is async — without the lock, the auto-deselect
    // effect fires with the old currentTime and clears the selection).
    if (lastClipId && onSelectRegion) {
      lockScrub?.();
      onSelectRegion(lastClipId);
      // Unlock after the seek settles (video needs time to update currentTime)
      setTimeout(() => unlockScrub?.(), 500);
    }
  }, [playback, onSelectRegion, lockScrub, unlockScrub]);

  // Escape key exits playback fullscreen
  useEffect(() => {
    if (!playbackFullscreen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setPlaybackFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [playbackFullscreen]);

  // In playback mode, find the active clip for NotesOverlay
  const activePlaybackClip = useMemo(() => {
    if (!isPlaybackMode || !playback?.activeClipId) return null;
    return clipRegions?.find(r => r.id === playback.activeClipId) || null;
  }, [isPlaybackMode, playback?.activeClipId, clipRegions]);

  // --- PLAYBACK MODE ---
  // Single return tree — toggling fullscreen changes CSS classes, not DOM structure.
  // This prevents video elements from unmounting/remounting (which loses loaded source).
  if (isPlaybackMode && playback) {
    const activeLabel = playback.activeVideoLabel;
    const isFS = playbackFullscreen;

    return (
      <>
      <div className={isFS
        ? 'fixed inset-0 z-[100] bg-gray-900 flex flex-col'
        : 'bg-white/10 backdrop-blur-lg rounded-lg p-2 sm:p-6 border border-white/20'
      }>
        {/* Video container */}
        <div className={isFS
          ? 'flex-1 min-h-0 flex items-center justify-center'
          : ''
        }>
          <div
            className={`relative bg-gray-900 ${isFS ? 'w-full' : 'rounded-lg'} overflow-hidden cursor-pointer`}
            onClick={() => playback.togglePlay()}
          >
            <div className={`relative ${isFS ? 'w-full' : 'h-[40vh] sm:h-[60vh]'}`}
              style={isFS ? {
                maxHeight: 'calc(100vh - 120px)',
                aspectRatio: `${annotateVideoMetadata?.width || 16} / ${annotateVideoMetadata?.height || 9}`,
              } : undefined}
            >
              {/* Video A */}
              <video
                ref={playback.videoARef}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: activeLabel === 'A' ? 1 : 0,
                  transition: 'opacity 80ms ease-in-out',
                  zIndex: activeLabel === 'A' ? 2 : 1,
                }}
                playsInline
                preload="auto"
                fetchpriority="high"
              />
              {/* Video B */}
              <video
                ref={playback.videoBRef}
                className="absolute inset-0 w-full h-full object-contain"
                style={{
                  opacity: activeLabel === 'B' ? 1 : 0,
                  transition: 'opacity 80ms ease-in-out',
                  zIndex: activeLabel === 'B' ? 2 : 1,
                }}
                playsInline
                preload="auto"
                fetchpriority="high"
              />

              {/* Loading overlay */}
              {playback.isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 z-30">
                  <div className="text-center">
                    <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-gray-600 border-t-green-500" />
                    <p className="mt-3 text-sm text-gray-300">Preparing playback...</p>
                  </div>
                </div>
              )}

              {/* NotesOverlay for active clip */}
              {!playback.isLoading && activePlaybackClip && (() => {
                const displayName = activePlaybackClip.name ||
                  generateClipName(activePlaybackClip.rating, activePlaybackClip.tags, activePlaybackClip.notes);
                return (displayName || activePlaybackClip.notes) ? (
                  <NotesOverlay
                    key="playback-notes"
                    name={displayName}
                    notes={activePlaybackClip.notes}
                    rating={activePlaybackClip.rating}
                    isVisible={true}
                    isFullscreen={isFS}
                  />
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* Controls */}
        <div className={isFS ? 'shrink-0' : ''}>
          <PlaybackControls
            isPlaying={playback.isPlaying}
            virtualTime={playback.virtualTime}
            totalVirtualDuration={playback.timeline?.totalVirtualDuration || 0}
            segments={playback.timeline?.segments}
            activeClipId={playback.activeClipId}
            activeClipName={activePlaybackClip
              ? (activePlaybackClip.name || generateClipName(activePlaybackClip.rating, activePlaybackClip.tags, activePlaybackClip.notes))
              : null}
            currentSegment={playback.getCurrentSegment()}
            onTogglePlay={playback.togglePlay}
            onRestart={playback.restart}
            onSeek={playback.seekVirtual}
            onSeekWithinSegment={playback.seekWithinSegment}
            onStartScrub={playback.startScrub}
            onEndScrub={playback.endScrub}
            playbackRate={playback.playbackRate}
            onPlaybackRateChange={playback.changePlaybackRate}
            isFullscreen={isFS}
            onToggleFullscreen={togglePlaybackFullscreen}
            videoARef={playback.videoARef}
            videoBRef={playback.videoBRef}
          />
        </div>
      </div>

      {/* Back + Share buttons — prominent, below player (not in fullscreen) */}
      {!isFS && (
        <div className="mt-3 sm:mt-6">
          <div className="flex gap-2">
            <button
              onClick={handleExitPlayback}
              className="flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white"
            >
              <ArrowLeft size={18} />
              <span>Back to Annotate</span>
            </button>
            {onSharePlayback && (
              <button
                onClick={onSharePlayback}
                className="flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                <Share2 size={18} />
                <span className="hidden sm:inline">Share Annotations</span>
                <span className="sm:hidden">Share</span>
              </button>
            )}
          </div>
        </div>
      )}
      </>
    );
  }

  // --- ANNOTATING MODE (default) ---
  return (
    <>
      {/* Video Metadata - Annotate mode (hidden on mobile) */}
      {annotateVideoMetadata && !annotateFullscreen && (
        <div className="hidden sm:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 sm:p-4 border border-white/20">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-300">
            {annotateVideoMetadata.resolution && (
              <span>
                <span className="text-gray-400">Resolution:</span>{' '}
                {annotateVideoMetadata.resolution}
              </span>
            )}
            {annotateVideoMetadata.format && (
              <span>
                <span className="text-gray-400">Format:</span>{' '}
                {annotateVideoMetadata.format.toUpperCase()}
              </span>
            )}
            {annotateVideoMetadata.size > 0 && (
              <span>
                <span className="text-gray-400">Size:</span>{' '}
                {formatFileSize(annotateVideoMetadata.size)}
              </span>
            )}
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
          <div className={`relative bg-gray-900 ${annotateFullscreen ? 'flex-1 min-h-0 flex flex-col' : 'rounded-lg'}`}>
            {/* In fullscreen: flex-1 fills remaining space after controls/timeline */}
            <div
              className={annotateFullscreen ? 'flex-1 min-h-0 relative' : 'contents'}
            >
              {multiVideo ? (
                /* T2750: Dual video elements for multi-video scrub */
                <div className={annotateFullscreen ? 'absolute inset-0' : 'relative'}
                     style={annotateFullscreen ? undefined : { aspectRatio: `${annotateVideoMetadata?.width || 16} / ${annotateVideoMetadata?.height || 9}` }}>
                  <video
                    ref={multiVideo.videoARef}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    style={{
                      opacity: multiVideo.activeVideoLabel === 'A' ? 1 : 0,
                      transition: 'opacity 80ms ease-in-out',
                      zIndex: multiVideo.activeVideoLabel === 'A' ? 2 : 1,
                    }}
                    onError={multiVideo.videoHandlers.onError}
                    onWaiting={multiVideo.videoHandlers.onWaiting}
                    onCanPlay={multiVideo.videoHandlers.onCanPlay}
                    playsInline
                    preload="auto"
                  />
                  <video
                    ref={multiVideo.videoBRef}
                    className="absolute inset-0 w-full h-full object-contain bg-black"
                    style={{
                      opacity: multiVideo.activeVideoLabel === 'B' ? 1 : 0,
                      transition: 'opacity 80ms ease-in-out',
                      zIndex: multiVideo.activeVideoLabel === 'B' ? 2 : 1,
                    }}
                    onError={multiVideo.videoHandlers.onError}
                    onWaiting={multiVideo.videoHandlers.onWaiting}
                    onCanPlay={multiVideo.videoHandlers.onCanPlay}
                    playsInline
                    preload="auto"
                  />
                  {/* T3050: Loading overlay during cross-boundary seeks */}
                  {multiVideo.isLoading && !multiVideo.error && (
                    <VideoLoadingOverlay simple />
                  )}
                  {/* T3050: Error overlay with retry */}
                  {multiVideo.error && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-50">
                      <div className="text-center max-w-md px-4">
                        <div className="text-red-500 text-4xl mb-4">{'⚠️'}</div>
                        <p className="text-red-400 font-semibold mb-2">Video failed to load</p>
                        <p className="text-gray-400 text-sm mb-4">{multiVideo.error}</p>
                        <button
                          onClick={multiVideo.retry}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors"
                        >
                          Retry Loading Video
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Click to toggle play */}
                  <div
                    className="absolute inset-0 z-10 cursor-pointer"
                    onClick={togglePlay}
                    style={{ zIndex: 3 }}
                  />
                  {/* NotesOverlay for multi-video */}
                  {!showAnnotateOverlay && (() => {
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
                  })()}
                </div>
              ) : (
                <div className={annotateFullscreen ? 'absolute inset-0' : 'contents'}>
                  <VideoPlayer
                    videoRef={videoRef}
                    videoUrl={annotateVideoUrl}
                    handlers={handlers}
                    onVideoClick={togglePlay}
                    isLoading={isLoading}
                    isVideoElementLoading={isVideoElementLoading}
                    loadingProgress={loadingProgress}
                    loadingElapsedSeconds={loadingElapsedSeconds}
                    error={error}
                    isUrlExpiredError={isUrlExpiredError}
                    onRetryVideo={onRetryVideo}
                    loadingMessage="Loading video..."
                    overlays={[
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
                    ].filter(Boolean)}
                    zoom={zoom}
                    panOffset={panOffset}
                    onZoomChange={onZoomChange}
                    onPanChange={onPanChange}
                    isFullscreen={annotateFullscreen}
                    clipRating={showAnnotateOverlay ? null : (getAnnotateRegionAtTime(currentTime)?.rating ?? null)}
                  />
                </div>
              )}
            </div>

            {/* AnnotateFullscreenOverlay - only rendered in fullscreen mode.
                In non-fullscreen, the form renders in the sidebar (ClipsSidePanel).
                Rendered outside VideoPlayer to avoid <video> GPU compositing painting over the panel (see T755) */}
            {showAnnotateOverlay && annotateFullscreen && (
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onCreateClip={onFullscreenCreateClip}
                onUpdateClip={onFullscreenUpdateClip}
                onResume={onOverlayResume}
                onClose={onOverlayClose}
                onSeek={seek}
                videoRef={videoRef}
                isFullscreen={annotateFullscreen}
                teammateSuggestions={teammateSuggestions}
              />
            )}

            {/* Controls - in flow for both modes, right below video */}
            <div className={annotateFullscreen ? 'w-full shrink-0' : ''}>
              <AnnotateControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration || annotateVideoMetadata?.duration || 0}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
                onSeekBackward={seekBackward}
                onRestart={restart}
                playbackSpeed={annotatePlaybackSpeed}
                onSpeedChange={onSpeedChange}
                isFullscreen={annotateFullscreen}
                onToggleFullscreen={onToggleFullscreen}
                onAddClip={onAddClip}
                isEditMode={isEditMode}
                videoRef={videoRef}
                videoBRef={multiVideo?.videoBRef}
              />
            </div>

            {/* Fullscreen timeline - right below controls */}
            {annotateFullscreen && (
              <div className="w-full shrink-0 bg-gray-900/95 border-t border-gray-700 px-4 py-1">
                <AnnotateMode
                  currentTime={currentTime}
                  duration={duration || annotateVideoMetadata?.duration || 0}
                  isPlaying={isPlaying}
                  onSeek={onTimelineSeek || seek}
                  regions={annotateRegionsWithLayout}
                  selectedRegionId={annotateSelectedRegionId}
                  onSelectRegion={onSelectRegion}
                  onDeleteRegion={onDeleteRegion}
                  selectedLayer={annotateSelectedLayer}
                  onLayerSelect={onLayerSelect}
                  boundaryOffsets={boundaryOffsets}
                />
              </div>
            )}
          </div>

          {/* Annotate Mode Timeline - non-fullscreen */}
          {!annotateFullscreen && (
            <div className="mt-6">
              <AnnotateMode
                currentTime={currentTime}
                duration={duration || annotateVideoMetadata?.duration || 0}
                isPlaying={isPlaying}
                onSeek={onTimelineSeek || seek}
                regions={annotateRegionsWithLayout}
                selectedRegionId={annotateSelectedRegionId}
                onSelectRegion={onSelectRegion}
                onDeleteRegion={onDeleteRegion}
                selectedLayer={annotateSelectedLayer}
                onLayerSelect={onLayerSelect}
                boundaryOffsets={boundaryOffsets}
              />
            </div>
          )}
        </div>

        {/* Playback + Share buttons */}
        {!annotateFullscreen && (
          <div className="mt-3 sm:mt-6">
            <div className="space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => playback?.enterPlaybackMode()}
                  disabled={!hasAnnotateClips}
                  className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                    !hasAnnotateClips
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  }`}
                >
                  <Play size={18} />
                  <span>Playback Annotations</span>
                </button>
                {onShare && (
                  <button
                    onClick={onShare}
                    disabled={!hasUnsentShares}
                    className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                      !hasUnsentShares
                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                        : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                    }`}
                  >
                    <Share2 size={18} />
                    <span className="hidden sm:inline">Share w/ Tagged Teammates</span>
                    <span className="sm:hidden">Share</span>
                  </button>
                )}
              </div>

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
