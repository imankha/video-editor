import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, X } from 'lucide-react';
import { VideoLoadingOverlay } from './shared/VideoLoadingOverlay';
import { VideoControls } from './shared/VideoControls';
import { useStandaloneVideo } from '../hooks/useStandaloneVideo';
import { useQuestStore } from '../stores/questStore';

const QUEST_ACHIEVEMENT_KEY = {
  quest_1: 'watched_annotate_tutorial',
  quest_2: 'watched_framing_tutorial',
  quest_3: 'watched_overlay_tutorial',
  quest_4: 'watched_publish_tutorial',
};

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

function findTrackByKind(video, kind) {
  for (let i = 0; i < video.textTracks.length; i++) {
    if (video.textTracks[i].kind === kind) return video.textTracks[i];
  }
  return null;
}

function readChapterCues(video) {
  const chapTrack = findTrackByKind(video, 'chapters');
  if (!chapTrack || !chapTrack.cues || chapTrack.cues.length === 0) return [];
  return Array.from(chapTrack.cues).map((c) => ({ startTime: c.startTime, title: c.text }));
}

/**
 * TutorialVideoModal - Full-screen tutorial video player with subtitles and chapters
 *
 * Opened via useTutorialStore (quest step 0 for each quest).
 * Records the watched_*_tutorial achievement at 80% watch or 10s+ on close.
 *
 * CRITICAL: crossOrigin="anonymous" is required for cross-origin <track> cue loading
 * (videos served from assets.reelballers.com). Without it the browser silently blocks tracks.
 */
