import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Play, Plus, Pencil, Share2, ArrowLeft, Minimize, Clock } from 'lucide-react';
import { VideoPlayer } from '../components/VideoPlayer';
import { VideoLoadingOverlay } from '../components/shared/VideoLoadingOverlay';
import ZoomControls from '../components/ZoomControls';
import { AnnotateMode, AnnotateControls, NotesOverlay, AnnotateFullscreenOverlay } from './annotate';
import { SportQuestionOverlay } from './annotate/components/SportQuestionOverlay';
import { NO_SPORT } from './annotate/constants/tagRegistry';
import { useCurrentProfile, useProfileStore } from '../stores';
import PlaybackControls from './annotate/components/PlaybackControls';
import { generateClipName } from '../utils/clipDisplayName';
import { clipGameClock } from '../utils/timeFormat';
import { formatFileSize } from '../utils/fileValidation';
import { useIsMobile, useIsLandscape } from '../hooks/useIsMobile';
import { useFullscreenControls } from '../hooks/useFullscreenControls';
import { Button } from '../components/shared';

/**
 * AnnotateModeView - Complete view for Annotate mode
 *
 * Two sub-modes:
 * 1. Annotating (default) — normal video player, timeline, clip editing
 * 2. Playback — dual-video ping-pong, virtual timeline, NotesOverlay per clip
 */
