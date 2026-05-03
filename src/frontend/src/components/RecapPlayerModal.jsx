import React, { useState, useEffect, useRef } from 'react';
import { X, Play, Calendar } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { useRecapPlayback } from './recap/useRecapPlayback';
import { RecapClipsSidebar } from './recap/RecapClipsSidebar';
import { PlaybackControls } from '../modes/annotate/components/PlaybackControls';

export function RecapPlayerModal({ game, onClose, onExtend }) {
  const [recapData, setRecapData] = useState(null);
  const [error, setError] = useState(null);
  const videoRef = useRef(null);

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
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
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
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-6xl mx-4 border border-gray-700 flex flex-col max-h-[90vh]">
        {/* Header */}
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

        {/* Content: sidebar + video */}
        <div className="flex flex-1 min-h-0">
          {/* Clips sidebar */}
          {hasClips && (
            <div className="w-64 border-r border-gray-700 flex-shrink-0">
              <div className="p-2 border-b border-gray-700">
                <span className="text-xs text-gray-400 font-medium">
                  {recapData.clips.length} clips
                </span>
              </div>
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(90vh - 220px)' }}>
                <RecapClipsSidebar
                  clips={recapData.clips}
                  activeClipId={activeClipId}
                  onSeekToClip={seekToClip}
                />
              </div>
            </div>
          )}

          {/* Video + controls */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 flex items-center justify-center bg-black p-2">
              <video
                ref={videoRef}
                src={recapData.url}
                autoPlay
                className="max-w-full max-h-full rounded-lg"
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
                  onExitPlayback={onClose}
                  playbackRate={playbackRate}
                  onPlaybackRateChange={changePlaybackRate}
                  videoARef={videoRef}
                  videoBRef={videoRef}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-gray-700 flex-shrink-0">
          <Button
            onClick={onExtend}
            className="flex-1 flex items-center justify-center gap-2"
          >
            <Calendar size={16} />
            Extend Storage
          </Button>
          <Button onClick={onClose} variant="secondary" className="flex-1">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
