import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Loader, AlertCircle, ChevronLeft, ChevronRight, Star, StickyNote, Play } from 'lucide-react';
import { Button } from './shared/Button';
import { VideoControls } from './shared/VideoControls';
import { VideoLoadingOverlay } from './shared/VideoLoadingOverlay';
import { useStandaloneVideo } from '../hooks/useStandaloneVideo';
import { useAuthStore } from '../stores/authStore';
import { API_BASE } from '../config';

export function SharedAnnotationView({ shareToken, onClose }) {
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [currentClipIndex, setCurrentClipIndex] = useState(0);

  const isAuthenticated = useAuthStore(s => s.isAuthenticated);

  useEffect(() => {
    let cancelled = false;
    async function fetchShare() {
      try {
        const resp = await fetch(`${API_BASE}/api/shared/teammate/${shareToken}`, {
          credentials: 'include',
        });
        if (cancelled) return;
        if (resp.ok) {
          const json = await resp.json();
          if (json.materialized) {
            setState('materialized');
            return;
          }
          setData(json);
          setState('ready');
        } else if (resp.status === 410) {
          setState('error');
          setErrorMessage('This share link is no longer active.');
        } else {
          setState('error');
          setErrorMessage('Share link not found.');
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setErrorMessage('Could not load shared content. Please try again.');
        }
      }
    }
    fetchShare();
    return () => { cancelled = true; };
  }, [shareToken, isAuthenticated]);

  // After auth, check for pending shares and resolve
  useEffect(() => {
    if (!isAuthenticated || !data || state !== 'ready') return;
    async function resolvePending() {
      try {
        const resp = await fetch(`${API_BASE}/api/shared/teammate/${shareToken}`, {
          credentials: 'include',
        });
        if (resp.ok) {
          const json = await resp.json();
          if (json.materialized) {
            setState('materialized');
          }
        }
      } catch {
        // Non-critical; user can still view the content
      }
    }
    resolvePending();
  }, [isAuthenticated, shareToken, data, state]);

  if (state === 'loading') {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center flex-1 gap-3">
          <Loader size={32} className="text-cyan-400 animate-spin" />
          <p className="text-gray-400">Loading shared clips...</p>
        </div>
      </PageShell>
    );
  }

  if (state === 'materialized') {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8 text-center">
          <p className="text-gray-300 text-lg">These clips are already in your account.</p>
          <Button variant="primary" onClick={onClose}>
            Go to App
          </Button>
        </div>
      </PageShell>
    );
  }

  if (state === 'error' || !data) {
    return (
      <PageShell>
        <div className="flex flex-col items-center justify-center flex-1 gap-4 px-8 text-center">
          <AlertCircle size={48} className="text-gray-500" />
          <p className="text-gray-300 text-lg">{errorMessage}</p>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <AnnotationPlayer
        data={data}
        currentClipIndex={currentClipIndex}
        onClipChange={setCurrentClipIndex}
        onClose={onClose}
      />
    </PageShell>
  );
}

function PageShell({ children }) {
  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      <div className="px-4 py-3 border-b border-gray-800">
        <span className="text-white font-semibold text-sm">Reel Ballers</span>
      </div>
      {children}
    </div>
  );
}

