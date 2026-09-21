import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { List, X } from 'lucide-react';
import { ShareWithTeammatesModal } from '../components/ShareWithTeammatesModal';
import { SharePlaybackDialog } from '../components/SharePlaybackDialog';
import { toast } from '../components/shared/Toast';
import { AnnotateModeView } from '../modes';
import { ClipsSidePanel } from '../modes/annotate';
import { AnnotateContainer } from '../containers';
import { UnifiedHeader } from '../components/shared/UnifiedHeader';
import { UploadPreviewNotice } from '../components/UploadPreviewNotice';
import { ConfirmationDialog } from '../components/shared/ConfirmationDialog';
import { useVideo } from '../hooks/useVideo';
import useZoom from '../hooks/useZoom';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useAuthStore } from '../stores/authStore';
import { useUploadStore, useActiveUploadBlobUrl, selectActiveUpload } from '../stores/uploadStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProjectsStore } from '../stores/projectsStore';
import { getPendingGameFile, getPendingGameDetails, clearPendingGameFile } from './ProjectsScreen';
import { hasPendingGame, consumePendingGame } from '../utils/pendingNavigation';
import { useIsMobile, useIsLandscape } from '../hooks/useIsMobile';

/**
 * AnnotateScreen - Self-contained screen for Annotate mode
 *
 * This component is the SINGLE SOURCE OF TRUTH for all annotate state.
 * App.jsx does NOT call AnnotateContainer - only this screen does.
 *
 * This component owns all annotate-specific hooks and state:
 * - AnnotateContainer - all annotate logic and state
 * - useVideo - video playback
 * - useZoom - video zoom/pan
 * - useGames - game management
 * - useSettings - project creation settings
 * - useGalleryStore - downloads count and panel state
 * - Keyboard shortcuts for annotate mode
 *
 * Data flow:
 * - Initial game ID: sessionStorage (from ProjectsScreen game load)
 * - File selection: Via ProjectsScreen "Add Game" flow
 *
 * @see AppJSX_REDUCTION/TASK-05-finalize-annotate-screen.md
 */
