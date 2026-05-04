import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { useRecapPlayback } from './recap/useRecapPlayback';
import { RecapClipsSidebar } from './recap/RecapClipsSidebar';
import { PlaybackControls } from '../modes/annotate/components/PlaybackControls';

export function RecapPlayerModal({ game, onClose }) {
  const [recapData, setRecapData] = useState(null);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const videoRef = useRef(null);
  const contentRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/games/${game.id}/recap-data`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to load recap');
        return r.json();
      })
      .then(data => {
        if (!cancelled) setRecapData(data);
      })
      .catch(err => {
        if (!cancelled) setError(err.message);
      });
    return () => { cancelled = true; };
  }, [game.id]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      contentRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) video.play();
        else video.pause();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isFullscreen]);

  const {
    isPlaying,
    virtualTime,
    totalVirtualDuration,
    segments,
    activeClipId,
    activeClipName,
    currentSegment,
    playbackRate,
    seekToClip,
    togglePlay,
    restart,
    seekVirtual,
    seekWithinSegment,
    startScrub,
    endScrub,
    changePlaybackRate,
  } = useRecapPlayback(videoRef, recapData?.clips || []);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700 p-8">
          <div className="text-center text-red-400">{error}</div>
          <Button onClick={onClose} variant="secondary" className="w-full mt-4">Close</Button>
        </div>
      </div>
    );
  }

  if (!recapData) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700 p-8">
          <div className="flex items-center justify-center text-gray-400">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-blue-400" />
          </div>
        </div>
      </div>
    );
  }

  const hasClips = recapData.clips && recapData.clips.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        ref={contentRef}
        className={`relative bg-gray-800 shadow-2xl flex flex-col ${
          isFullscreen
            ? 'w-screen h-screen'
            : 'rounded-xl border border-gray-700 w-full max-w-6xl mx-4 max-h-[90vh]'
        }`}
      >
        {/* Header — hidden in fullscreen */}
        {!isFullscreen && (
          <div className="flex items-center justify-between p-4 border-b border-gray-700 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600/20 rounded-lg">
                <Play size={20} className="text-blue-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">{game.name}</h2>
                <p className="text-xs text-gray-400">Game Recap</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
            >
              <X size={20} />
            </button>
          </div>
        )}

        {/* Content: sidebar + video */}
        <div className="flex flex-1 min-h-0">
          {/* Clips sidebar — hidden in fullscreen */}
          {hasClips && !isFullscreen && (() => {
            const activeClip = recapData.clips.find(c => c.id === activeClipId);
            const tags = activeClip && Array.isArray(activeClip.tags) ? activeClip.tags : [];
            const notes = activeClip?.notes || '';

            return (
              <div className="w-64 border-r border-gray-700 flex-shrink-0 flex flex-col">
                <div className="p-2 border-b border-gray-700">
                  <span className="text-xs text-gray-400 font-medium">
                    {recapData.clips.length} clips
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <RecapClipsSidebar
                    clips={recapData.clips}
                    activeClipId={activeClipId}
                    onSeekToClip={seekToClip}
                  />
                </div>
                {(notes || tags.length > 0) && (
                  <div className="border-t border-gray-700 p-3 flex-shrink-0">
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-1.5">
                        {tags.map(tag => (
                          <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                    {notes && (
                      <p className="text-xs text-gray-400 leading-relaxed">{notes}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Video + controls */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className={
              isFullscreen
                ? 'relative flex-1 min-h-0 bg-black'
                : 'flex-1 flex items-center justify-center bg-black p-2 min-h-0'
            }>
              <video
                ref={videoRef}
                src={recapData.url}
                autoPlay
                className={isFullscreen
                  ? 'absolute inset-0 w-full h-full object-contain'
                  : 'max-w-full max-h-full rounded-lg'
                }
              />
            </div>

            {hasClips && (
              <div className="flex-shrink-0">
                <PlaybackControls
                  isPlaying={isPlaying}
                  virtualTime={virtualTime}
                  totalVirtualDuration={totalVirtualDuration}
                  segments={segments}
                  activeClipId={activeClipId}
                  activeClipName={activeClipName}
                  currentSegment={currentSegment}
                  onTogglePlay={togglePlay}
                  onRestart={restart}
                  onSeek={seekVirtual}
                  onSeekWithinSegment={seekWithinSegment}
                  onStartScrub={startScrub}
                  onEndScrub={endScrub}
                  onExitPlayback={isFullscreen ? toggleFullscreen : onClose}
                  playbackRate={playbackRate}
                  onPlaybackRateChange={changePlaybackRate}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  videoARef={videoRef}
                  videoBRef={videoRef}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
