import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { useRecapPlayback } from './recap/useRecapPlayback';
import { useHighlightsPlayback } from './recap/useHighlightsPlayback';
import { RecapClipsSidebar } from './recap/RecapClipsSidebar';
import { PlaybackControls } from '../modes/annotate/components/PlaybackControls';

const getStreamUrl = (downloadId) => `${API_BASE}/api/downloads/${downloadId}/stream`;

export function RecapPlayerModal({ game, onClose }) {
  const [recapData, setRecapData] = useState(null);
  const [brilliantClips, setBrilliantClips] = useState(null);
  const [error, setError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState('annotations');
  const recapVideoRef = useRef(null);
  const highlightsVideoRef = useRef(null);
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

    fetch(`${API_BASE}/api/games/${game.id}/brilliant-clips`, { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('Failed to load highlights');
        return r.json();
      })
      .then(data => {
        if (!cancelled) setBrilliantClips(data.clips || []);
      })
      .catch(() => {
        if (!cancelled) setBrilliantClips([]);
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

  const activeVideoRef = activeTab === 'highlights' ? highlightsVideoRef : recapVideoRef;

  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        const video = activeVideoRef.current;
        if (!video) return;
        if (video.paused) video.play();
        else video.pause();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isFullscreen, activeVideoRef]);

  const recap = useRecapPlayback(recapVideoRef, recapData?.clips || []);

  const highlights = useHighlightsPlayback(
    highlightsVideoRef,
    brilliantClips || [],
    getStreamUrl,
  );

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

  const hasRecapClips = recapData.clips && recapData.clips.length > 0;
  const hasHighlights = brilliantClips && brilliantClips.length > 0;
  const showTabs = hasHighlights;

  const highlightsSidebarClips = (brilliantClips || []).map(clip => ({
    id: clip.id,
    name: clip.name,
    rating: 5,
    tags: [],
    notes: '',
    recap_end: clip.duration,
  }));

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

        {/* Tab bar — hidden in fullscreen, only shown when highlights exist */}
        {showTabs && !isFullscreen && (
          <div className="flex border-b border-gray-700 flex-shrink-0">
            <button
              onClick={() => setActiveTab('annotations')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'annotations'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Annotations
            </button>
            <button
              onClick={() => setActiveTab('highlights')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'highlights'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Highlights
            </button>
          </div>
        )}

        {/* Content: sidebar + video */}
        {activeTab === 'annotations' ? (
          <div className="flex flex-1 min-h-0">
            {/* Clips sidebar — hidden in fullscreen */}
            {hasRecapClips && !isFullscreen && (() => {
              const activeClip = recapData.clips.find(c => c.id === recap.activeClipId);
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
                      activeClipId={recap.activeClipId}
                      onSeekToClip={recap.seekToClip}
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
                  ref={recapVideoRef}
                  src={recapData.url}
                  autoPlay
                  className={isFullscreen
                    ? 'absolute inset-0 w-full h-full object-contain'
                    : 'max-w-full max-h-full rounded-lg'
                  }
                />
              </div>

              {hasRecapClips && (
                <div className="flex-shrink-0">
                  <PlaybackControls
                    isPlaying={recap.isPlaying}
                    virtualTime={recap.virtualTime}
                    totalVirtualDuration={recap.totalVirtualDuration}
                    segments={recap.segments}
                    activeClipId={recap.activeClipId}
                    activeClipName={recap.activeClipName}
                    currentSegment={recap.currentSegment}
                    onTogglePlay={recap.togglePlay}
                    onRestart={recap.restart}
                    onSeek={recap.seekVirtual}
                    onSeekWithinSegment={recap.seekWithinSegment}
                    onStartScrub={recap.startScrub}
                    onEndScrub={recap.endScrub}
                    onExitPlayback={isFullscreen ? toggleFullscreen : onClose}
                    playbackRate={recap.playbackRate}
                    onPlaybackRateChange={recap.changePlaybackRate}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                    videoARef={recapVideoRef}
                    videoBRef={recapVideoRef}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* Highlights sidebar — hidden in fullscreen */}
            {!isFullscreen && (
              <div className="w-64 border-r border-gray-700 flex-shrink-0 flex flex-col">
                <div className="p-2 border-b border-gray-700">
                  <span className="text-xs text-gray-400 font-medium">
                    {brilliantClips.length} highlights
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto min-h-0">
                  <RecapClipsSidebar
                    clips={highlightsSidebarClips}
                    activeClipId={highlights.activeClipId}
                    onSeekToClip={highlights.seekToClip}
                  />
                </div>
              </div>
            )}

            {/* Video + controls */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className={
                isFullscreen
                  ? 'relative flex-1 min-h-0 bg-black'
                  : 'flex-1 flex items-center justify-center bg-black p-2 min-h-0'
              }>
                {highlights.streamUrl && (
                  <video
                    key={highlights.activeClipId}
                    ref={highlightsVideoRef}
                    src={highlights.streamUrl}
                    autoPlay
                    className={isFullscreen
                      ? 'absolute inset-0 w-full h-full object-contain'
                      : 'max-w-full max-h-full rounded-lg'
                    }
                  />
                )}
              </div>

              <div className="flex-shrink-0">
                <PlaybackControls
                  isPlaying={highlights.isPlaying}
                  virtualTime={highlights.virtualTime}
                  totalVirtualDuration={highlights.totalVirtualDuration}
                  segments={highlights.segments}
                  activeClipId={highlights.activeClipId}
                  activeClipName={highlights.activeClipName}
                  currentSegment={highlights.currentSegment}
                  onTogglePlay={highlights.togglePlay}
                  onRestart={highlights.restart}
                  onSeek={highlights.seekVirtual}
                  onSeekWithinSegment={highlights.seekWithinSegment}
                  onStartScrub={highlights.startScrub}
                  onEndScrub={highlights.endScrub}
                  onExitPlayback={isFullscreen ? toggleFullscreen : onClose}
                  playbackRate={highlights.playbackRate}
                  onPlaybackRateChange={highlights.changePlaybackRate}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={toggleFullscreen}
                  videoARef={highlightsVideoRef}
                  videoBRef={highlightsVideoRef}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