export function AnnotateScreen({ onClearSelection, onModeChange }) {
  // Editor mode (for navigation between screens)
  const setEditorMode = useEditorStore(state => state.setEditorMode);
  const redirectToMode = useEditorStore(state => state.redirectToMode);

  // T7340: admin-only TSV annotation import/export in production
  const isAdmin = useAuthStore(state => state.isAdmin);

  // Games — Zustand store (reactive to profile switches)
  const uploadGameVideo = useGamesDataStore(state => state.uploadGameVideo);
  const getGame = useGamesDataStore(state => state.getGame);
  const loadGame = useGamesDataStore(state => state.loadGame);
  const getGameVideoUrl = useGamesDataStore(state => state.getGameVideoUrl);
  const finishAnnotation = useGamesDataStore(state => state.finishAnnotation);
  const saveLastPlayhead = useGamesDataStore(state => state.saveLastPlayhead);

  // Projects — Zustand store
  const fetchProjects = useProjectsStore(state => state.fetchProjects);
  const selectProject = useProjectsStore(state => state.selectProject);
  const selectedProject = useProjectsStore(state => state.selectedProject);

  // Track if we're loading a game (ref persists across re-renders without causing them)
  const isLoadingRef = useRef(false);
  // Mobile sidebar toggle
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);
  // T9920: the plays panel follows useIsMobile() (mobile through 1023px) so it becomes
  // a dismissable off-canvas drawer across the whole 640-1023px range, NOT the raw `sm:`
  // (640px) CSS gate — which left a dead zone where a narrow desktop/tablet window showed
  // a permanent, undismissable 352px panel that squeezed the canvas to ~250px. This
  // matches how the settings rail already switches on every other editor surface.
  // T4933 carve-out: landscape phones (>=640px wide but short) keep the in-flow desktop
  // panel with its inner scrollers, so they must NOT fall into the drawer branch.
  const isMobile = useIsMobile();
  const isLandscape = useIsLandscape();
  const useMobileClipPanel = isMobile && !isLandscape;
  // T2820: Share with tagged players modal
  const [showShareModal, setShowShareModal] = useState(false);
  // T2905: Share annotated playback via email link
  const [showPlaybackShareDialog, setShowPlaybackShareDialog] = useState(false);
  // T2840: Share attribution banner
  const [shareAttribution, setShareAttribution] = useState(() => {
    const attr = sessionStorage.getItem('shareAttribution');
    if (attr) sessionStorage.removeItem('shareAttribution');
    return attr;
  });

  // Active upload's blob url (for restoring annotation after navigating back from Games).
  // T7360/T7280: subscribe to the PRIMITIVE blob url, not the whole entry, so a progress
  // tick can't re-run the redirect effect below.
  const activeUploadBlobUrl = useActiveUploadBlobUrl();

  // Check on mount if we're loading a game or file or have an active upload, set loading flag to prevent redirect
  useState(() => {
    const pendingDetails = getPendingGameDetails();
    const hasFootageList = pendingDetails?.files?.length > 0;
    if (hasPendingGame() || getPendingGameFile() || hasFootageList || selectActiveUpload(useUploadStore.getState())?.blobUrl) {
      isLoadingRef.current = true;
    }
  });

  // Video hook - without segment awareness for annotate mode
  // IMPORTANT: We use the videoRef from this hook (not from App.jsx props)
  // This ensures seek/play/pause work correctly with the video element
  const {
    videoRef,
    currentTime,
    duration,
    isPlaying,
    isLoading: isVideoLoading,
    isVideoElementLoading,
    loadingProgress,
    loadingElapsedSeconds,
    error: videoError,
    togglePlay,
    pause,
    seek,
    seekForward,
    seekBackward,
    stepForward,
    stepBackward,
    restart,
    handlers,
    clearError,
    isUrlExpiredError,
    loadVideoFromStreamingUrl,
  } = useVideo(null, null);

  // Zoom hook
  const {
    zoom,
    panOffset,
    zoomByWheel,
    updatePan,
    zoomIn,
    zoomOut,
    resetZoom,
    MIN_ZOOM,
    MAX_ZOOM,
  } = useZoom();

  // Ref to store gameId for use in handleBackToProjects (avoids circular dependency)
  const gameIdRef = useRef(null);
  // T251: Ref to store getViewedDuration function from AnnotateContainer
  const getViewedDurationRef = useRef(null);
  // Ref to store getLastPlayhead function from AnnotateContainer (exact resume)
  const getLastPlayheadRef = useRef(null);
  // Ref to clip regions for annotate-to-framing project selection
  const clipRegionsRef = useRef([]);

  // Handlers
  // T8180: the game the user was annotating turned out to be deleted (a "ghost
  // session"). Make it impossible to miss: loud toast, refresh the games list (so the
  // deleted game drops out of "Continue where you left off"), and return to the
  // project manager. Read/notify only — never a persistence path.
  const handleGhostGame = useCallback(() => {
    toast.error('This game no longer exists', {
      message: 'It was removed, so we returned you to your games.',
      duration: 6000,
      dedupKey: 'annotate-ghost-game',
    });
    useGamesDataStore.getState().fetchGames();
    redirectToMode(EDITOR_MODES.PROJECT_MANAGER);
  }, [redirectToMode]);

  // Persist watch progress on the way out of Annotate (leave-annotate gesture).
  // Shared by every exit path below — extracted once it hit its 3rd copy.
  const persistAnnotateProgress = useCallback(() => {
    if (!gameIdRef.current) return;
    const viewedDuration = getViewedDurationRef.current ? getViewedDurationRef.current() : 0;
    // T8180: finishAnnotation now REPORTS a 404 ({ notFound: true }) instead of
    // swallowing it (T7500). A 404 means the game vanished under the session — exit
    // the ghost loudly rather than the old silent no-op (bug 47p: Ready 404'd silently
    // after 26 min of annotating a deleted game).
    Promise.resolve(finishAnnotation(gameIdRef.current, viewedDuration)).then((res) => {
      if (res?.notFound) handleGhostGame();
    });
    // Persist exact playhead for resume (single-video; getLastPlayhead returns null otherwise)
    const playhead = getLastPlayheadRef.current ? getLastPlayheadRef.current() : null;
    if (playhead != null) saveLastPlayhead(gameIdRef.current, playhead);
  }, [finishAnnotation, saveLastPlayhead, handleGhostGame]);

  const handleBackToProjects = useCallback(() => {
    persistAnnotateProgress();
    // T1550: Hint ProjectManager to open on the Games tab when coming from Annotate
    sessionStorage.setItem('projectManagerTab', 'games');
    onClearSelection?.();  // Clear App.jsx's selected project (from Framing → Annotate navigation)
    setEditorMode('project-manager');
  }, [persistAnnotateProgress, onClearSelection, setEditorMode]);

  // T1550: Unified mode change handler — fires finishAnnotation before delegating
  const handleAnnotateModeChange = useCallback((newMode) => {
    if (newMode === 'project-manager') {
      handleBackToProjects();
      return;
    }
    persistAnnotateProgress();
    // When switching to framing, select the auto-project from the most recent clip
    if (newMode === 'framing') {
      const regions = clipRegionsRef.current;
      const withProject = regions.filter(r => r.autoProjectId);
      if (withProject.length > 0) {
        const latest = withProject[withProject.length - 1];
        selectProject(latest.autoProjectId);
      }
    }
    // Delegate to App.jsx mode change handler (handles project selection, confirmations)
    onModeChange?.(newMode);
  }, [handleBackToProjects, persistAnnotateProgress, selectProject, onModeChange]);

  // T8040: open Focus mode directly on a specific clip's existing reel — the
  // "Focus" button ClipDetailsEditor shows once region.autoProjectId is set.
  // Unlike handleAnnotateModeChange('framing') (which guesses the MOST RECENT
  // autoProjectId across all clips), this opens the clip the user actually
  // clicked from. Awaits selectProject (mirrors ProjectsScreen's
  // handleSelectProjectWithMode): switching mode before the project resolves
  // would route through Home for the fetch's duration (resolveEditorScreen
  // sends editorMode=framing with no selectedProject to Home) and a failed
  // fetch would strand the user there with no feedback.
  const openClipInEditorMode = useCallback(async (autoProjectId, mode) => {
    persistAnnotateProgress();
    const project = await selectProject(autoProjectId);
    if (!project) {
      toast.error("Couldn't open this reel", { message: 'Check your network and try again.' });
      return;
    }
    onModeChange?.(mode);
  }, [persistAnnotateProgress, selectProject, onModeChange]);

  const openClipInFocus = useCallback(
    (autoProjectId) => openClipInEditorMode(autoProjectId, EDITOR_MODES.FRAMING),
    [openClipInEditorMode]
  );
  // T8060: once Focus has been exported (project.has_working_video), the Reel
  // control's next-stage button is Overlay, not Focus again.
  const openClipInOverlay = useCallback(
    (autoProjectId) => openClipInEditorMode(autoProjectId, EDITOR_MODES.OVERLAY),
    [openClipInEditorMode]
  );

  // AnnotateContainer - encapsulates all annotate mode state and handlers
  // NOTE: Clips are now saved in real-time during annotation, no batch import needed
  const annotate = AnnotateContainer({
    videoRef,
    currentTime,
    duration,
    isPlaying,
    togglePlay,
    pause,
    stepForward,
    stepBackward,
    seekBackward,
    restart,
    seek,
    uploadGameVideo, // T80: Unified upload with deduplication
    getGame,
    loadGame,
    getGameVideoUrl,
    fetchProjects,
    onBackToProjects: handleBackToProjects,
    setEditorMode,
    // T8480: the creation toast's "Open Focus" action reuses T8040's
    // select+navigate gesture (persists annotate progress, awaits selectProject,
    // then delegates the mode change) - the same path the details-panel button
    // uses, NOT a bare setEditorMode that would skip progress persistence.
    onOpenReelInFocus: openClipInFocus,
  });

  const {
    annotateVideoUrl,
    annotateVideoMetadata,
    annotateGameDims,
    annotateGameName,
    annotateGameId,
    annotateSourceExpired,
    annotateFullscreen,
    showAnnotateOverlay,
    annotateSelectedLayer,
    annotatePlaybackSpeed,
    annotateContainerRef,
    isUploadingGameVideo,
    hasAnnotateClips,
    clipRegions,
    annotateRegionsWithLayout,
    annotateSelectedRegionId,
    annotateClipCount,
    isLoadingAnnotations,
    ANNOTATE_MAX_NOTES_LENGTH,
    // T10610 § C.5: per-gesture write status, driving the editor's SaveStatusBadge.
    writeStatus,
    // T5700/T6400: which layer a new clip inherits (no toggle) + clip-list layer filter
    layerFilter,
    setLayerFilter,
    // Handlers
    handleGameVideoSelect,
    handleLoadGame,
    handleToggleFullscreen,
    handleAddClipFromButton,
    handleFullscreenUpdateClip,
    handleOverlayClose,
    // T10610 § D.3: deletes the play the editor is open on.
    handleDeletePlayFromEditor,
    handleSelectRegion: handleSelectAnnotateRegion,
    handleTimelineSeek,
    setAnnotatePlaybackSpeed,
    setAnnotateSelectedLayer,
    // Clip region actions
    updateClipRegion,
    deleteClipRegion,
    // T10610 § C.4: awaited by Frame/stage CTAs before navigating.
    awaitRegionWrites,
    importAnnotations,
    getAnnotateRegionAtTime,
    selectAnnotateRegion,
    isEditMode,
    lockScrub,
    unlockScrub,
    // Cleanup
    clearAnnotateState,
    // T2750: Multi-video state (unified)
    gameVideos,
    currentVideoSequence,
    multiVideo,
    videoController,
    fullTimeline,
    // T8890: angle strip + source switching (null for angle-free games)
    angleData,
    angleSwitcher,
    // T8900: Fix-timing strip data (null unless the mode is open)
    fixTiming,
    // T8910: Add-footage-from-Annotate
    addFootage,
    amberFootage,
    onFixAmberFootage,
    getAngleName,
    effectiveCurrentTime,
    effectiveDuration,
    effectiveSeek,
    effectiveTogglePlay,
    effectiveIsPlaying,
    effectiveStepForward,
    effectiveStepBackward,
    effectiveSeekBackward,
    effectiveRestart,
    // T710: Annotation playback
    playback,
    // T2810: Teammate tag suggestions
    teammateSuggestions,
    // T2820: Shared tag tracking
    sharedTagData,
    setSharedTagData,
    // Uncommitted teammate text warning
    showTagWarning,
    dismissTagWarning,
    // T251: View progress tracking
    getViewedDuration,
    // Exact last playhead position (single-video resume)
    getLastPlayhead,
  } = annotate;

  // T2750: Compute regions with virtual offsets for timeline/sidebar display
  // T8890: an overlap game maps a clip's file times through wallToVirtual (exact
  // for any source, incl. angles crossing a boundary); an angle-free game keeps
  // the byte-identical constant-offset math on buildFullVideoTimeline.
  const isOverlapTimeline = fullTimeline?.kind === 'overlap';
  const toVirtual = useCallback((r) => {
    if (isOverlapTimeline) {
      return {
        start: fullTimeline.sourceTimeToVirtual(r.videoSequence, r.startTime),
        end: fullTimeline.sourceTimeToVirtual(r.videoSequence, r.endTime),
      };
    }
    const offset = fullTimeline.getVideoOffset(r.videoSequence);
    return { start: r.startTime + offset, end: r.endTime + offset };
  }, [isOverlapTimeline, fullTimeline]);

  const virtualRegionsWithLayout = useMemo(() => {
    if (!fullTimeline) return annotateRegionsWithLayout;
    return annotateRegionsWithLayout.map(r => {
      const v = toVirtual(r);
      return { ...r, startTime: v.start, endTime: v.end };
    });
  }, [annotateRegionsWithLayout, fullTimeline, toVirtual]);

  const virtualClipRegions = useMemo(() => {
    if (!fullTimeline) return clipRegions;
    return clipRegions.map(r => {
      const v = toVirtual(r);
      return {
        ...r,
        startTime: v.start,
        endTime: v.end,
        _actualStartTime: r.startTime,
        _actualEndTime: r.endTime,
      };
    });
  }, [clipRegions, fullTimeline, toVirtual]);

  // T2820: Compute unique tags with clip counts and clip IDs per tag
  // Only count tags from clips the user owns (not received shares)
  const tagCounts = useMemo(() => {
    const counts = {};
    clipRegions.forEach(r => {
      if (r.shared_by) return;
      (r.tagged_teammates || []).forEach(tag => {
        counts[tag] = (counts[tag] || 0) + 1;
      });
    });
    return counts;
  }, [clipRegions]);
  const hasTaggedClips = Object.keys(tagCounts).length > 0;

  const tagClipIds = useMemo(() => {
    const map = {};
    clipRegions.forEach(r => {
      if (!r.rawClipId || r.shared_by) return;
      (r.tagged_teammates || []).forEach(tag => {
        if (!map[tag]) map[tag] = [];
        map[tag].push(r.rawClipId);
      });
    });
    return map;
  }, [clipRegions]);

  // Derive unsent tags: tags with clips not yet shared
  const hasUnsentShares = useMemo(() => {
    for (const tag of Object.keys(tagClipIds)) {
      const sharedIds = sharedTagData[tag];
      if (!sharedIds) return true;
      if (tagClipIds[tag].some(id => !sharedIds.has(id))) return true;
    }
    return false;
  }, [tagClipIds, sharedTagData]);

  const handleRetryVideo = useCallback(async () => {
    if (!annotateGameId) return;
    clearError();
    await handleLoadGame(annotateGameId);
  }, [annotateGameId, clearError, handleLoadGame]);

  // Keep gameIdRef updated for handleBackToProjects
  useEffect(() => {
    gameIdRef.current = annotateGameId;
  }, [annotateGameId]);

  // Keep clipRegionsRef updated for annotate-to-framing project selection
  clipRegionsRef.current = clipRegions;

  // T251: Keep getViewedDuration ref updated for handleBackToProjects
  getViewedDurationRef.current = getViewedDuration;
  // Keep getLastPlayhead ref updated for the leave handlers
  getLastPlayheadRef.current = getLastPlayhead;

  // Handle initial game ID from sessionStorage (when loading a saved game or navigating from Framing).
  //
  // T4060 FIX: consume the pending game FIRST and load it whenever present. Do NOT bail on
  // annotateVideoUrl. T4000 now seeds the early `/api/games/{id}/video` src on the first render
  // (peekPendingGame in useAnnotateState) BEFORE the game is loaded, so the old
  // `if (annotateVideoUrl) return` guard saw that placeholder src and skipped handleLoadGame
  // entirely -> /load never ran and annotations never imported (empty Annotate timeline). A
  // pendingGameId breadcrumb means the user navigated to open that game, so loading it must win;
  // an upload/resume sets no breadcrumb, so this is a no-op for those.
  useEffect(() => {
    const pending = consumePendingGame();
    if (!pending) return;
    // T1410: AbortController so StrictMode's synthetic unmount short-circuits the first mount's load.
    const controller = new AbortController();
    isLoadingRef.current = true;

    // T3960/T10750: the reel's source clip is handed to the load seam, which
    // arms AnnotateContainer's single one-shot selection effect. This screen no
    // longer runs a retrying selector of its own (it could never observe its
    // own success — see that effect's comment).
    handleLoadGame(pending.gameId, pending.seekTime, pending.sourceClipId);
    return () => controller.abort();
  }, [handleLoadGame]);

  // T3960 retry effect REMOVED by T10750. It re-issued select+seek until the
  // selection "stuck", but it could never observe its own success: selectClip
  // runs in a passive effect (DefaultLane) while the accompanying seek writes
  // zustand through a selector-less subscription (SyncLane), so React deferred
  // the selection, the effect read NONE, and it re-fired until its 40-attempt
  // cap -- a ~32x select+seek storm on every Annotate entry. The breadcrumb is
  // now handed to handleLoadGame above and consumed ONCE by AnnotateContainer's
  // pendingSelectTargetRef effect. Do not reintroduce a retry here.

  // Handle pending game file from ProjectsScreen (when "Add Game" was clicked)
  // Supports both single-video (file) and multi-video (files array in details)
  useEffect(() => {
    const pendingFile = getPendingGameFile();
    const pendingDetails = getPendingGameDetails();
    const hasFootageList = pendingDetails?.files?.length > 0;
    if ((pendingFile || hasFootageList) && !annotateVideoUrl) {
      isLoadingRef.current = true;
      clearPendingGameFile();
      // New-game flow: pendingFile is null - handleGameVideoSelect reads the footage
      // list (files:[{file, sequence}]) from details. Resume flow passes the file.
      handleGameVideoSelect(pendingFile, pendingDetails);
    }
  }, [handleGameVideoSelect, annotateVideoUrl]);

  // Keyboard shortcuts for annotate mode
  // These are handled here (not in App.jsx) to use the same state instance
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Don't handle if typing in an input or textarea
      const tagName = event.target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea') {
        return;
      }

      // Space bar: Toggle play/pause (works in both annotate and playback modes)
      if (event.code === 'Space' && annotateVideoUrl) {
        event.preventDefault();
        if (playback?.isPlaybackMode) {
          playback.togglePlay();
        } else {
          effectiveTogglePlay();
        }
        return;
      }

      // 'A' key: Add clip (opens overlay) - works in both normal and fullscreen mode
      if ((event.key === 'a' || event.key === 'A') && annotateVideoUrl && !showAnnotateOverlay) {
        event.preventDefault();
        handleAddClipFromButton();
        return;
      }

      // Arrow keys: Navigate playhead or clips
      if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (!annotateVideoUrl) return;
        // T8960 item 9: while the Add/Edit Play editor is open the playhead is
        // constrained to the clip's green span (loop + no transport skips) — an
        // arrow-key seek / clip-nav would move it out, so those shortcuts are
        // disabled under the same gate as the removed skip buttons.
        if (showAnnotateOverlay) return;
        // Don't handle if modifier keys are pressed
        if (event.ctrlKey || event.metaKey || event.altKey) return;

        event.preventDefault();
        const isLeft = event.code === 'ArrowLeft';

        // Playhead layer: seek by seconds (back 4s, forward 8s)
        if (annotateSelectedLayer === 'playhead') {
          if (isLeft) {
            effectiveSeekBackward(4);
          } else {
            effectiveSeek(effectiveCurrentTime + 8);
          }
          return;
        }

        // T2750: All clips shown in unified mode (virtualClipRegions has virtual timestamps)
        const activeClips = virtualClipRegions;
        if (activeClips.length > 0) {
          const sortedRegions = [...activeClips].sort((a, b) => a.startTime - b.startTime);

          let currentIndex = sortedRegions.findIndex(r => r.id === annotateSelectedRegionId);
          if (currentIndex === -1) {
            currentIndex = isLeft ? sortedRegions.length : -1;
          }

          const targetIndex = isLeft
            ? Math.max(0, currentIndex - 1)
            : Math.min(sortedRegions.length - 1, currentIndex + 1);

          if (targetIndex !== currentIndex || currentIndex === -1) {
            const targetRegion = sortedRegions[targetIndex];
            selectAnnotateRegion?.(targetRegion.id);
            effectiveSeek(targetRegion.startTime);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    annotateVideoUrl,
    annotateSelectedLayer,
    virtualClipRegions,
    annotateSelectedRegionId,
    selectAnnotateRegion,
    effectiveTogglePlay,
    effectiveSeek,
    effectiveSeekBackward,
    effectiveCurrentTime,
    playback,
    showAnnotateOverlay,
    handleAddClipFromButton,
  ]);

  // NOTE: We intentionally do NOT clear state on unmount.
  // React 18 StrictMode causes double-mount in development, and clearing
  // state on the first unmount breaks the component.
  // State is cleared explicitly when needed:
  // - After importing clips to projects (in handleImportIntoProjects)
  // - When loading a new game (state is reset before loading new data)

  // Redirect to home if no video and not loading and no active upload to restore.
  // Uses redirectToMode (replaceState) to avoid back-button loops.
  useEffect(() => {
    const hasActiveUploadToRestore = activeUploadBlobUrl;
    if (!annotateVideoUrl && !isLoadingRef.current && !isUploadingGameVideo && !hasActiveUploadToRestore) {
      redirectToMode(EDITOR_MODES.PROJECT_MANAGER);
    }
  }, [annotateVideoUrl, isUploadingGameVideo, redirectToMode, activeUploadBlobUrl]);

  // If no video loaded but we're loading, render nothing (loading is fast)
  if (!annotateVideoUrl) {
    return null;
  }

  // Clear loading flag once video is ready
  if (isLoadingRef.current) {
    isLoadingRef.current = false;
  }

  const clipCountDisplay = annotateClipCount;

  return (
    <>
      {/* In-flow desktop plays panel (shrink-0 so it never gives its 352px back to the
          flex-1 canvas sibling). Shown for desktop widths and landscape phones (T4933);
          narrow desktop/tablet gets the off-canvas drawer below instead (T9920). */}
      {!useMobileClipPanel && (
      <div className="flex shrink-0">
        <ClipsSidePanel
          clipRegions={virtualClipRegions}
          selectedRegionId={playback?.isPlaybackMode ? playback.activeClipId : annotateSelectedRegionId}
          activePlaybackClipId={playback?.isPlaybackMode ? playback.activeClipId : null}
          onSelectRegion={playback?.isPlaybackMode ? playback.seekToClip : handleSelectAnnotateRegion}
          onUpdateRegion={updateClipRegion}
          onDeleteRegion={deleteClipRegion}
          onImportAnnotations={importAnnotations}
          maxNotesLength={ANNOTATE_MAX_NOTES_LENGTH}
          clipCount={clipCountDisplay}
          videoDuration={effectiveDuration}
          isLoading={isLoadingAnnotations}
          isVideoUploading={isUploadingGameVideo}
          isAdmin={isAdmin}
          onSeek={effectiveSeek}
          videoController={videoController}
          onScrubLock={lockScrub}
          onScrubUnlock={unlockScrub}
          isPlaybackMode={!!playback?.isPlaybackMode}
          clipEditorOpen={showAnnotateOverlay && !annotateFullscreen}
          teammateSuggestions={teammateSuggestions}
          boundaryOffsets={multiVideo?.boundaryOffsets}
          layerFilter={layerFilter}
          onSetLayerFilter={setLayerFilter}
          onOpenClipInFocus={openClipInFocus}
          onOpenClipInOverlay={openClipInOverlay}
          onAwaitWrites={awaitRegionWrites}
          getAngleName={getAngleName}
        />
      </div>
      )}
      {/* Mobile sidebar overlay */}
      {useMobileClipPanel && showMobileSidebar && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowMobileSidebar(false)} />
          <div className="relative w-[85vw] max-w-[352px] h-full">
            <ClipsSidePanel
              clipRegions={virtualClipRegions}
              selectedRegionId={playback?.isPlaybackMode ? playback.activeClipId : annotateSelectedRegionId}
              activePlaybackClipId={playback?.isPlaybackMode ? playback.activeClipId : null}
              onSelectRegion={playback?.isPlaybackMode ? playback.seekToClip : handleSelectAnnotateRegion}
              onUpdateRegion={updateClipRegion}
              onDeleteRegion={deleteClipRegion}
              onImportAnnotations={importAnnotations}
              maxNotesLength={ANNOTATE_MAX_NOTES_LENGTH}
              clipCount={clipCountDisplay}
              videoDuration={effectiveDuration}
              isLoading={isLoadingAnnotations}
              isVideoUploading={isUploadingGameVideo}
              isAdmin={isAdmin}
              isMobile
              isPlaybackMode={!!playback?.isPlaybackMode}
              teammateSuggestions={teammateSuggestions}
              boundaryOffsets={multiVideo?.boundaryOffsets}
              onSeek={effectiveSeek}
              videoController={videoController}
              layerFilter={layerFilter}
              onSetLayerFilter={setLayerFilter}
              onJumpToClip={(regionId, endTime) => {
                if (playback?.isPlaybackMode) {
                  playback.seekToClip(regionId);
                } else {
                  handleSelectAnnotateRegion(regionId);
                  effectiveSeek(endTime);
                }
                setShowMobileSidebar(false);
              }}
              onAwaitWrites={awaitRegionWrites}
              getAngleName={getAngleName}
            />
            <button
              onClick={() => setShowMobileSidebar(false)}
              className="absolute top-3 right-3 p-1.5 rounded-lg bg-gray-800 text-gray-400 hover:text-white z-10"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-3 pt-4 pb-48 sm:px-4 sm:pt-8 sm:pb-8">
          {/* T1550: Unified header */}
          <UnifiedHeader
            onHomeClick={handleBackToProjects}
            breadcrumbType="Games"
            breadcrumbItemName={annotateGameName}
            editorMode="annotate"
            onModeChange={handleAnnotateModeChange}
            hasProject={!!selectedProject}
            hasWorkingVideo={!!selectedProject?.working_video_id}
            hasOverlayVideo={false}
            hasAnnotateVideo={true}
            extraControls={
              useMobileClipPanel ? (
                <button
                  onClick={() => setShowMobileSidebar(true)}
                  className="flex items-center gap-1.5 px-2.5 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-300"
                  title="Show clips"
                >
                  <List size={16} />
                  <span className="text-xs font-medium">{clipCountDisplay}</span>
                </button>
              ) : null
            }
          />
          {/* T2840: Share attribution banner */}
          {shareAttribution && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 rounded-lg bg-purple-900/30 border border-purple-700/40 text-sm">
              <span className="text-gray-300">
                Shared by <span className="text-white font-medium">{shareAttribution}</span>
              </span>
              <button onClick={() => setShareAttribution(null)} className="text-gray-500 hover:text-white ml-2">
                <X size={14} />
              </button>
            </div>
          )}
          {/* T9430: honest upload-state banner next to the local preview. The local
              preview must never read as "saved online" while the upload is still in
              flight (or has failed). Isolated component so its per-tick re-render never
              reaches AnnotateScreen's redirect/restore effects (T7280 landmine). */}
          <UploadPreviewNotice gameId={annotateGameId} />
          {/* T2750: Tab UI removed -- unified timeline replaces half switching */}
          <AnnotateModeView
        // Video state
        videoController={videoController}
        annotateVideoUrl={annotateVideoUrl}
        annotateVideoMetadata={annotateVideoMetadata}
        // T10800: raw game-row dims + id for the aspect-fit stage box / the
        // explicit unknown-dimensions warning.
        gameVideoWidth={annotateGameDims?.width}
        gameVideoHeight={annotateGameDims?.height}
        gameId={annotateGameId}
        annotateContainerRef={annotateContainerRef}
        currentTime={effectiveCurrentTime}
        duration={effectiveDuration}
        isPlaying={effectiveIsPlaying}
        isLoading={isVideoLoading || isUploadingGameVideo}
        isVideoElementLoading={isVideoElementLoading}
        loadingProgress={loadingProgress}
        loadingElapsedSeconds={loadingElapsedSeconds}
        error={videoError}
        isUrlExpiredError={isUrlExpiredError}
        onRetryVideo={handleRetryVideo}
        isSourceExpired={annotateSourceExpired}
        handlers={multiVideo ? {} : handlers}
        // Fullscreen state
        annotateFullscreen={annotateFullscreen}
        showAnnotateOverlay={showAnnotateOverlay}
        // Playback
        togglePlay={effectiveTogglePlay}
        stepForward={effectiveStepForward}
        stepBackward={effectiveStepBackward}
        seekBackward={effectiveSeekBackward}
        restart={effectiveRestart}
        seek={effectiveSeek}
        onTimelineSeek={handleTimelineSeek}
        annotatePlaybackSpeed={annotatePlaybackSpeed}
        onSpeedChange={setAnnotatePlaybackSpeed}
        // Clips/regions
        annotateRegionsWithLayout={virtualRegionsWithLayout}
        annotateSelectedRegionId={annotateSelectedRegionId}
        hasAnnotateClips={hasAnnotateClips}
        clipRegions={virtualClipRegions}
        isEditMode={isEditMode}
        // Handlers
        onSelectRegion={handleSelectAnnotateRegion}
        onDeleteRegion={deleteClipRegion}
        onToggleFullscreen={handleToggleFullscreen}
        onAddClip={handleAddClipFromButton}
        getAnnotateRegionAtTime={getAnnotateRegionAtTime}
        // Fullscreen overlay handlers
        onFullscreenUpdateClip={handleFullscreenUpdateClip}
        onOverlayClose={handleOverlayClose}
        // T10610 § D.3/C.4/C.5
        onDeletePlayFromEditor={handleDeletePlayFromEditor}
        onAwaitRegionWrites={awaitRegionWrites}
        writeStatus={writeStatus}
        // Layer selection
        annotateSelectedLayer={annotateSelectedLayer}
        onLayerSelect={setAnnotateSelectedLayer}
        // Upload state
        isUploadingGameVideo={isUploadingGameVideo}
        // T8600: desktop strip's Focus button (edit mode, existingClip.autoProjectId)
        onOpenClipInFocus={openClipInFocus}
        // T9330: strip stage CTA Spotlight target
        onOpenClipInOverlay={openClipInOverlay}
        // T710: Annotation playback
        playback={playback}
        lockScrub={lockScrub}
        unlockScrub={unlockScrub}
        // Zoom (for video player)
        zoom={zoom}
        panOffset={panOffset}
        onZoomChange={zoomByWheel}
        onPanChange={updatePan}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onResetZoom={resetZoom}
        MIN_ZOOM={MIN_ZOOM}
        MAX_ZOOM={MAX_ZOOM}
        // T2750: Multi-video scrub
        multiVideo={multiVideo}
        boundaryOffsets={multiVideo?.boundaryOffsets}
        // T8890: angle strip + source switching (null for angle-free games)
        angleData={angleData}
        angleSwitcher={angleSwitcher}
        // T8900: Fix-timing strip (mode-swaps the primary CTA block)
        fixTiming={fixTiming}
        // T8910: Add footage from inside Annotate (button + drop + amber bars)
        addFootage={addFootage}
        amberFootage={amberFootage}
        onFixAmberFootage={onFixAmberFootage}
        // T2820: Share with tagged players. T9810: hasTaggedClips gates the
        // tagged-share affordance so it never renders when the modal would be empty
        // (showShareModal && hasTaggedClips is the modal's own render gate below).
        onShare={() => setShowShareModal(true)}
        hasUnsentShares={hasUnsentShares}
        hasTaggedClips={hasTaggedClips}
        teammateSuggestions={teammateSuggestions}
        // T2905/T9810: Share annotated playback (game invitations) — now the primary
        // "Share plays" action on the fullscreen bar AND the normal-view buttons.
        onSharePlayback={() => setShowPlaybackShareDialog(true)}
          />
        </div>
      </div>
      {/* T2820: Share with tagged players modal */}
      {showShareModal && hasTaggedClips && (
        <ShareWithTeammatesModal
          tagCounts={tagCounts}
          tagClipIds={tagClipIds}
          gameId={annotateGameId}
          sharedTagData={sharedTagData}
          onClose={() => setShowShareModal(false)}
          onSharedTagsChange={setSharedTagData}
        />
      )}
      {showPlaybackShareDialog && (
        <SharePlaybackDialog
          gameId={annotateGameId}
          gameName={annotateGameName || 'Untitled Game'}
          onClose={() => setShowPlaybackShareDialog(false)}
        />
      )}
      <ConfirmationDialog
        isOpen={showTagWarning}
        title="Tag not submitted"
        message="You typed a teammate name but didn't submit it. Press Enter in the teammate field to add the tag."
        buttons={[{ label: 'OK', variant: 'primary', onClick: dismissTagWarning }]}
        onClose={dismissTagWarning}
      />
    </>
  );
}

export default AnnotateScreen;