export function AnnotateModeView({
  // Video control
  videoController,
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
  // bug 27p: game's source video expired (R2 source hard-deleted post-grace).
  // Render a deliberate expired state instead of a broken/hanging player; the
  // clips sidebar keeps the annotations readable.
  isSourceExpired = false,
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
  // T5700: which layer NEW clips default to (mode toggle)
  newClipLayerIsMine = true,
  // T8600: desktop strip only — opens the clip's reel in Focus mode.
  onOpenClipInFocus,
}) {
  // Derive existingClip from state machine's selectedRegionId.
  // EDITING(clipId) keeps the ID stable during scrub, so no frozen ref needed.
  const existingClip = useMemo(() => {
    if (!annotateSelectedRegionId || !showAnnotateOverlay) return null;
    return clipRegions?.find(r => r.id === annotateSelectedRegionId) || null;
  }, [annotateSelectedRegionId, showAnnotateOverlay, clipRegions]);

  // T8760 item 10: while a clip is open for editing, the transport readout is
  // clip-relative (elapsed / clip-duration). Null outside clip-edit mode, so
  // the absolute game-time readout is unchanged there.
  const clipEditBounds = useMemo(
    () => (existingClip ? { start: existingClip.startTime, end: existingClip.endTime } : null),
    [existingClip],
  );

  // T4070/T4080: in-match soccer-notation clock (MM'SS") for a clip region, shown on the
  // NotesOverlay banner. Shared with the annotation clip lists via clipGameClock (T4080) so the
  // banner and the lists agree. boundaryOffsets are the per-half virtual starts; single-video
  // games have none, so the file-relative start is already the in-match position.
  const gameClockFor = useCallback(
    (clip) => clipGameClock(clip, boundaryOffsets),
    [boundaryOffsets],
  );

  const isPlaybackMode = playback?.isPlaybackMode;
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  const fsControls = useFullscreenControls({ isPlaying });
  const playbackFsControls = useFullscreenControls({ isPlaying: playback?.isPlaying });
  const mobileFs = annotateFullscreen && isMobile;
  const [isDraggingScrub, setIsDraggingScrub] = useState(false);

  // T8600: the under-canvas editor (strip on desktop, inline sheet on mobile)
  // replaces the timeline + CTA/Playback/Share block below the video whenever
  // the add/edit overlay is open and we're not in fullscreen. `isMobile`
  // partitions the two device halves, so they're mutually exclusive by
  // construction — "two editors open at once" is impossible at this level.
  const underCanvasEditor = showAnnotateOverlay && !annotateFullscreen;
  const desktopEditorOpen = underCanvasEditor && !isMobile;
  const mobileInlineForm = underCanvasEditor && isMobile;

  // T8140: one-tap first clip helpers.
  // "Play N" default name for a new clip = existing clip count + 1.
  const nextClipNumber = (clipRegions?.length || 0) + 1;
  // Full-screen "What sport is this?" question, shown once per session at a
  // MOBILE user's first clip save while their profile is still no_sport. Desktop
  // keeps the in-form picker (it also has the top-bar sport control), so the
  // question is mobile-only — no double prompt. The answer persists through the
  // existing profile-sport gesture (updateProfile), never a new write path.
  const currentProfile = useCurrentProfile();
  const currentSport = currentProfile?.sport || NO_SPORT;
  const updateProfile = useProfileStore(state => state.updateProfile);
  const [sportQuestionOpen, setSportQuestionOpen] = useState(false);
  const sportAskedRef = useRef(false);
  const handleCreateClipWithSportPrompt = useCallback((clipData) => {
    onFullscreenCreateClip(clipData);
    if (isMobile && currentSport === NO_SPORT && !sportAskedRef.current) {
      sportAskedRef.current = true;
      setSportQuestionOpen(true);
    }
  }, [onFullscreenCreateClip, isMobile, currentSport]);

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

  // Auto-enter playback fullscreen on mobile landscape
  const autoLandscapeFsRef = useRef(false);
  useEffect(() => {
    if (isMobile && isLandscape && isPlaybackMode && !playbackFullscreen) {
      setPlaybackFullscreen(true);
      autoLandscapeFsRef.current = true;
    }
    if (!isLandscape && playbackFullscreen && autoLandscapeFsRef.current) {
      setPlaybackFullscreen(false);
      autoLandscapeFsRef.current = false;
    }
  }, [isMobile, isLandscape, isPlaybackMode, playbackFullscreen]);

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

    const mobilePlaybackFs = isFS && isMobile;

    return (
      <>
      <div
        className={isFS
          ? 'fixed inset-0 z-[100] bg-gray-900 flex flex-col'
          : 'bg-white/10 backdrop-blur-lg rounded-lg p-2 sm:p-6 border border-white/20'
        }
        onMouseMove={mobilePlaybackFs ? playbackFsControls.handleInteraction : undefined}
      >
        {/* Video container */}
        <div className={isFS
          ? 'flex-1 min-h-0 flex items-center justify-center'
          : ''
        }>
          <div
            className={`relative bg-gray-900 ${isFS ? 'w-full' : 'rounded-lg'} overflow-hidden cursor-pointer`}
            onClick={mobilePlaybackFs ? () => { playback.togglePlay(); playbackFsControls.handleTapVideo(); } : () => playback.togglePlay()}
          >
            <div className={`relative ${isFS ? 'w-full' : 'h-[40vh] sm:h-[60vh]'}`}
              style={isFS ? {
                maxHeight: mobilePlaybackFs ? '100dvh' : 'calc(100dvh - 120px)',
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
                    gameClock={gameClockFor(activePlaybackClip)}
                    isVisible={true}
                    isFullscreen={isFS}
                    isMobile={isMobile}
                  />
                ) : null;
              })()}
            </div>
          </div>
        </div>

        {/* Controls — YouTube-style auto-hide on mobile fullscreen */}
        <div
          className={mobilePlaybackFs
            ? `absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
                playbackFsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`
            : isFS ? 'shrink-0' : ''
          }
          onClick={mobilePlaybackFs ? (e) => e.stopPropagation() : undefined}
        >
          {mobilePlaybackFs && (
            <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10" />
          )}
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
            videoController={playback.videoController}
          />
        </div>
        {/* Exit fullscreen button — mobile playback fullscreen */}
        {mobilePlaybackFs && (
          <div
            className={`absolute top-2 right-2 z-30 transition-opacity duration-300 ${
              playbackFsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
            onClick={e => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="sm"
              icon={Minimize}
              iconOnly
              onClick={togglePlaybackFullscreen}
              title="Exit fullscreen"
              className="bg-black/50 hover:bg-black/70"
            />
          </div>
        )}
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
        <div className="hidden lg:block mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-3 lg:p-4 border border-white/20">
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
          <div className="hidden lg:flex mb-6 gap-4 items-center">
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
          className={`${annotateFullscreen ? `fixed inset-0 z-[100] bg-gray-900${mobileFs ? '' : ' flex flex-col'}` : ''}`}
          onMouseMove={mobileFs ? fsControls.handleInteraction : undefined}
        >
          {/* Video Player with annotate overlays */}
          <div
            className={`relative bg-gray-900 ${
              annotateFullscreen
                ? mobileFs ? 'w-full h-full' : 'flex-1 min-h-0 flex flex-col'
                : 'rounded-lg'
            }`}
            onClick={mobileFs && !showAnnotateOverlay ? togglePlay : undefined}
            onTouchStart={mobileFs && !showAnnotateOverlay ? fsControls.handleLongPressTouchStart : undefined}
            onTouchMove={mobileFs && !showAnnotateOverlay ? fsControls.handleLongPressTouchMove : undefined}
            onTouchEnd={mobileFs && !showAnnotateOverlay ? fsControls.handleLongPressTouchEnd : undefined}
          >
            {/* In fullscreen: flex-1 fills remaining space after controls/timeline */}
            <div
              className={annotateFullscreen ? (mobileFs ? 'absolute inset-0' : 'flex-1 min-h-0 relative') : 'contents'}
            >
              {isSourceExpired ? (
                /* bug 27p: source video expired — deliberate state, no <video>.
                   Reuses the Games-menu expired language (yellow + Clock). */
                <div className={annotateFullscreen
                  ? 'absolute inset-0 flex items-center justify-center bg-yellow-950/20'
                  : 'flex items-center justify-center h-[40vh] sm:h-[60vh] rounded-lg bg-yellow-950/20 border border-yellow-800/40'}
                >
                  <div className="text-center max-w-md px-6">
                    <Clock size={40} className="mx-auto mb-3 text-yellow-500" />
                    <p className="text-yellow-400 font-semibold mb-2">Source video expired</p>
                    <p className="text-gray-400 text-sm">
                      This game&apos;s source video is no longer available (storage expired).
                      Your annotations are still listed.
                    </p>
                  </div>
                </div>
              ) : multiVideo ? (
                /* T2750: Dual video elements for multi-video scrub */
                <div className={annotateFullscreen ? 'absolute inset-0' : 'relative'}
                     style={annotateFullscreen ? undefined : { aspectRatio: `${annotateVideoMetadata?.width || 16} / ${annotateVideoMetadata?.height || 9}` }}>
                  <video
                    ref={videoController._renderRefs.videoARef}
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
                    ref={videoController._renderRefs.videoBRef}
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
                        gameClock={gameClockFor(region)}
                        isVisible={true}
                        isFullscreen={annotateFullscreen}
                        isMobile={isMobile}
                      />
                    ) : null;
                  })()}
                </div>
              ) : (
                <div className={annotateFullscreen ? 'absolute inset-0' : 'contents'}>
                  <VideoPlayer
                    videoRef={videoController._renderRefs.videoARef}
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
                            gameClock={gameClockFor(region)}
                            isVisible={true}
                            isFullscreen={annotateFullscreen}
                            isMobile={isMobile}
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
            {showAnnotateOverlay && annotateFullscreen && !isMobile && (
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onCreateClip={handleCreateClipWithSportPrompt}
                onUpdateClip={onFullscreenUpdateClip}
                onResume={onOverlayResume}
                onClose={onOverlayClose}
                onSeek={seek}
                videoController={videoController}
                isFullscreen={annotateFullscreen}
                surface="dock_fullscreen"
                teammateSuggestions={teammateSuggestions}
                onScrubDragChange={isMobile ? setIsDraggingScrub : undefined}
                newClipLayerIsMine={newClipLayerIsMine}
                nextClipNumber={nextClipNumber}
              />
            )}

            {/* Controls + timeline inside video container for desktop fullscreen & non-fullscreen */}
            {!mobileFs && (
              <>
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
                    onAddClip={underCanvasEditor ? undefined : onAddClip}
                    isEditMode={isEditMode}
                    videoController={videoController}
                    clipEditBounds={clipEditBounds}
                  />
                </div>
                {annotateFullscreen && (
                  <div className="w-full shrink-0 bg-gray-900/95 border-t border-gray-700 px-2 lg:px-4 py-0.5">
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
              </>
            )}
          </div>

          {/* Mobile fullscreen: YouTube-style overlay controls + timeline */}
          {mobileFs && (
            <>
              {showAnnotateOverlay ? (
                <div
                  className="absolute inset-x-0 bottom-0 z-20 flex flex-col bg-gray-900/95"
                  style={{ maxHeight: isLandscape ? '50vh' : '70vh' }}
                  onClick={e => e.stopPropagation()}
                >
                  <AnnotateFullscreenOverlay
                    isVisible={showAnnotateOverlay}
                    currentTime={currentTime}
                    videoDuration={duration || annotateVideoMetadata?.duration || 0}
                    existingClip={existingClip}
                    onCreateClip={handleCreateClipWithSportPrompt}
                    onUpdateClip={onFullscreenUpdateClip}
                    onResume={onOverlayResume}
                    onClose={onOverlayClose}
                    onSeek={seek}
                    videoController={videoController}
                    isFullscreen={false}
                    layout={isLandscape ? 'landscape-inline' : 'inline'}
                    surface="fullscreen_mobile"
                    teammateSuggestions={teammateSuggestions}
                    onScrubDragChange={setIsDraggingScrub}
                    newClipLayerIsMine={newClipLayerIsMine}
                    nextClipNumber={nextClipNumber}
                  />
                </div>
              ) : (
                <div
                  className={`absolute inset-x-0 bottom-0 z-20 transition-opacity duration-300 ${
                    isDraggingScrub ? 'opacity-0 pointer-events-none' :
                    fsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                  }`}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="bg-gradient-to-t from-black/80 via-black/40 to-transparent pt-10">
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
                      videoController={videoController}
                      clipEditBounds={clipEditBounds}
                    />
                    <div className="bg-gray-900/90 px-2 py-0.5">
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
                  </div>
                </div>
              )}
              <div
                className={`absolute top-2 right-2 z-30 transition-opacity duration-300 ${
                  showAnnotateOverlay ? 'opacity-100' :
                  isDraggingScrub ? 'opacity-0 pointer-events-none' :
                  fsControls.isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                }`}
                onClick={e => e.stopPropagation()}
              >
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
            </>
          )}

          {/* Annotate Mode Timeline - non-fullscreen (hidden while the under-canvas editor is open) */}
          {!annotateFullscreen && !underCanvasEditor && (
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

          {/* T8600: desktop under-canvas editor strip — replaces the timeline
              in place while Add Play / Edit Play is open (desktop, non-fullscreen). */}
          {desktopEditorOpen && (
            <div className="mt-6">
              <AnnotateFullscreenOverlay
                isVisible={showAnnotateOverlay}
                currentTime={currentTime}
                videoDuration={duration || annotateVideoMetadata?.duration || 0}
                existingClip={existingClip}
                onCreateClip={handleCreateClipWithSportPrompt}
                onUpdateClip={onFullscreenUpdateClip}
                onResume={onOverlayResume}
                onClose={onOverlayClose}
                onSeek={seek}
                videoController={videoController}
                isFullscreen={false}
                layout="strip"
                surface="inline_desktop"
                teammateSuggestions={teammateSuggestions}
                newClipLayerIsMine={newClipLayerIsMine}
                nextClipNumber={nextClipNumber}
                onOpenInFocus={onOpenClipInFocus}
              />
            </div>
          )}
        </div>

        {/* Mobile inline add/edit clip form. T8140: a fixed, viewport-anchored
            bottom sheet (max-h-[85vh], flex column) so the pinned Save footer
            inside the inline overlay is ALWAYS visible without scrolling at
            390x844 — an in-flow form would let Save fall below the page fold. */}
        {mobileInlineForm && (
          <div className="fixed inset-x-0 bottom-0 z-40 flex flex-col max-h-[85vh] bg-gray-900/95 rounded-t-2xl shadow-2xl overflow-hidden">
            <AnnotateFullscreenOverlay
              isVisible={showAnnotateOverlay}
              currentTime={currentTime}
              videoDuration={duration || annotateVideoMetadata?.duration || 0}
              existingClip={existingClip}
              onCreateClip={handleCreateClipWithSportPrompt}
              onUpdateClip={onFullscreenUpdateClip}
              onResume={onOverlayResume}
              onClose={onOverlayClose}
              onSeek={seek}
              videoController={videoController}
              isFullscreen={false}
              layout="inline"
              surface="sheet_mobile"
              teammateSuggestions={teammateSuggestions}
              newClipLayerIsMine={newClipLayerIsMine}
              nextClipNumber={nextClipNumber}
            />
          </div>
        )}

        {/* T8140: full-screen "What sport is this?" question at a mobile first
            save. Answer persists via the existing profile-sport gesture; Skip
            proceeds (the clip is already saved) so it can't dead-end. */}
        {sportQuestionOpen && (
          <SportQuestionOverlay
            onPick={(s) => {
              if (currentProfile?.id) updateProfile(currentProfile.id, { sport: s }).catch(() => {});
              setSportQuestionOpen(false);
            }}
            onSkip={() => setSportQuestionOpen(false)}
          />
        )}

        {/* Primary "Add Play" CTA + secondary actions (hidden while the under-canvas
            editor is open). T8130: the Add Play button is the single loudest element
            on the screen; Playback Annotations + Share are demoted to text-level
            prominence until the first clip exists. */}
        {!annotateFullscreen && !underCanvasEditor && (
          <div className="mt-3 sm:mt-6">
            <div className="space-y-3">
              {/* PRIMARY CTA — full-width, high-contrast, >=44pt tap target.
                  Flips to "Edit Play" when a clip is selected, mirroring
                  AnnotateControls' isEditMode handling (T8130 review finding:
                  the button must reflect what onAddClip is about to do -
                  editClip vs startCreating - or it silently misroutes the
                  gesture it exists to teach). */}
              <button
                onClick={onAddClip}
                disabled={isSourceExpired}
                data-testid="annotate-primary-cta"
                title={
                  isSourceExpired
                    ? 'Source video expired — cannot add plays'
                    : isEditMode
                    ? 'Edit the selected play'
                    : 'Add a play ending at the current time'
                }
                className={`w-full min-h-[52px] py-4 px-4 rounded-xl text-lg font-bold flex items-center justify-center gap-2 transition-colors shadow-lg ${
                  isSourceExpired
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed shadow-none'
                    : isEditMode
                    ? 'bg-yellow-600 hover:bg-yellow-500 text-white shadow-yellow-900/40'
                    : 'bg-green-500 hover:bg-green-400 text-white shadow-green-900/40'
                }`}
              >
                {isEditMode ? <Pencil size={22} /> : <Plus size={22} />}
                {isEditMode ? 'Edit Play' : 'Add Play'}
              </button>

              {/* First-use teaching hint — shown only before the first clip exists.
                  One static sentence, not a coach-mark system (tutorial-redesign
                  owns the full guided flow). */}
              {!hasAnnotateClips && (
                <p className="text-sm text-gray-300 text-center px-2">
                  When something great happens, tap &mdash; we grab the last few seconds.
                </p>
              )}

              {hasAnnotateClips ? (
                <>
                  <div className="flex gap-2">
                    <button
                      onClick={() => playback?.enterPlaybackMode()}
                      disabled={isSourceExpired}
                      title={isSourceExpired ? 'Source video expired — playback unavailable' : undefined}
                      className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                        isSourceExpired
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
                        className={`flex-1 px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                          hasUnsentShares
                            ? 'bg-cyan-600 hover:bg-cyan-500 text-white'
                            : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                        }`}
                      >
                        <Share2 size={18} />
                        <span className="hidden sm:inline">
                          {hasUnsentShares ? 'Share w/ Tagged Teammates' : 'Shared w/ Tagged Teammates'}
                        </span>
                        <span className="sm:hidden">
                          {hasUnsentShares ? 'Share' : 'Shared'}
                        </span>
                      </button>
                    )}
                  </div>

                  <p className="text-xs text-gray-500 text-center">
                    Clips are automatically saved to your library as you annotate
                  </p>
                </>
              ) : (
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => playback?.enterPlaybackMode()}
                    disabled
                    className="text-xs text-gray-600 cursor-not-allowed flex items-center gap-1"
                  >
                    <Play size={12} />
                    <span>Playback Annotations</span>
                  </button>
                  {onShare && (
                    <button
                      onClick={onShare}
                      className="text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
                    >
                      <Share2 size={12} />
                      <span>{hasUnsentShares ? 'Share' : 'Shared'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
