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
import { useCurrentProfile } from '../stores';
import { useRawClipSave } from '../hooks/useRawClipSave';
import { formatGameClock } from '../utils/timeFormat';
import { generateClipName } from '../utils/clipDisplayName';
import { toast } from './shared/Toast';

const getStreamUrl = (downloadId) => `${API_BASE}/api/downloads/${downloadId}/stream`;

const getFullscreenElement = () =>
  document.fullscreenElement || document.webkitFullscreenElement || null;

// T5710: one tab button per recap layer (Team = amber, {Athlete} = cyan, per the
// epic's color scheme) + Highlights. Small enough (3-4 near-identical buttons)
// to be worth a shared component rather than repeating the className logic.
function TabButton({ label, active, activeColorClass, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors ${
        active ? `${activeColorClass} border-b-2` : 'text-gray-400 hover:text-gray-300 border-b-2 border-transparent'
      }`}
    >
      {label}
    </button>
  );
}

export function RecapPlayerModal({ game, initialTab, onClose }) {
  // T5710: the combined "Annotations" recap is replaced by two per-layer
  // fetches (Team Recap / {Athlete} Recap). Both load in parallel so switching
  // tabs never waterfalls a new request.
  const [recapByLayer, setRecapByLayer] = useState({ athlete: null, team: null });
  const [recapFetchFailed, setRecapFetchFailed] = useState(false);
  const [brilliantClips, setBrilliantClips] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Sticky-within-session default is My ({Athlete}) Recap (EPIC decision 4
  // analog); resets fresh each time the modal opens since this is view state,
  // never persisted.
  const [activeTab, setActiveTab] = useState(initialTab || 'athlete');
  const [isLoading, setIsLoading] = useState(true);
  const [showShareDialog, setShowShareDialog] = useState(false);
  // T4130: per-clip annotation overlay — visible by default.
  const [showOverlay, setShowOverlay] = useState(true);
  // T5710: Team Recap clip-rail filter by tagged player (epic decision 7).
  // null = show all. Ephemeral view state, never persisted.
  const [selectedPlayerFilter, setSelectedPlayerFilter] = useState(null);
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
  const currentProfile = useCurrentProfile();
  const athleteLabel = currentProfile?.name ? `${currentProfile.name} Recap` : 'My Recap';

  const teamVideoRef = useRef(null);
  const athleteVideoRef = useRef(null);
  const legacyVideoRef = useRef(null);
  const highlightsVideoRef = useRef(null);
  const contentRef = useRef(null);

  const teamVideoController = useMemo(() => ({
    setVolume: (v) => { if (teamVideoRef.current) teamVideoRef.current.volume = v; },
    setMuted: (m) => { if (teamVideoRef.current) teamVideoRef.current.muted = m; },
  }), []);
  const athleteVideoController = useMemo(() => ({
    setVolume: (v) => { if (athleteVideoRef.current) athleteVideoRef.current.volume = v; },
    setMuted: (m) => { if (athleteVideoRef.current) athleteVideoRef.current.muted = m; },
  }), []);
  const highlightsVideoController = useMemo(() => ({
    setVolume: (v) => { if (highlightsVideoRef.current) highlightsVideoRef.current.volume = v; },
    setMuted: (m) => { if (highlightsVideoRef.current) highlightsVideoRef.current.muted = m; },
  }), []);

  useEffect(() => {
    let cancelled = false;

    const fetchLayer = (layer) => {
      const url = `${API_BASE}/api/games/${game.id}/recap-data?layer=${layer}`;
      return apiFetch(url)
        .then(r => {
          if (!r.ok) {
            const err = new Error('Failed to load recap');
            err.status = r.status;
            throw err;
          }
          return r.json();
        })
        .then(data => {
          if (!cancelled) setRecapByLayer(prev => ({ ...prev, [layer]: data }));
        })
        .catch(err => {
          console.error('[RecapPlayerModal] recap-data failed', { url, layer, status: err.status });
          if (!cancelled) setRecapFetchFailed(true);
        });
    };

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

    Promise.allSettled([fetchLayer('team'), fetchLayer('athlete'), clipsPromise]).then(() => {
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

  const teamPlayback = useRecapPlayback(teamVideoRef, recapByLayer.team?.clips || []);
  const athletePlayback = useRecapPlayback(athleteVideoRef, recapByLayer.athlete?.clips || []);
  const highlights = useHighlightsPlayback(
    highlightsVideoRef,
    brilliantClips || [],
    getStreamUrl,
  );

  // T5710: a legacy (pre-team-layer) mixed recap can't be seek-filtered per
  // layer (offsets unrecoverable) — both layer requests resolve to the SAME
  // combined entry in that case (T5710 design decision 1). Render it as its
  // OWN tab, never under the Team or {Athlete} label.
  const isLegacyCombined =
    recapByLayer.athlete?.video_kind === 'recap_legacy_combined' ||
    recapByLayer.team?.video_kind === 'recap_legacy_combined';
  const legacyData = recapByLayer.athlete?.video_kind === 'recap_legacy_combined'
    ? recapByLayer.athlete
    : recapByLayer.team;

  // Team Recap entry appears only when the team layer actually has clips
  // (explicit `empty` from the empty-layer guard means "nothing to show").
  const hasTeamLayer = !!recapByLayer.team && recapByLayer.team.empty !== true;
  const hasHighlights = brilliantClips && brilliantClips.length > 0;

  const visibleLayerTabs = isLegacyCombined
    ? ['legacy']
    : [...(hasTeamLayer ? ['team'] : []), 'athlete'];
  const availableTabs = [...visibleLayerTabs, ...(hasHighlights ? ['highlights'] : [])];
  const showTabs = availableTabs.length > 1;
  const effectiveTab = availableTabs.includes(activeTab) ? activeTab : (availableTabs[0] || 'athlete');

  useEffect(() => {
    if (effectiveTab !== 'team') setSelectedPlayerFilter(null);
  }, [effectiveTab]);

  // Post-grace, an expired game's video is hard-deleted while annotations persist.
  // Sharing an expired game is blocked (backend 410), so suppress the in-modal share too.
  const isExpired = game.storage_status === 'expired';

  const activeVideoRef = effectiveTab === 'highlights' ? highlightsVideoRef
    : effectiveTab === 'legacy' ? legacyVideoRef
    : effectiveTab === 'team' ? teamVideoRef
    : athleteVideoRef;
  const activeVideoController = effectiveTab === 'team' ? teamVideoController
    : effectiveTab === 'athlete' ? athleteVideoController
    : highlightsVideoController;
  const activeLayerData = effectiveTab === 'team' ? recapByLayer.team
    : effectiveTab === 'athlete' ? recapByLayer.athlete
    : null;
  const activePlayback = effectiveTab === 'team' ? teamPlayback
    : effectiveTab === 'athlete' ? athletePlayback
    : null;

  const hasActiveLayerClips = activeLayerData?.clips && activeLayerData.clips.length > 0;
  // Recap clips exist but the stitched video is gone (post-grace deletion).
  const activeLayerVideoMissing = hasActiveLayerClips && !activeLayerData?.url;

  // A playable source video exists (in-grace) whenever the ACTIVE layer's
  // recap-data resolved a url (video_kind not null); null video_kind means the
  // video is gone post-grace. Gates the per-clip "Create clip" button on the
  // Team/{Athlete} tabs (needs THIS layer's source).
  const canCreateClip = activeLayerData?.video_kind != null;
  // The Highlights tab's "jump to Annotate" button isn't layer-specific — it
  // just needs SOME game source to exist (either layer resolved a url).
  const canJumpToAnnotate =
    recapByLayer.athlete?.video_kind != null || recapByLayer.team?.video_kind != null;

  // T4130: the currently-active recap clip drives the annotation overlay and the
  // "Create clip" target (a recap clip's id IS its raw_clip id).
  const activeRecapClip = useMemo(
    () => (activeLayerData?.clips || []).find(c => c.id === activePlayback?.activeClipId) || null,
    [activeLayerData, activePlayback?.activeClipId],
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
    const layerKey = effectiveTab === 'team' || effectiveTab === 'athlete' ? effectiveTab : null;
    const result = await updateClip(clipId, { create_project: true });
    if (result?.project_id) {
      if (layerKey) {
        setRecapByLayer(prev => (prev[layerKey] ? {
          ...prev,
          [layerKey]: {
            ...prev[layerKey],
            clips: prev[layerKey].clips.map(c => c.id === clipId ? { ...c, in_drafts: true } : c),
          },
        } : prev));
      }
      useProjectsStore.getState().fetchProjects({ force: true });
      toast.success(
        // T8470: one status story - a created reel is a Draft that lives on the
        // Clips tab. Point there (this modal has no Focus affordance to offer the
        // funnel's "click Focus" tap) instead of the old, location-blind
        // "Reel created!".
        result.project_created ? 'Reel started - find it on the Clips tab' : 'This clip is already a draft reel',
        { duration: 5000 },
      );
    }
  }, [activeRecapClip, canCreateClip, updateClip, effectiveTab]);

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
  }, [activeVideoRef, effectiveTab, isLoading, activeLayerData?.url, legacyData?.url, highlights.streamUrl, highlights.activeClipId]);

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

  const noContentAtAll = !hasTeamLayer && !recapByLayer.athlete?.clips?.length && !isLegacyCombined
    && (!brilliantClips || brilliantClips.length === 0);
  const bothFailed = recapFetchFailed && noContentAtAll;
  if (bothFailed && !isLoading) {
    return (
      // T5710: z-[100], not z-50 -- must outrank QuestPanel's persistent floating
      // nudge (also z-50, mounted after this modal in App.jsx's tree so it would
      // otherwise win the paint order and eat clicks). z-[100] matches the tier
      // this codebase already reserves for top-of-stack overlays (QuestPanel's
      // own completion modal, Toast).
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 border border-gray-700 p-8">
          <div className="text-center text-red-400">Failed to load recap</div>
          <Button onClick={onClose} variant="secondary" className="w-full mt-4">Close</Button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center">
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

  // T5710: Team Recap clip-rail filter chips by tagged player (epic decision 7).
  const teammateNames = effectiveTab === 'team'
    ? Array.from(new Set((recapByLayer.team?.clips || []).flatMap(c => c.tagged_teammates || []))).sort()
    : [];
  const sidebarClips = (effectiveTab === 'team' && selectedPlayerFilter)
    ? (activeLayerData?.clips || []).filter(c => (c.tagged_teammates || []).includes(selectedPlayerFilter))
    : (activeLayerData?.clips || []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
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

        {/* Tab bar — hidden in fullscreen, only shown when more than one entry exists */}
        {showTabs && !isFullscreen && (
          <div className="flex border-b border-gray-700 flex-shrink-0">
            {!isLegacyCombined && hasTeamLayer && (
              <TabButton
                label="Team Recap"
                active={effectiveTab === 'team'}
                activeColorClass="text-amber-400 border-amber-400"
                onClick={() => setActiveTab('team')}
              />
            )}
            {!isLegacyCombined && (
              <TabButton
                label={athleteLabel}
                active={effectiveTab === 'athlete'}
                activeColorClass="text-cyan-400 border-cyan-400"
                onClick={() => setActiveTab('athlete')}
              />
            )}
            {isLegacyCombined && (
              <TabButton
                label="Full Game Recap"
                active={effectiveTab === 'legacy'}
                activeColorClass="text-gray-200 border-gray-400"
                onClick={() => setActiveTab('legacy')}
              />
            )}
            {hasHighlights && (
              <TabButton
                label="Highlights"
                active={effectiveTab === 'highlights'}
                activeColorClass="text-blue-400 border-blue-400"
                onClick={() => setActiveTab('highlights')}
              />
            )}
          </div>
        )}

        {/* Content: sidebar + video */}
        {effectiveTab === 'legacy' ? (
          // T5710 design decision 1 (3b): a legacy mixed recap whose mapping is
          // unrecoverable — the whole file plays, honestly labelled, with NO
          // per-clip rail (offsets aren't known) and NEVER under a Team/Athlete
          // label.
          <div className="flex flex-col flex-1 min-h-0">
            <div className="bg-amber-900/20 border-b border-amber-800/40 px-4 py-2 text-xs text-amber-200 flex-shrink-0">
              This is the original combined recap from before Team and {athleteLabel.replace(' Recap', '')} recaps
              existed — it plays every rated clip together. Per-clip skipping and the player filter
              aren't available for this game.
            </div>
            <div className={
              isFullscreen
                ? 'relative flex-1 min-h-0 bg-black'
                : 'relative flex-1 flex items-center justify-center bg-black p-2 min-h-0'
            }>
              {legacyData?.url ? (
                <video
                  key="legacy"
                  ref={legacyVideoRef}
                  src={legacyData.url}
                  controls
                  autoPlay
                  className={isFullscreen
                    ? 'absolute inset-0 w-full h-full object-contain'
                    : 'max-w-full max-h-full rounded-lg'
                  }
                />
              ) : (
                <div className="text-center text-gray-400 px-6 py-8 max-w-md text-sm">
                  This game's video is no longer available.
                </div>
              )}
            </div>
          </div>
        ) : effectiveTab === 'team' || effectiveTab === 'athlete' ? (
          // T5290: column on phones (video on top, clip list below), row at >= sm.
          <div className="flex flex-col sm:flex-row flex-1 min-h-0">
            {/* Clips sidebar — hidden in fullscreen. On phones it drops BELOW the
                video (order-2) as a full-width, height-capped, collapsible panel. */}
            {hasActiveLayerClips && !isFullscreen && (() => {
              const activeClip = activeLayerData.clips.find(c => c.id === activePlayback.activeClipId);
              const tags = activeClip && Array.isArray(activeClip.tags) ? activeClip.tags : [];
              const notes = activeClip?.notes || '';

              return (
                <div className="order-2 sm:order-1 w-full sm:w-64 max-h-[38dvh] sm:max-h-none border-t sm:border-t-0 sm:border-r border-gray-700 flex-shrink-0 flex flex-col min-h-0">
                  <div className="p-2 border-b border-gray-700 flex items-center justify-between gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400 font-medium">
                      {sidebarClips.length} clips
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
                  {effectiveTab === 'team' && teammateNames.length > 0 && (
                    <div className={`p-2 border-b border-gray-700 flex flex-wrap gap-1 flex-shrink-0 ${clipsCollapsed ? 'hidden sm:flex' : ''}`}>
                      <button
                        onClick={() => setSelectedPlayerFilter(null)}
                        className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                          !selectedPlayerFilter
                            ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                            : 'border-gray-600 text-gray-400 hover:text-gray-300'
                        }`}
                      >
                        All
                      </button>
                      {teammateNames.map(name => (
                        <button
                          key={name}
                          onClick={() => setSelectedPlayerFilter(name)}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            selectedPlayerFilter === name
                              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                              : 'border-gray-600 text-gray-400 hover:text-gray-300'
                          }`}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div
                    data-testid="recap-clip-rail"
                    className={`flex-1 overflow-y-auto min-h-0 ${clipsCollapsed ? 'hidden sm:block' : ''}`}
                  >
                    <RecapClipsSidebar
                      clips={sidebarClips}
                      activeClipId={activePlayback.activeClipId}
                      onSeekToClip={activePlayback.seekToClip}
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
                {activeLayerData?.url ? (
                  <video
                    key={effectiveTab}
                    ref={activeVideoRef}
                    src={activeLayerData.url}
                    autoPlay
                    className={isFullscreen
                      ? 'absolute inset-0 w-full h-full object-contain'
                      : 'max-w-full max-h-full rounded-lg'
                    }
                  />
                ) : activeLayerVideoMissing && (
                  <div className="text-center text-gray-400 px-6 py-8 max-w-md">
                    <p className="text-sm">
                      This game's video is no longer available
                      {isExpired ? ' (storage expired)' : ''}. The annotation
                      details are still listed.
                    </p>
                  </div>
                )}

                {/* T4130: active-clip annotation overlay, visible by default */}
                {activeLayerData?.url && activeRecapClip && (
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
                {activeLayerData?.url && (
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

              {hasActiveLayerClips && (
                <div className="flex-shrink-0">
                  <PlaybackControls
                    isPlaying={isPlaying}
                    virtualTime={activePlayback.virtualTime}
                    totalVirtualDuration={activePlayback.totalVirtualDuration}
                    segments={activePlayback.segments}
                    activeClipId={activePlayback.activeClipId}
                    activeClipName={activePlayback.activeClipName}
                    currentSegment={activePlayback.currentSegment}
                    onTogglePlay={activePlayback.togglePlay}
                    onRestart={activePlayback.restart}
                    onSeek={activePlayback.seekVirtual}
                    onSeekWithinSegment={activePlayback.seekWithinSegment}
                    onStartScrub={activePlayback.startScrub}
                    onEndScrub={activePlayback.endScrub}
                    onExitPlayback={onClose}
                    playbackRate={activePlayback.playbackRate}
                    onPlaybackRateChange={activePlayback.changePlaybackRate}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={isFullscreen ? undefined : enterFullscreen}
                    onShare={!isExpired && activeLayerData?.clips?.length > 0 ? () => setShowShareDialog(true) : undefined}
                    videoController={activeVideoController}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          // T5290: same stacked-on-phones treatment as the layer tabs.
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
                    {canJumpToAnnotate && (
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
                  onShare={!isExpired && recapByLayer.athlete?.clips?.length > 0 ? () => setShowShareDialog(true) : undefined}
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
