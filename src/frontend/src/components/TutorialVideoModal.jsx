import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { Play, X } from 'lucide-react';
import { VideoLoadingOverlay } from './shared/VideoLoadingOverlay';
import { VideoControls } from './shared/VideoControls';
import { useStandaloneVideo } from '../hooks/useStandaloneVideo';
import { useQuestStore } from '../stores/questStore';
import { formatClock } from '../utils/timeFormat';

const QUEST_ACHIEVEMENT_KEY = {
  quest_1: 'watched_annotate_tutorial',
  quest_2: 'watched_framing_tutorial',
  quest_3: 'watched_overlay_tutorial',
  quest_4: 'watched_publish_tutorial',
};

const PLAYBACK_RATES = [0.5, 0.85, 1, 1.25, 1.5, 2];
const DEFAULT_RATE = 0.8;

// Minimum leftover viewport height (video box already subtracted) needed to
// place the caption strip below the player instead of overlaying the video.
const CAPTION_ROOM_THRESHOLD = 120;

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

/** Active subtitle text, tags stripped, cues joined by newline. */
function readActiveCaption(track) {
  const cues = track?.activeCues;
  if (!cues || cues.length === 0) return '';
  return Array.from(cues).map((c) => c.text).join('\n').replace(/<[^>]+>/g, '');
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
  const subCleanupRef = useRef(null);
  const autoPlayedRef = useRef(false);

  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_RATE);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [chapters, setChapters] = useState([]);
  const [captionText, setCaptionText] = useState('');
  const [roomBelow, setRoomBelow] = useState(false);

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
    play,
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

  // Place subtitles below the player when the viewport has vertical room for a
  // caption strip; otherwise overlay them on the video (above the controls).
  // Never below in fullscreen — the strip lives outside the fullscreened box.
  useLayoutEffect(() => {
    if (isFullscreen) { setRoomBelow(false); return; }
    const measure = () => {
      const box = containerRef.current;
      if (!box) return;
      const boxHeight = box.getBoundingClientRect().height;
      setRoomBelow(window.innerHeight - boxHeight >= CAPTION_ROOM_THRESHOLD);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isFullscreen]);

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

  // Subtitles toggle — the track stays 'hidden' (so cues keep parsing); this
  // only flips whether we render our own caption element.
  const handleToggleSubtitles = useCallback(() => {
    setSubtitlesOn((on) => !on);
  }, []);

  // Autoplay once the video is ready. The modal opens from a user click, so this
  // play() is within the activation window; if the browser still blocks it, the
  // big play button remains for the user to start it manually.
  const handleCanPlay = useCallback((e) => {
    handlers.onCanPlay(e);
    if (!autoPlayedRef.current) {
      autoPlayedRef.current = true;
      play();
    }
  }, [handlers, play]);

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
    // Set default playback rate
    v.playbackRate = DEFAULT_RATE;
    setPlaybackRate(DEFAULT_RATE);
    // Subtitles: keep the track 'hidden' so the browser parses cues (populating
    // activeCues) WITHOUT rendering them natively — we render captions ourselves
    // so they can sit below the video or clear the control bar when overlaid.
    const subTrack = findTrackByKind(v, 'subtitles');
    if (subTrack) {
      subTrack.mode = 'hidden';
      const onSubCue = () => setCaptionText(readActiveCaption(subTrack));
      subTrack.addEventListener('cuechange', onSubCue);
      onSubCue();
      subCleanupRef.current = () => subTrack.removeEventListener('cuechange', onSubCue);
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

  // Cleanup chapter + subtitle cuechange listeners on unmount
  useEffect(() => {
    return () => { chapCleanupRef.current?.(); subCleanupRef.current?.(); };
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
      {/* Column wrapper: player + optional caption strip below it */}
      <div
        className="w-full max-w-4xl mx-4 flex flex-col items-stretch"
        onClick={(e) => e.stopPropagation()}
      >
      {/* Modal container — the fullscreen target */}
      <div
        ref={containerRef}
        className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl"
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
          onCanPlay={handleCanPlay}
        >
          <track kind="subtitles" srcLang="en" label="English" src={assets.vttUrl} />
          <track kind="chapters" src={assets.chaptersUrl} />
        </video>

        {/* Overlaid captions — only when there's no room for a strip below */}
        {subtitlesOn && captionText && !roomBelow && (
          <div className="absolute inset-x-0 bottom-16 flex justify-center px-4 pointer-events-none z-30">
            <span className="max-w-[90%] text-center text-white text-sm sm:text-base bg-black/70 rounded px-2 py-1 whitespace-pre-line leading-snug">
              {captionText}
            </span>
          </div>
        )}

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
          formatTime={formatClock}
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

      {/* Caption strip below the player — reserves a stable line when there's room */}
      {subtitlesOn && roomBelow && (
        <div className="mt-2 rounded-lg bg-black/90 px-4 py-3 min-h-[3.25rem] flex items-center justify-center">
          <span className="text-center text-white text-sm sm:text-base whitespace-pre-line leading-snug">
            {captionText}
          </span>
        </div>
      )}
      </div>
    </div>
  );
}

export default TutorialVideoModal;
