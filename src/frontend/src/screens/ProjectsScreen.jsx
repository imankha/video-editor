import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ProjectManager } from '../components/ProjectManager';
import { DownloadsPanel } from '../components/DownloadsPanel';
import { InsufficientCreditsModal } from '../components/InsufficientCreditsModal';
import { useGameUpload } from '../hooks/useGameUpload';
import { useProjectLoader } from '../hooks/useProjectLoader';
import { useEditorStore, EDITOR_MODES } from '../stores/editorStore';
import { useExportStore } from '../stores/exportStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useGamesDataStore, useReadyGames, usePendingGameIds } from '../stores/gamesDataStore';
import { useUploadStore } from '../stores/uploadStore';
import { AppStateProvider } from '../contexts';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { PROFILING_ENABLED } from '../utils/profiling';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';
import { setPendingProject, clearPendingProject, consumePendingProject } from '../utils/pendingNavigation';
import { toast } from '../components/shared/Toast';

// Module-level variable to pass File object and game details to AnnotateScreen
// (File objects can't be serialized to sessionStorage)
let pendingGameData = null;

export function getPendingGameFile() {
  // For multi-video (per_half), files array is set instead of file
  return pendingGameData?.file || null;
}

export function getPendingGameDetails() {
  if (!pendingGameData) return null;
  return {
    opponentName: pendingGameData.opponentName,
    gameDate: pendingGameData.gameDate,
    gameType: pendingGameData.gameType,
    tournamentName: pendingGameData.tournamentName,
    videoMode: pendingGameData.videoMode || undefined,
    files: pendingGameData.files || undefined,
  };
}

export function clearPendingGameFile() {
  pendingGameData = null;
}

// One-shot guard for the navigation-resume effect. Module scope so React
// StrictMode's double effect invocation can't trigger a duplicate load
// (the resume handler re-sets the breadcrumb it just consumed).
let navigationResumeAttempted = false;

// Editor screens are lazy-loaded in App.jsx via lazyWithReload(). After a deploy,
// the still-open tab runs the OLD build and references OLD chunk hashes that no longer
// exist on the CDN. The first editor navigation then hits a purged chunk, import()
// rejects, and lazyWithReload reloads the page = the visible "refresh" (T3990).
//
// Preloading these chunks while the home screen sits idle caches the modules from the
// CURRENT build (whose chunks still exist), so the first draft click reuses an
// already-resolved module instead of a late import that can hit a purged hash.
//
// CRITICAL: these specifiers must resolve to the SAME modules as App.jsx's lazyWithReload
// imports so Vite emits the SAME chunk and shares the module registry. App.jsx (in src/)
// uses './screens/FramingScreen'; from here (src/screens/) the equivalent is
// './FramingScreen' — both resolve to src/screens/FramingScreen.jsx. A different
// specifier would produce a different chunk and defeat the fix.
const EDITOR_SCREEN_IMPORTERS = [
  () => import('./AnnotateScreen'),
  () => import('./FramingScreen'),
  () => import('./OverlayScreen'),
];

// Fire-and-forget preload of the lazy editor screen chunks. A failed preload MUST NOT
// surface to the user — lazyWithReload's reload + the breadcrumb resume below remain the
// safety net. This is code/network preloading, not data persistence, so the
// gesture-based-persistence rule does not apply. Returns a promise that always resolves.
// `importers` is a seam for tests; production always uses the literal-specifier defaults.
export function preloadEditorScreens(importers = EDITOR_SCREEN_IMPORTERS) {
  return Promise.all(
    importers.map((load) =>
      load().catch((err) => {
        console.warn('[ProjectsScreen] Editor screen preload failed:', err);
      })
    )
  );
}

/**
 * ProjectsScreen - Self-contained screen for Project Manager
 *
 * This component owns all project/game management and loading:
 * - useProjects - project CRUD operations
 * - useGames - game CRUD operations
 * - useProjectLoader - project loading with clips and working video
 * - useGalleryStore - downloads count
 *
 * Props:
 * - onStateReset - called before loading new project (App.jsx clears selection)
 * - onLoadGame - callback to navigate to annotate mode with game ID
 * - onProjectSelected - callback to sync selectedProject with App.jsx
 *
 * @see AppJSX_REDUCTION/TASK-02-self-contained-projects-screen.md
 */