export function TutorialVideoModal({ questId, assets, onClose }) {
  const containerRef = useRef(null);
  const completedRef = useRef(false);
  const isTouchRef = useRef(false);
  const hideControlsTimeoutRef = useRef(null);
  const chapCleanupRef = useRef(null);

  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(0.75);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [chapters, setChapters] = useState([]);

  // videoRef comes from the hook — all playback controls (togglePlay, seek, etc.)
  // read this same ref internally. Attaching it to <video> wires everything together.
  const {
    videoRef,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    hasAudio,
    isLoading,
    togglePlay,
    seek,
    seekForward,
    seekBackward,
    setVolume,
    toggleMute,
    handlers,
  } = useStandaloneVideo({ autoPlay: false });

  // Derive achievement key from questId
  const achievementKey = QUEST_ACHIEVEMENT_KEY[questId];

  const fireAchievement = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    useQuestStore.getState().recordAchievement(achievementKey);
  }, [achievementKey]);

  const handleClose = useCallback(() => {
    // Fire achievement if watched >= 10s
    if (!completedRef.current && videoRef.current && videoRef.current.currentTime >= 10) {
      fireAchievement();
    }
    onClose?.();
  }, [fireAchievement, onClose]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target?.tagName?.toLowerCase() === 'input' ||
          e.target?.tagName?.toLowerCase() === 'textarea') {
        return;
      }
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBackward(5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekForward(5);
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'Home':
          e.preventDefault();
          seek(0);
          break;
        case 'Escape':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            handleClose();
          }
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seekForward, seekBackward, toggleMute, seek, handleClose]);

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  // Sync fullscreen state with browser
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Auto-hide controls during playback
  const scheduleHideControls = useCallback(() => {
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    setShowControls(true);
    if (isPlaying) {
      hideControlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    const id = setTimeout(() => setShowControls(false), 2000);
    return () => clearTimeout(id);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    };
  }, []);

  // Container click: touch = toggle controls; mouse = toggle play
  const handleContainerClick = useCallback(() => {
    if (isTouchRef.current) {
      isTouchRef.current = false;
      if (showControls) {
        setShowControls(false);
        if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
      } else {
        scheduleHideControls();
      }
      return;
    }
    togglePlay();
  }, [togglePlay, showControls, scheduleHideControls]);

  // Subtitles toggle
  const handleToggleSubtitles = useCallback(() => {
    if (!videoRef.current) return;
    const track = findTrackByKind(videoRef.current, 'subtitles');
    if (track) {
      const next = !subtitlesOn;
      track.mode = next ? 'showing' : 'hidden';
      setSubtitlesOn(next);
    }
  }, [subtitlesOn]);

  // Playback rate change
  const handlePlaybackRate = useCallback((rate) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  }, []);

  // Chapter seek
  const handleSeekChapter = useCallback((startTime) => {
    seek(startTime);
  }, [seek]);

  // onLoadedMetadata: set default speed + enable subtitles + read chapters
  const handleLoadedMetadata = useCallback((e) => {
    // Call original handler from useStandaloneVideo
    handlers.onLoadedMetadata(e);
    const v = videoRef.current;
    if (!v) return;
    // Set default playback rate to 0.75
    v.playbackRate = 0.75;
    setPlaybackRate(0.75);
    // Enable subtitles
    const subTrack = findTrackByKind(v, 'subtitles');
    if (subTrack) {
      subTrack.mode = 'showing';
    }
    setSubtitlesOn(true);
    // Read chapter cues (may not be loaded yet)
    const chapTrack = findTrackByKind(v, 'chapters');
    if (chapTrack) {
      // 'hidden' forces the browser to parse the VTT and populate .cues;
      // 'disabled' (the default) skips cue loading in many browsers.
      chapTrack.mode = 'hidden';
      const cues = readChapterCues(v);
      if (cues.length > 0) {
        setChapters(cues);
      } else {
        // cuechange fires each time a cue becomes active/inactive — also fires
        // on initial cue load, which is the reliable cross-browser signal.
        const onCueChange = () => {
          const lateCues = readChapterCues(v);
          if (lateCues.length > 0) {
            setChapters(lateCues);
            chapTrack.removeEventListener('cuechange', onCueChange);
            chapCleanupRef.current = null;
          }
        };
        chapTrack.addEventListener('cuechange', onCueChange);
        chapCleanupRef.current = () => chapTrack.removeEventListener('cuechange', onCueChange);
      }
    }
  }, [handlers]);

  // Cleanup chapter cuechange listener on unmount
  useEffect(() => {
    return () => { chapCleanupRef.current?.(); };
  }, []);

  // onTimeUpdate: call original + check 80% completion
  const handleTimeUpdate = useCallback((e) => {
    handlers.onTimeUpdate(e);
    if (!completedRef.current && videoRef.current) {
      const v = videoRef.current;
      if (v.duration > 0 && v.currentTime / v.duration >= 0.8) {
        fireAchievement();
      }
    }
  }, [handlers, fireAchievement]);

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center"
      onClick={handleClose}
    >
      {/* Modal container — stops backdrop click from propagating through */}
      <div
        ref={containerRef}
        className="relative w-full max-w-4xl mx-4 aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
        style={{ WebkitTapHighlightColor: 'transparent' }}
        onClick={(e) => {
          e.stopPropagation();
          handleContainerClick();
        }}
        onTouchStart={(e) => {
          e.stopPropagation();
          isTouchRef.current = true;
        }}
        onMouseMove={() => scheduleHideControls()}
        onMouseLeave={() => isPlaying && setShowControls(false)}
      >
        {/* Close button — always visible */}
        <button
          className="absolute top-3 right-3 z-40 text-white/70 hover:text-white transition-colors bg-black/40 rounded-full p-1"
          onClick={(e) => { e.stopPropagation(); handleClose(); }}
          title="Close (Esc)"
        >
          <X size={20} />
        </button>

        {/* Video element */}
        <video
          ref={videoRef}
          src={assets.videoUrl}
          crossOrigin="anonymous"
          playsInline
          className="w-full h-full object-contain"
          style={{ maxHeight: '100%', maxWidth: '100%', pointerEvents: 'none' }}
          {...handlers}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
        >
          <track kind="subtitles" srcLang="en" label="English" src={assets.vttUrl} default />
          <track kind="chapters" src={assets.chaptersUrl} />
        </video>

        {/* Loading overlay */}
        {isLoading && <VideoLoadingOverlay simple />}

        {/* Video controls */}
        <VideoControls
          isPlaying={isPlaying}
          currentTime={currentTime}
          duration={duration}
          volume={volume}
          isMuted={isMuted}
          onTogglePlay={togglePlay}
          onSeekForward={seekForward}
          onSeekBackward={seekBackward}
          onSeek={seek}
          onVolumeChange={setVolume}
          onToggleMute={toggleMute}
          showVolume={hasAudio}
          visible={showControls}
          isFullscreen={isFullscreen}
          onToggleFullscreen={toggleFullscreen}
          rates={PLAYBACK_RATES}
          playbackRate={playbackRate}
          onPlaybackRate={handlePlaybackRate}
          hasSubtitles
          subtitlesOn={subtitlesOn}
          onToggleSubtitles={handleToggleSubtitles}
          chapters={chapters}
          onSeekChapter={handleSeekChapter}
        />

        {/* Big play button (when paused and loaded) */}
        {!isPlaying && !isLoading && showControls && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20"
            onTouchStart={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              togglePlay();
            }}
          >
            <div className="w-16 h-16 rounded-full bg-purple-600/80 flex items-center justify-center hover:bg-purple-600 transition-colors">
              <Play size={32} className="text-white ml-1" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TutorialVideoModal;
