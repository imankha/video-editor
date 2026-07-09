import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, X } from 'lucide-react';
// Shared, store-free player leaves from the editor app (see vite alias @editor).
// Keeps this player DRY with the in-app TutorialVideoModal — same control bar,
// scrubber, chapter-hover tooltips, speed menu, and CC behavior.
import { VideoControls } from '@editor/components/shared/VideoControls';
import { useStandaloneVideo } from '@editor/hooks/useStandaloneVideo';
import { formatClock } from '@editor/utils/timeFormat';
import type { TutorialAsset } from '../config/tutorials';

const PLAYBACK_RATES = [0.5, 0.85, 1, 1.25, 1.5, 2];
const DEFAULT_RATE = 0.85; // 1x narration runs too fast — match the in-app default.

interface Chapter {
  startTime: number;
  title: string;
}

function findTrack(video: HTMLVideoElement, kind: string): TextTrack | null {
  for (let i = 0; i < video.textTracks.length; i++) {
    if (video.textTracks[i].kind === kind) return video.textTracks[i];
  }
  return null;
}

function readChapters(video: HTMLVideoElement): Chapter[] {
  const track = findTrack(video, 'chapters');
  if (!track || !track.cues || track.cues.length === 0) return [];
  return Array.from(track.cues).map((c) => ({ startTime: c.startTime, title: (c as VTTCue).text }));
}

function readCaption(track: TextTrack | null): string {
  const cues = track?.activeCues;
  if (!cues || cues.length === 0) return '';
  return Array.from(cues)
    .map((c) => (c as VTTCue).text)
    .join('\n')
    .replace(/<[^>]+>/g, '');
}

/**
 * TutorialModal — landing-page video player. A thin shell that composes the
 * editor's shared VideoControls + useStandaloneVideo (imported via @editor), so
 * the control bar / chapter hover / speed menu behave identically to the app.
 *
 * Adds one thing the in-app modal doesn't need: PLAYLIST mode. When one video
 * ends it auto-advances to the next (the Elevate section plays framing then
 * overlay back-to-back). The <video> is keyed by index so each item mounts fresh.
 *
 * crossOrigin="anonymous" is required for cross-origin <track> cue loading
 * (assets served from assets.reelballers.com with CORS).
 */