export function ProjectsScreen({
  onStateReset, // Called before loading new project
  onLoadGame: onLoadGameProp, // Callback to set pendingGameId in App.jsx
  // onProjectSelected removed — selectProject updates Zustand store directly
}) {
  const setEditorMode = useEditorStore(state => state.setEditorMode);

  // Project management — Zustand store (reactive to profile switches)
  const projects = useProjectsStore(state => state.projects);
  const projectsLoading = useProjectsStore(state => state.loading);
  const projectsError = useProjectsStore(state => state.error);
  const fetchProjects = useProjectsStore(state => state.fetchProjects);
  const selectProject = useProjectsStore(state => state.selectProject);
  const createProject = useProjectsStore(state => state.createProject);
  const deleteProject = useProjectsStore(state => state.deleteProject);

  // Games management — Zustand store (ready-only: pending uploads excluded)
  const games = useReadyGames();
  const pendingGameIds = usePendingGameIds();
  const gamesLoading = useGamesDataStore(state => state.isLoading);
  const gamesError = useGamesDataStore(state => state.error);
  const fetchGames = useGamesDataStore(state => state.fetchGames);
  const deleteGame = useGamesDataStore(state => state.deleteGame);

  // Upload management hook (for pending uploads list)
  const {
    pendingUploads,
    fetchPendingUploads,
  } = useGameUpload();

  // Active upload from uploadStore (in-progress upload that persists across navigation)
  const activeUpload = useUploadStore(state => state.activeUpload);
  const cancelUpload = useUploadStore(state => state.cancelUpload);
  const insufficientCredits = useUploadStore(state => state.insufficientCredits);
  const clearInsufficientCredits = useUploadStore(state => state.clearInsufficientCredits);

  // Project loading
  const { loadProject } = useProjectLoader();

  // Gallery store for downloads panel
  const openGallery = useGalleryStore(state => state.open);
  // My Reels badge = count of NEW (unwatched) published reels, not the total.
  // Clears as the user watches reels (gesture-based, see useDownloads.markWatched).
  const unseenReelsCount = useGalleryStore(state => state.unwatchedCount);

  // Local UI state
  const [loadingProjectId, setLoadingProjectId] = useState(null);

  // Export store for global export state (uses new activeExports system)
  // Note: useExportRecovery in App.jsx handles syncing with server on startup
  // This component only reads from the store - single source of truth
  const activeExports = useExportStore(state => state.activeExports);
  const getProcessingExports = useExportStore(state => state.getProcessingExports);

  useEffect(() => {
    setWarmupPriority(WARMUP_PRIORITY.DRAFT_REELS);
  }, []);

  // Warm the lazy editor screen chunks while the home screen sits idle, so the first
  // draft/project click reuses an already-resolved module instead of a late import that
  // could hit a chunk hash purged by a deploy (T3990). Runs once on mount; the failed
  // case is swallowed inside preloadEditorScreens (lazyWithReload + breadcrumb resume
  // stay as the safety net).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let idleHandle;
    let timeoutId;
    if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => preloadEditorScreens(), { timeout: 2000 });
    } else {
      // Safari / older browsers: no requestIdleCallback — fall back to a short timer.
      timeoutId = setTimeout(() => preloadEditorScreens(), 1500);
    }
    return () => {
      if (idleHandle !== undefined && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, []);

  // Listen for export completion events and refresh project list
  useEffect(() => {
    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', (data, exportId) => {
      fetchProjects();
    });

    const unsubError = exportWebSocketManager.addEventListener('*', 'error', (data, exportId) => {
      fetchProjects();
    });

    return () => {
      unsubComplete();
      unsubError();
    };
  }, [fetchProjects]);

  // Fetch pending uploads after bootstrap has had time to complete.
  // Bootstrap includes pending_uploads data; this is a fallback for
  // cases where bootstrap fails or the user navigates back later.
  useEffect(() => {
    const id = setTimeout(() => fetchPendingUploads(), 3000);
    return () => clearTimeout(id);
  }, [fetchPendingUploads]);

  // Handle project selection
  const handleSelectProject = useCallback(async (projectId) => {
    console.log('[ProjectsScreen] Selecting project:', projectId);
    if (PROFILING_ENABLED) performance.mark('gesture:open-project:start');
    setLoadingProjectId(projectId);
    // Breadcrumb so the selection survives a lazyWithReload page reload
    // (post-deploy stale chunk hash); cleared in finally once the load settles
    setPendingProject(projectId);

    try {
      // Clear App.jsx state before loading new project
      if (onStateReset) {
        onStateReset();
      }

      // Fetch project details (selectProject updates the Zustand store,
      // which App.jsx reads reactively — no separate callback needed)
      const project = await selectProject(projectId);
      if (!project) {
        console.error('[ProjectsScreen] Failed to fetch project', projectId);
        toast.error("Couldn't open this draft", {
          message: 'The connection dropped. Check your network and try again.',
          action: { label: 'Retry', onClick: () => handleSelectProject(projectId) },
        });
        return;
      }

      // Load project with all associated data
      const result = await loadProject(project);

      // Sync with editorStore for legacy compatibility
      setEditorMode(result.mode);

      console.log('[ProjectsScreen] Project loaded:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      clearPendingProject();
      if (PROFILING_ENABLED) {
        performance.mark('gesture:open-project:end');
        try {
          const m = performance.measure('gesture:open-project', 'gesture:open-project:start', 'gesture:open-project:end');
           
          console.info(`[GESTURE] open-project duration=${Math.round(m.duration)}ms`);
        } catch { /* marks cleared */ }
        performance.clearMarks('gesture:open-project:start');
        performance.clearMarks('gesture:open-project:end');
      }
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject, setEditorMode, onStateReset]);

  // Handle project selection with mode override
  const handleSelectProjectWithMode = useCallback(async (projectId, options = {}) => {
    console.log('[ProjectsScreen] Selecting project with mode:', projectId, options);
    setLoadingProjectId(projectId);
    // Breadcrumb so the selection survives a lazyWithReload page reload
    // (post-deploy stale chunk hash); cleared in finally once the load settles
    setPendingProject(projectId, options);

    try {
      // Clear App.jsx state before loading new project
      if (onStateReset) {
        onStateReset();
      }

      // Fetch project details
      const project = await selectProject(projectId);
      if (!project) {
        console.error('[ProjectsScreen] Failed to fetch project', projectId);
        toast.error("Couldn't open this draft", {
          message: 'The connection dropped. Check your network and try again.',
          action: { label: 'Retry', onClick: () => handleSelectProjectWithMode(projectId, options) },
        });
        return;
      }

      // Set mode immediately to prevent flash (e.g. framing flash before overlay)
      if (options.mode) {
        setEditorMode(options.mode);
      }

      // Load project with all associated data
      const result = await loadProject(project, {
        mode: options.mode,
        clipIndex: options.clipIndex,
      });

      // Sync with editorStore for legacy compatibility
      setEditorMode(result.mode);

      console.log('[ProjectsScreen] Project loaded with mode:', result);
    } catch (err) {
      console.error('[ProjectsScreen] Failed to select project:', err);
    } finally {
      clearPendingProject();
      setLoadingProjectId(null);
    }
  }, [selectProject, loadProject, setEditorMode, onStateReset]);

  // Resume a project navigation interrupted by a full page reload (chunk
  // reload after a deploy, see lazyWithReload in App.jsx). editorStore already
  // restored the mode from the URL; the breadcrumb restores which project was
  // clicked. Games recover the same way via pendingGameId in AnnotateScreen.
  useEffect(() => {
    if (navigationResumeAttempted) return;
    navigationResumeAttempted = true;
    const pending = consumePendingProject();
    if (!pending) return;
    const mode = useEditorStore.getState().editorMode;
    if (mode !== EDITOR_MODES.FRAMING && mode !== EDITOR_MODES.OVERLAY) return;
    console.log('[ProjectsScreen] Resuming interrupted project navigation:', pending);
    if (pending.mode) {
      handleSelectProjectWithMode(pending.projectId, {
        mode: pending.mode,
        clipIndex: pending.clipIndex ?? undefined,
      });
    } else {
      handleSelectProject(pending.projectId);
    }
  }, [handleSelectProject, handleSelectProjectWithMode]);

  // Handle game loading (navigate to annotate)
  const handleLoadGame = useCallback((gameId) => {
    console.log('[ProjectsScreen] Loading game:', gameId);
    // Call App.jsx callback to set pendingGameId state
    if (onLoadGameProp) {
      onLoadGameProp(gameId);
    }
  }, [onLoadGameProp]);

  // Handle annotate with file and game details (navigate to annotate mode with pre-selected data)
  // The data is stored in module-level variable and picked up by AnnotateScreen
  const handleAnnotateWithFile = useCallback((gameData) => {
    pendingGameData = gameData;
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Ref to prevent multiple resume triggers
  const isResumingRef = useRef(false);

  // Handle resuming a pending upload
  // Navigate to Annotate mode with the file - same flow as new upload
  // The backend handles resume detection: same hash = resume, different hash = new upload
  const handleResumeUpload = useCallback((file, expectedFilename) => {
    // Prevent multiple triggers (double-click, re-render, etc.)
    if (isResumingRef.current) {
      console.log('[ProjectsScreen] Resume already in progress, ignoring');
      return;
    }
    isResumingRef.current = true;

    console.log('[ProjectsScreen] Resuming upload, navigating to Annotate:', file.name);

    // Warn if filename doesn't match (quick check, not hash)
    if (expectedFilename && file.name !== expectedFilename) {
      const proceed = window.confirm(
        `The selected file "${file.name}" has a different name than the original "${expectedFilename}".\n\n` +
        `If this is the same video file (just renamed), click OK to continue.\n` +
        `If this is a different file, click Cancel and select the correct file.`
      );
      if (!proceed) {
        isResumingRef.current = false;
        return;
      }
    }

    // Navigate to Annotate mode with the file - same as new upload flow
    // AnnotateScreen will handle the upload and show progress
    pendingGameData = { file };
    setEditorMode('annotate');

    // Reset after a short delay to allow navigation to complete
    setTimeout(() => {
      isResumingRef.current = false;
    }, 1000);
  }, [setEditorMode]);

  // Handle cancelling a pending upload
  const handleCancelPendingUpload = useCallback(async (sessionId) => {
    console.log('[ProjectsScreen] Cancelling upload:', sessionId);
    try {
      const { cancelUpload } = await import('../services/uploadManager');
      await cancelUpload(sessionId);
      await fetchPendingUploads();
    } catch (err) {
      console.error('[ProjectsScreen] Cancel upload failed:', err);
    }
  }, [fetchPendingUploads]);

  // Handle clicking the active upload - navigate back to annotate mode
  const handleClickActiveUpload = useCallback(() => {
    console.log('[ProjectsScreen] Clicking active upload, navigating to annotate');
    setEditorMode('annotate');
  }, [setEditorMode]);

  // Compute exporting project from the global activeExports store
  // Find first actively processing export to display in the UI
  const activeExportingProject = (() => {
    const processingExports = Object.values(activeExports).filter(
      exp => exp.status === 'pending' || exp.status === 'processing'
    );
    if (processingExports.length === 0) return null;

    // Return the most recent one
    const mostRecent = processingExports.sort(
      (a, b) => new Date(b.startedAt) - new Date(a.startedAt)
    )[0];

    return {
      projectId: mostRecent.projectId,
      stage: mostRecent.type,
      exportId: mostRecent.exportId,
      progress: mostRecent.progress
    };
  })();

  // App state for context (for components that need it)
  const appStateValue = {
    editorMode: 'project-manager',
    selectedProjectId: null,
    selectedProject: null,
    exportingProject: activeExportingProject,
    unseenReelsCount,
  };

  return (
    <AppStateProvider value={appStateValue}>
      <div className="bg-gray-900">
        <ProjectManager
          projects={projects}
          loading={projectsLoading || loadingProjectId !== null}
          error={projectsError}
          loadingProjectId={loadingProjectId}
          onSelectProject={handleSelectProject}
          onSelectProjectWithMode={handleSelectProjectWithMode}
          onCreateProject={createProject}
          onRefreshProjects={fetchProjects}
          onDeleteProject={deleteProject}
          onAnnotateWithFile={handleAnnotateWithFile}
          // Games props
          games={games}
          gamesLoading={gamesLoading}
          gamesError={gamesError}
          onLoadGame={handleLoadGame}
          onDeleteGame={deleteGame}
          onFetchGames={fetchGames}
          onOpenDownloads={openGallery}
          // Pending uploads props
          pendingUploads={pendingUploads}
          onResumeUpload={handleResumeUpload}
          onCancelPendingUpload={handleCancelPendingUpload}
          // Active upload props (in-progress upload)
          activeUpload={activeUpload}
          onClickActiveUpload={handleClickActiveUpload}
          onCancelActiveUpload={cancelUpload}
          // Pending game IDs for blocking project cards
          pendingGameIds={pendingGameIds}
        />

        {/* Downloads Panel */}
        <DownloadsPanel
          onOpenProject={(projectId) => {
            handleSelectProjectWithMode(projectId, { mode: 'framing' });
          }}
        />

        {/* T1580: Insufficient credits for game upload */}
        {insufficientCredits && (
          <InsufficientCreditsModal
            required={insufficientCredits.required}
            available={insufficientCredits.balance}
            description={`This upload requires ${insufficientCredits.required} credit${insufficientCredits.required !== 1 ? 's' : ''} for 30 days of storage.`}
            onClose={clearInsufficientCredits}
            onBuyCredits={clearInsufficientCredits}
          />
        )}
      </div>
    </AppStateProvider>
  );
}

export default ProjectsScreen;