function AnnotationPlayer({ data, currentClipIndex, onClipChange, onClose }) {
  const containerRef = useRef(null);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const hideControlsTimeoutRef = useRef(null);
  const isTouchRef = useRef(false);

  const { annotations, videos, game_name, tag_name, sharer_email, recipient_has_account } = data;
  const sortedAnnotations = useMemo(() =>
    [...annotations].sort((a, b) => (a.start_time || 0) - (b.start_time || 0)),
    [annotations]
  );
  const currentClip = sortedAnnotations[currentClipIndex];
  const videoForClip = videos.find(v => v.sequence === (currentClip?.video_sequence ?? 0)) || videos[0];

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
    handlers: videoHandlers,
  } = useStandaloneVideo({ autoPlay: false });

  // Seek to clip start when clip changes
  useEffect(() => {
    if (currentClip && videoRef.current) {
      const startTime = currentClip.start_time || 0;
      videoRef.current.currentTime = startTime;
      videoRef.current.play().catch(() => {});
    }
  }, [currentClipIndex, currentClip, videoRef]);

  const handlePrevClip = useCallback(() => {
    if (currentClipIndex > 0) onClipChange(currentClipIndex - 1);
  }, [currentClipIndex, onClipChange]);

  const handleNextClip = useCallback(() => {
    if (currentClipIndex < sortedAnnotations.length - 1) onClipChange(currentClipIndex + 1);
  }, [currentClipIndex, sortedAnnotations.length, onClipChange]);

  // Auto-pause at clip end
  useEffect(() => {
    if (!currentClip || !isPlaying) return;
    const endTime = currentClip.end_time;
    if (endTime && currentTime >= endTime) {
      videoRef.current?.pause();
      if (currentClipIndex < sortedAnnotations.length - 1) {
        onClipChange(currentClipIndex + 1);
      }
    }
  }, [currentTime, currentClip, isPlaying, currentClipIndex, sortedAnnotations.length, onClipChange, videoRef]);

  // Determine which annotation is active based on current playback time
  const activeAnnotation = useMemo(() => {
    for (const ann of sortedAnnotations) {
      if (currentTime >= (ann.start_time || 0) && currentTime <= (ann.end_time || Infinity)) {
        return ann;
      }
    }
    return null;
  }, [currentTime, sortedAnnotations]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const scheduleHideControls = useCallback(() => {
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    setShowControls(true);
    if (isPlaying) {
      hideControlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          scheduleHideControls();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seekBackward(5);
          scheduleHideControls();
          break;
        case 'ArrowRight':
          e.preventDefault();
          seekForward(5);
          scheduleHideControls();
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [togglePlay, seekForward, seekBackward, toggleMute, toggleFullscreen, scheduleHideControls]);

  const handleContainerClick = useCallback(() => {
    if (isTouchRef.current) {
      isTouchRef.current = false;
      if (showControls) {
        setShowControls(false);
      } else {
        scheduleHideControls();
      }
      return;
    }
    togglePlay();
  }, [togglePlay, showControls, scheduleHideControls]);

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

  const handleSignIn = () => {
    useAuthStore.getState().requireAuth(() => {});
  };

  const renderStars = (rating) => {
    if (!rating) return null;
    return (
      <div className="flex gap-0.5">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={14}
            className={i < rating ? 'text-yellow-400 fill-yellow-400' : 'text-gray-600'}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col flex-1">
      {/* Attribution */}
      <div className="px-4 py-2 text-gray-400 text-sm">
        Shared by <span className="text-gray-300">{sharer_email}</span>
        <span className="mx-2 text-gray-600">|</span>
        <span className="text-white font-medium">{game_name}</span>
        <span className="mx-2 text-gray-600">|</span>
        Tagged: <span className="text-cyan-400">{tag_name}</span>
      </div>

      {/* Video + Annotation overlay */}
      <div className="flex-1 flex flex-col min-h-0">
        <div
          ref={containerRef}
          className="relative flex-1 bg-black flex items-center justify-center select-none min-h-0"
          style={{ WebkitTapHighlightColor: 'transparent' }}
          onClick={handleContainerClick}
          onTouchStart={() => { isTouchRef.current = true; }}
          onMouseMove={scheduleHideControls}
          onMouseLeave={() => isPlaying && setShowControls(false)}
        >
          {videoForClip && (
            <video
              ref={videoRef}
              src={videoForClip.url}
              className="w-full h-full object-contain"
              style={{ maxHeight: '100%', maxWidth: '100%', pointerEvents: 'none' }}
              {...videoHandlers}
            />
          )}

          {isLoading && <VideoLoadingOverlay simple />}

          {/* Annotation overlay on video */}
          {activeAnnotation && showControls && (
            <div className="absolute top-4 left-4 right-4 pointer-events-none z-10">
              <div className="bg-black/70 backdrop-blur-sm rounded-lg px-4 py-2 inline-flex flex-col gap-1 max-w-md">
                <div className="flex items-center gap-2">
                  <span className="text-white font-medium text-sm">{activeAnnotation.name || 'Untitled Clip'}</span>
                  {renderStars(activeAnnotation.rating)}
                </div>
                {activeAnnotation.notes && (
                  <div className="flex items-start gap-1.5 text-gray-300 text-xs">
                    <StickyNote size={12} className="text-gray-500 mt-0.5 shrink-0" />
                    <span>{activeAnnotation.notes}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Big play button */}
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

          {/* Video Controls */}
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
          />
        </div>

        {/* Clip navigation + mini-timeline */}
        {sortedAnnotations.length > 0 && (
          <div className="bg-gray-800 border-t border-gray-700">
            {/* Mini-timeline showing annotation regions */}
            {duration > 0 && (
              <MiniTimeline
                annotations={sortedAnnotations}
                duration={duration}
                currentTime={currentTime}
                currentClipIndex={currentClipIndex}
                onSeek={seek}
                onClipSelect={onClipChange}
              />
            )}

            {/* Clip navigation controls */}
            <div className="flex items-center justify-between px-4 py-2">
              <button
                onClick={handlePrevClip}
                disabled={currentClipIndex === 0}
                className="p-1.5 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={20} />
              </button>

              <div className="flex flex-col items-center gap-0.5">
                <span className="text-white text-sm font-medium">
                  {currentClip?.name || 'Untitled Clip'}
                </span>
                <div className="flex items-center gap-2">
                  {renderStars(currentClip?.rating)}
                  <span className="text-gray-500 text-xs">
                    Clip {currentClipIndex + 1} of {sortedAnnotations.length}
                  </span>
                </div>
              </div>

              <button
                onClick={handleNextClip}
                disabled={currentClipIndex === sortedAnnotations.length - 1}
                className="p-1.5 rounded text-gray-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          </div>
        )}

        {/* CTA */}
        <div className="bg-gray-900 border-t border-gray-700 px-4 py-4">
          <div className="max-w-md mx-auto text-center">
            <p className="text-gray-300 text-sm mb-3">
              Sign up to annotate and make your own Reel
            </p>
            <div className="flex gap-3 justify-center">
              {recipient_has_account ? (
                <Button variant="primary" onClick={handleSignIn}>Sign In</Button>
              ) : (
                <>
                  <Button variant="primary" onClick={handleSignIn}>Sign Up</Button>
                  <Button variant="secondary" onClick={handleSignIn}>Sign In</Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniTimeline({ annotations, duration, currentTime, currentClipIndex, onSeek, onClipSelect }) {
  const timelineRef = useRef(null);

  const handleClick = useCallback((e) => {
    if (!timelineRef.current || !duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = fraction * duration;

    // Check if click is within an annotation region
    const clickedIdx = annotations.findIndex(
      a => time >= (a.start_time || 0) && time <= (a.end_time || 0)
    );
    if (clickedIdx >= 0) {
      onClipSelect(clickedIdx);
    }
    onSeek(time);
  }, [duration, annotations, onSeek, onClipSelect]);

  return (
    <div
      ref={timelineRef}
      className="relative h-6 mx-4 mt-2 cursor-pointer"
      onClick={handleClick}
    >
      {/* Background track */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 bg-gray-700 rounded-full" />

      {/* Annotation regions */}
      {annotations.map((ann, i) => {
        const left = ((ann.start_time || 0) / duration) * 100;
        const width = (((ann.end_time || 0) - (ann.start_time || 0)) / duration) * 100;
        const isActive = i === currentClipIndex;
        return (
          <div
            key={i}
            className={`absolute top-1/2 -translate-y-1/2 h-3 rounded-sm transition-colors ${
              isActive ? 'bg-cyan-400' : 'bg-purple-500/60 hover:bg-purple-400/80'
            }`}
            style={{ left: `${left}%`, width: `${Math.max(width, 0.5)}%` }}
          />
        );
      })}

      {/* Playhead */}
      <div
        className="absolute top-1/2 -translate-y-1/2 w-2 h-4 bg-white rounded-sm -ml-1"
        style={{ left: `${(currentTime / duration) * 100}%` }}
      />
    </div>
  );
}
