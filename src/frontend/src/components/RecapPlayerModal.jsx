import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Play, Plus, Eye, EyeOff, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useRecapPlayback } from './recap/useRecapPlayback';
import { useHighlightsPlayback } from './recap/useHighlightsPlayback';
import { RecapClipsSidebar } from './recap/RecapClipsSidebar';
import { PlaybackControls } from '../modes/annotate/components/PlaybackControls';
import { NotesOverlay } from '../modes/annotate/components/NotesOverlay';
import { SharePlaybackDialog } from './SharePlaybackDialog';
import { setPendingGame } from '../utils/pendingNavigation';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useRawClipSave } from '../hooks/useRawClipSave';
import { formatGameClock } from '../utils/timeFormat';
import { generateClipName } from '../utils/clipDisplayName';
import { toast } from './shared/Toast';

const getStreamUrl = (downloadId) => `${API_BASE}/api/downloads/${downloadId}/stream`;

const getFullscreenElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

export function RecapPlayerModal({ game, initialTab, onClose }) {
  const [recapData, setRecapData] = useState(null);
  const [brilliantClips, setBrilliantClips] = useState(null);
  const [recapError, setRecapError] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeTab, setActiveTab] = useState(initialTab || 'annotations');
  const [isLoading, setIsLoading] = useState(true);
  const [showShareDialog, setShowShareDialog] = useState(false);
  // T4130: per-clip annotation overlay — visible by default on the Annotations tab.
  const [showOverlay, setShowOverlay] = useState(true);
  // T5290: on a portrait phone (< sm) the modal opens immersive — the video is
  // maximized and the clip list is collapsed into a reachable pull-up handle
  // beneath it. Expanding restores the stacked list. This is ephemeral view
  // state (never persisted). It only drives the < sm layout; at >= sm the list
  // is always shown (the sm: classes ignore this flag).
  const [clipsCollapsed, setClipsCollapsed] = useState(() => {
    // Guard matchMedia for SSR/jsdom (test env has window but no matchMedia).
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(max-width: 639px)').matches;
  });
  const { updateClip, isSaving } = useRawClipSave();
  const recapVideoRef = useRef(null);
  const highlightsVideoRef = useRef(null);
  const contentRef = useRef(null);

  const recapVideoController = useMemo(() => ({
    setVolume: (v) => { if (recapVideoRef.current) recapVideoRef.current.volume = v; },
    setMuted: (m) => { if (recapVideoRef.current) recapVideoRef.current.muted = m; },
  }), []);
  const highlightsVideoController = useMemo(() => ({
    setVolume: (v) => { if (highlightsVideoRef.current) highlightsVideoRef.current.volume = v; },
    setMuted: (m) => { if (highlightsVideoRef.current) highlightsVideoRef.current.muted = m; },
  }), []);

  useEffect(() => {
    let cancelled = false;

    const recapUrl = `${API_BASE}/api/games/${game.id}/recap-data`;
    const recapPromise = apiFetch(recapUrl)
      .then(r => {
        if (!r.ok) {
          const err = new Error('Failed to load recap');
          err.status = r.status;
          throw err;
        }
        return r.json();
      })
      .then(data => {
        if (!cancelled) setRecapData(data);
      })
      .catch(err => {
        console.error('[RecapPlayerModal] recap-data failed', { url: recapUrl, status: err.status });
        if (!cancelled) setRecapError(err.message);
      });

    const clipsPromise = apiFetch(`${API_BASE}/api/games/${game.id}/brilliant-clips`)
      .then(r => {
        if (!r.ok) throw new Error('Failed to load highlights');
        return r.json();
      })
      .then(data => {
        if (!cancelled) setBrilliantClips(data.clips || []);
      })
      .catch(err => {
        console.error('[RecapPlayerModal] Highlights fetch failed:', err.message);
        if (!cancelled) setBrilliantClips([]);
      });

    Promise.allSettled([recapPromise, clipsPromise]).then(() => {
      if (!cancelled) setIsLoading(false);
    });

    return () => { cancelled = true; };
  }, [game.id]);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!getFullscreenElement());
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  // Fullscreen ENTER only (T5659): the in-app exit ("minimize") button did
  // nothing on Android Chrome, so we drop it — users enter fullscreen here and
  // exit with the browser's native back gesture (which works). The
  // fullscreenchange listener above flips isFullscreen back and restores the UI
  // on exit; the enter button is hidden while fullscreen so there's no dead
  // control.
  const enterFullscreen = useCallback(() => {
    const el = contentRef.current;
    if (el?.requestFullscreen) el.requestFullscreen()?.catch(() => {});
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
  }, []);

  const recap = useRecapPlayback(recapVideoRef, recapData?.clips || []);

  const highlights = useHighlightsPlayback(
    highlightsVideoRef,
    brilliantClips || [],
    getStreamUrl,
  );

  const hasRecapClips = recapData?.clips && recapData.clips.length > 0;
  const hasHighlights = brilliantClips && brilliantClips.length > 0;
  const showTabs = hasRecapClips && hasHighlights;

  // Post-grace, an expired game's video is hard-deleted while annotations persist.
  // Sharing an expired game is blocked (backend 410), so suppress the in-modal share too.
  const isExpired = game.storage_status === 'expired';
  // Recap clips exist but the stitched video is gone (post-grace deletion).
  const recapVideoMissing = hasRecapClips && !recapData?.url;

  const effectiveTab = (!hasRecapClips && hasHighlights) ? 'highlights'
    : (!hasHighlights && hasRecapClips) ? 'annotations'
    : activeTab;

  const activeVideoRef = effectiveTab === 'highlights' ? highlightsVideoRef : recapVideoRef;

  // A playable source video exists (in-grace) whenever recap-data resolved a url
  // (video_kind 'recap' | 'game'); null video_kind means the video is gone post-grace.
  const canCreateClip = recapData?.video_kind != null;

  // T4130: the currently-active recap clip drives the annotation overlay and the
  // "Create clip" target (a recap clip's id IS its raw_clip id).
  const activeRecapClip = useMemo(
    () => (recapData?.clips || []).find(c => c.id === recap.activeClipId) || null,
    [recapData, recap.activeClipId],
  );
  // Enabled only when a clip is active, a source exists, and it is not already a draft.
  const createClipEnabled = canCreateClip && !!activeRecapClip && !activeRecapClip.in_drafts;

  // Create a draft reel for the active recap clip. Gesture-driven: fires the surgical
  // PUT /clips/raw/{id} {create_project:true} straight from the click (no reactive
  // persistence). The clip already exists as a raw_clip, so this only adds the draft
  // project (idempotent server-side). Optimistically flips in_drafts so the button
  // disables without re-fetching recap-data.
  const handleCreateRecapClip = useCallback(async () => {
    if (!activeRecapClip || !canCreateClip || activeRecapClip.in_drafts) return;
    const clipId = activeRecapClip.id;
    const result = await updateClip(clipId, { create_project: true });
    if (result?.project_id) {
      setRecapData(prev => prev ? {
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? { ...c, in_drafts: true } : c),
      } : prev);
      useProjectsStore.getState().fetchProjects({ force: true });
      toast.success(
        result.project_created ? 'Reel created!' : 'This clip is already a draft reel',
        { duration: 5000 },
      );
    }
  }, [activeRecapClip, canCreateClip, updateClip]);

  // Track play/pause off the *active* video element so the transport icon reflects
  // real state (incl. autoplay). Re-subscribes when the tab / clip / source changes,
  // since the highlights <video> remounts per clip (key=activeClipId).
  const [isPlaying, setIsPlaying] = useState(false);
  useEffect(() => {
    const video = activeVideoRef.current;
    if (!video) { setIsPlaying(false); return; }
    setIsPlaying(!video.paused);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
    };
    // isLoading is included so the effect re-runs when the spinner clears and the
    // <video> finally mounts (no other dep changes at that exact transition).
  }, [activeVideoRef, effectiveTab, isLoading, recapData?.url, highlights.streamUrl, highlights.activeClipId]);

  // Spacebar toggles play/pause while the modal is open. Ignore when focus is on a
  // control that needs Space (input/textarea/button/contenteditable).
  useEffect(() => {
    const handler = (e) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      const el = e.target;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || el?.isContentEditable) return;
      const video = activeVideoRef.current;
      if (!video) return;
      e.preventDefault();
      if (video.paused) video.play();
      else video.pause();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [activeVideoRef]);

  // "Create clip" (Highlights): jump to Annotate for THIS game at the current
  // playback time, reusing the pendingGame breadcrumb the Annotate-from-reel flow
  // uses (setPendingGame -> AnnotateScreen consumes gameId + seekTime).
  const handleCreateClip = useCallback(() => {
    const t = activeVideoRef.current?.currentTime;
    setPendingGame(game.id, Number.isFinite(t) ? t : null);
    useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
    onClose();
  }, [game.id, onClose, activeVideoRef]);

  const bothFailed = recapError && (!brilliantClips || brilliantClips.length === 0);
  if (bothFailed && !isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700 p-8">
          <div className="text-center text-red-400">{recapError}</div>
          <Button onClick={onClose} variant="secondary" className="w-full mt-4">Close</Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
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
            ? 'w-screen h-dvh'
            // T5290: full-bleed h-dvh player on phones (< sm); the desktop card
            // (rounded, bordered, max-w-6xl, max-h-[90vh]) returns at >= sm.
            : 'w-full h-dvh sm:h-auto sm:rounded-xl sm:border sm:border-gray-700 sm:max-w-6xl sm:mx-4 sm:max-h-[90vh]'
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
            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </div>
        )}

        {/* Tab bar — hidden in fullscreen, only shown when highlights exist */}
        {showTabs && !isFullscreen && (
          <div className="flex border-b border-gray-700 flex-shrink-0">
            <button
              onClick={() => setActiveTab('annotations')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                effectiveTab === 'annotations'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Annotations
            </button>
            <button
              onClick={() => setActiveTab('highlights')}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                effectiveTab === 'highlights'
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              Highlights
            </button>
          </div>
        )}

        {/* Content: sidebar + video */}
        {effectiveTab === 'annotations' ? (
          // T5290: column on phones (video on top, clip list below), row at >= sm.
          <div className="flex flex-col sm:flex-row flex-1 min-h-0">
            {/* Clips sidebar — hidden in fullscreen. On phones it drops BELOW the
                video (order-2) as a full-width, height-capped, collapsible panel. */}
            {hasRecapClips && !isFullscreen && (() => {
              const activeClip = recapData.clips.find(c => c.id === recap.activeClipId);
              const tags = activeClip && Array.isArray(activeClip.tags) ? activeClip.tags : [];
              const notes = activeClip?.notes || '';

              return (
                <div className="order-2 sm:order-1 w-full sm:w-64 max-h-[38dvh] sm:max-h-none border-t sm:border-t-0 sm:border-r border-gray-700 flex-shrink-0 flex flex-col min-h-0">
                  <div className="p-2 border-b border-gray-700 flex items-center justify-between gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400 font-medium">
                      {recapData.clips.length} clips
                    </span>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Plus}
                        onClick={handleCreateRecapClip}
                        disabled={!createClipEnabled || isSaving}
                        title={
                          !canCreateClip ? 'Video source unavailable'
                            : activeRecapClip?.in_drafts ? 'This clip is already a draft reel'
                            : 'Create a draft reel from this clip'
                        }
                      >
                        Create clip
                      </Button>
                      {/* Pull-up handle — phones only; toggles the immersive collapse. */}
                      <button
                        onClick={() => setClipsCollapsed(v => !v)}
                        className="sm:hidden flex items-center justify-center min-h-11 min-w-11 p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                        aria-label={clipsCollapsed ? 'Show clip list' : 'Hide clip list'}
                        aria-expanded={!clipsCollapsed}
                      >
                        {clipsCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>
                  <div className={`flex-1 overflow-y-auto min-h-0 ${clipsCollapsed ? 'hidden sm:block' : ''}`}>
                    <RecapClipsSidebar
                      clips={recapData.clips}
                      activeClipId={recap.activeClipId}
                      onSeekToClip={recap.seekToClip}
                    />
                  </div>
                  {(notes || tags.length > 0) && (
                    <div className={`border-t border-gray-700 p-3 flex-shrink-0 ${clipsCollapsed ? 'hidden sm:block' : ''}`}>
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
            <div className="order-1 sm:order-2 flex-1 flex flex-col min-w-0 min-h-0">
              <div className={
                isFullscreen
                  ? 'relative flex-1 min-h-0 bg-black'
                  : 'relative flex-1 flex items-center justify-center bg-black p-2 min-h-0'
              }>
                {recapData?.url ? (
                  <video
                    ref={recapVideoRef}
                    src={recapData.url}
                    autoPlay
                    className={isFullscreen
                      ? 'absolute inset-0 w-full h-full object-contain'
                      : 'max-w-full max-h-full rounded-lg'
                    }
                  />
                ) : recapVideoMissing && (
                  <div className="text-center text-gray-400 px-6 py-8 max-w-md">
                    <p className="text-sm">
                      This game's video is no longer available
                      {isExpired ? ' (storage expired)' : ''}. The annotation
                      details are still listed.
                    </p>
                  </div>
                )}

                {/* T4130: active-clip annotation overlay (Annotations tab), visible by default */}
                {recapData?.url && activeRecapClip && (
                  <NotesOverlay
                    name={activeRecapClip.name ||
                      generateClipName(activeRecapClip.rating, activeRecapClip.tags, activeRecapClip.notes)}
                    notes={activeRecapClip.notes}
                    rating={activeRecapClip.rating}
                    gameClock={formatGameClock(activeRecapClip.game_start_time)}
                    isVisible={showOverlay}
                    isFullscreen={isFullscreen}
                  />
                )}
                {recapData?.url && (
                  <button
                    onClick={() => setShowOverlay(v => !v)}
                    title={showOverlay ? 'Hide annotations' : 'Show annotations'}
                    aria-label={showOverlay ? 'Hide annotations' : 'Show annotations'}
                    aria-pressed={showOverlay}
                    className="absolute top-2 right-2 z-[60] p-1.5 rounded-lg bg-black/50 text-white hover:bg-black/70 transition-colors"
                  >
                    {showOverlay ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>

              {hasRecapClips && (
                <div className="flex-shrink-0">
                  <PlaybackControls
                    isPlaying={isPlaying}
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
                    onExitPlayback={onClose}
                    playbackRate={recap.playbackRate}
                    onPlaybackRateChange={recap.changePlaybackRate}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={isFullscreen ? undefined : enterFullscreen}
                    onShare={!isExpired && recapData?.clips?.length > 0 ? () => setShowShareDialog(true) : undefined}
                    videoController={recapVideoController}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          // T5290: same stacked-on-phones treatment as the Annotations tab.
          <div className="flex flex-col sm:flex-row flex-1 min-h-0">
            {/* Highlights sidebar — hidden in fullscreen; drops below the video
                (order-2) as a collapsible panel on phones. */}
            {!isFullscreen && (
              <div className="order-2 sm:order-1 w-full sm:w-64 max-h-[38dvh] sm:max-h-none border-t sm:border-t-0 sm:border-r border-gray-700 flex-shrink-0 flex flex-col min-h-0">
                <div className="p-2 border-b border-gray-700 flex items-center justify-between gap-2 flex-shrink-0">
                  <span className="text-xs text-gray-400 font-medium">
                    {(brilliantClips || []).length} highlights
                  </span>
                  <div className="flex items-center gap-1">
                    {canCreateClip && (
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Plus}
                        onClick={handleCreateClip}
                        title="Create a clip in Annotate at this moment"
                      >
                        Create clip
                      </Button>
                    )}
                    {/* Pull-up handle — phones only; toggles the immersive collapse. */}
                    <button
                      onClick={() => setClipsCollapsed(v => !v)}
                      className="sm:hidden flex items-center justify-center min-h-11 min-w-11 p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
                      aria-label={clipsCollapsed ? 'Show highlights list' : 'Hide highlights list'}
                      aria-expanded={!clipsCollapsed}
                    >
                      {clipsCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>
                <div className={`flex-1 overflow-y-auto min-h-0 ${clipsCollapsed ? 'hidden sm:block' : ''}`}>
                  <RecapClipsSidebar
                    clips={highlightsSidebarClips}
                    activeClipId={highlights.activeClipId}
                    onSeekToClip={highlights.seekToClip}
                  />
                </div>
              </div>
            )}

            {/* Video + controls */}
            <div className="order-1 sm:order-2 flex-1 flex flex-col min-w-0 min-h-0">
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
                  isPlaying={isPlaying}
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
                  onExitPlayback={onClose}
                  playbackRate={highlights.playbackRate}
                  onPlaybackRateChange={highlights.changePlaybackRate}
                  isFullscreen={isFullscreen}
                  onToggleFullscreen={isFullscreen ? undefined : enterFullscreen}
                  onShare={!isExpired && recapData?.clips?.length > 0 ? () => setShowShareDialog(true) : undefined}
                  videoController={highlightsVideoController}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {showShareDialog && (
        <SharePlaybackDialog
          gameId={game.id}
          gameName={game.name || 'Untitled Game'}
          onClose={() => setShowShareDialog(false)}
        />
      )}
    </div>
  );
}