export function TutorialModal({ items, onClose }: { items: TutorialAsset[]; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoPlayedRef = useRef(false);
  const subCleanupRef = useRef<(() => void) | null>(null);
  const chapCleanupRef = useRef<(() => void) | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);

  const [index, setIndex] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(DEFAULT_RATE);
  const [subtitlesOn, setSubtitlesOn] = useState(true);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [captionText, setCaptionText] = useState('');

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

  const item = items[index];
  const isPlaylist = items.length > 1;

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  // Keyboard shortcuts + fullscreen sync (mirrors the in-app modal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      switch (e.code) {
        case 'Space': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); seekBackward(5); break;
        case 'ArrowRight': e.preventDefault(); seekForward(5); break;
        case 'KeyM': e.preventDefault(); toggleMute(); break;
        case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
        case 'KeyC': e.preventDefault(); setSubtitlesOn((v) => !v); break;
        case 'Home': e.preventDefault(); seek(0); break;
        case 'Escape':
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
          else onClose();
          break;
      }
    };
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, [togglePlay, seekForward, seekBackward, toggleMute, toggleFullscreen, seek, onClose]);

  // Auto-hide controls during playback.
  const nudgeControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (isPlaying) hideTimer.current = window.setTimeout(() => setShowControls(false), 2800);
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) { setShowControls(true); return; }
    const id = window.setTimeout(() => setShowControls(false), 2000);
    return () => window.clearTimeout(id);
  }, [isPlaying]);

  // Reset per-item transient state + listeners when the playlist advances.
  useEffect(() => {
    autoPlayedRef.current = false;
    setChapters([]);
    setCaptionText('');
    return () => { subCleanupRef.current?.(); chapCleanupRef.current?.(); };
  }, [index]);

  useEffect(() => () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    subCleanupRef.current?.();
    chapCleanupRef.current?.();
  }, []);

  // Autoplay once ready (modal opens from a click, so within the activation window).
  const handleCanPlay = useCallback((e: unknown) => {
    handlers.onCanPlay(e);
    if (!autoPlayedRef.current) {
      autoPlayedRef.current = true;
      play();
    }
  }, [handlers, play]);

  const handlePlaybackRate = useCallback((rate: number) => {
    if (videoRef.current) videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  }, [videoRef]);

  // onLoadedMetadata: default speed + parse subtitle/chapter cues.
  const handleLoadedMetadata = useCallback((e: unknown) => {
    handlers.onLoadedMetadata(e);
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = DEFAULT_RATE;
    setPlaybackRate(DEFAULT_RATE);

    // Keep the subtitle track 'hidden' so cues parse (populating activeCues)
    // without native rendering — we draw the caption strip ourselves.
    const sub = findTrack(v, 'subtitles');
    if (sub) {
      sub.mode = 'hidden';
      const onCue = () => setCaptionText(readCaption(sub));
      sub.addEventListener('cuechange', onCue);
      onCue();
      subCleanupRef.current = () => sub.removeEventListener('cuechange', onCue);
    }
    setSubtitlesOn(true);

    const chap = findTrack(v, 'chapters');
    if (chap) {
      chap.mode = 'hidden';
      const now = readChapters(v);
      if (now.length > 0) setChapters(now);
      else {
        const onCue = () => {
          const late = readChapters(v);
          if (late.length > 0) { setChapters(late); chap.removeEventListener('cuechange', onCue); chapCleanupRef.current = null; }
        };
        chap.addEventListener('cuechange', onCue);
        chapCleanupRef.current = () => chap.removeEventListener('cuechange', onCue);
      }
    }
  }, [handlers, videoRef]);

  const handleEnded = useCallback(() => {
    if (index < items.length - 1) setIndex((i) => i + 1);
    else setShowControls(true);
  }, [index, items.length]);

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="w-full max-w-4xl mx-4 flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div
          ref={containerRef}
          className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl"
          style={{ WebkitTapHighlightColor: 'transparent' }}
          onClick={togglePlay}
          onMouseMove={nudgeControls}
          onMouseLeave={() => isPlaying && setShowControls(false)}
        >
          {/* Close — always visible */}
          <button
            className="absolute top-3 right-3 z-40 text-white/80 hover:text-white bg-black/50 hover:bg-black/70 rounded-full p-1.5 transition-colors"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          {/* Playlist indicator */}
          {isPlaylist && (
            <div className="absolute top-3 left-3 z-40 text-white/90 text-xs font-medium bg-black/50 rounded-full px-3 py-1.5">
              {index + 1} / {items.length} &middot; {item.title}
            </div>
          )}

          <video
            key={index}
            ref={videoRef}
            src={item.videoUrl}
            crossOrigin="anonymous"
            playsInline
            className="w-full h-full object-contain"
            style={{ pointerEvents: 'none' }}
            {...handlers}
            onLoadedMetadata={handleLoadedMetadata}
            onCanPlay={handleCanPlay}
            onEnded={handleEnded}
          >
            <track kind="subtitles" srcLang="en" label="English" src={item.vttUrl} />
            <track kind="chapters" src={item.chaptersUrl} />
          </video>

          {/* Caption strip */}
          {subtitlesOn && captionText && (
            <div className="absolute inset-x-0 bottom-16 flex justify-center px-4 pointer-events-none z-30">
              <span className="max-w-[90%] text-center text-white text-sm sm:text-base bg-black/70 rounded px-2 py-1 whitespace-pre-line leading-snug">
                {captionText}
              </span>
            </div>
          )}

          {/* Big center play button when paused + ready */}
          {!isPlaying && !isLoading && (
            <button
              className="absolute inset-0 flex items-center justify-center z-20"
              onClick={(e) => { e.stopPropagation(); togglePlay(); }}
              aria-label="Play"
            >
              <span className="w-16 h-16 rounded-full bg-purple-600/85 hover:bg-purple-600 flex items-center justify-center transition-colors">
                <Play size={32} className="text-white ml-1" />
              </span>
            </button>
          )}

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
            onToggleSubtitles={() => setSubtitlesOn((v) => !v)}
            chapters={chapters}
            onSeekChapter={seek}
            formatTime={formatClock}
          />
        </div>
      </div>
    </div>
  );
}

export default TutorialModal;
