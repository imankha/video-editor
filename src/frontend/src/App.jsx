import { useMemo, useRef, useCallback, useEffect } from 'react';
import { Home, Scissors, LogIn, ShieldCheck } from 'lucide-react';
import { warmAllUserVideos, setWarmupPriority, WARMUP_PRIORITY } from './utils/cacheWarming';
import { initSession, setGuestWriteCallback } from './utils/sessionInit';
import { ConnectionStatus } from './components/ConnectionStatus';
import { DownloadsPanel } from './components/DownloadsPanel';
import { CreditBalance } from './components/CreditBalance';
import { GalleryButton } from './components/GalleryButton';
import { QuestPanel } from './components/QuestPanel';
import { GlobalExportIndicator } from './components/GlobalExportIndicator';
import { UploadProgressIndicator } from './components/UploadProgressIndicator';
import { SyncStatusIndicator } from './components/SyncStatusIndicator';
import { useExportRecovery } from './hooks/useExportRecovery';
import { Breadcrumb, Button, ConfirmationDialog, ModeSwitcher, ToastContainer } from './components/shared';
import DebugInfo from './components/DebugInfo';
import { getProjectDisplayName } from './utils/clipDisplayName';
// Screen components (self-contained, own their hooks)
import { FramingScreen, OverlayScreen, AnnotateScreen, ProjectsScreen, AdminScreen } from './screens';
import { AppStateProvider, ProjectProvider } from './contexts';
import { AuthGateModal } from './components/AuthGateModal';
import { GoogleOneTap } from './components/GoogleOneTap';
import { AccountSettings } from './components/AccountSettings';
import { useEditorStore, useExportStore, useFramingStore, useOverlayStore, useProjectDataStore, useProjectsStore, useProfileStore, useVideoStore, useGamesDataStore, useSettingsStore, useGalleryStore, EDITOR_MODES } from './stores';
import { useAuthStore } from './stores/authStore';
import { useQuestStore } from './stores/questStore';
import { useCreditStore } from './stores/creditStore';
import { toast } from './components/shared';
import { API_BASE } from './config';

/**
 * App.jsx - Main application shell
 *
 * This component handles:
 * - Editor mode switching (framing, overlay, annotate, project-manager)
 * - Project selection coordination
 * - Mode switch confirmation dialogs
 * - Global UI (header, downloads panel)
 * - Routing to appropriate screen components
 *
 * Screen-specific logic is now in:
 * - FramingScreen - all framing hooks, clip management, video playback
 * - OverlayScreen - all overlay hooks, highlight regions, video playback
 * - AnnotateScreen - all annotate hooks, game management
 * - ProjectsScreen - project listing, game listing
 */
function App() {
  // Editor mode state from Zustand store
  const {
    editorMode,
    setEditorMode,
    modeSwitchDialog,
    openModeSwitchDialog,
    closeModeSwitchDialog,
  } = useEditorStore();

  // Export state from Zustand store
  const {
    exportingProject,
    startExport,
    clearExport,
    globalExportProgress,
    setGlobalExportProgress,
  } = useExportStore();

  // Framing store - for detecting uncommitted changes in mode switch
  const framingChangedSinceExport = useFramingStore(state => state.framingChangedSinceExport);

  // Working video from project data store (canonical owner)
  const workingVideo = useProjectDataStore(state => state.workingVideo);

  // Overlay store - for loading state and tracking changes
  const isLoadingWorkingVideo = useOverlayStore(state => state.isLoadingWorkingVideo);
  const overlayChangedSinceExport = useOverlayStore(state => state.overlayChangedSinceExport);

  // Clip data for "Edit in Annotate" button - single source of truth from projectDataStore
  const selectedClipId = useProjectDataStore(state => state.selectedClipId);
  const clips = useProjectDataStore(state => state.clips);

  // Derive selected clip - memoized to avoid recalculation
  const selectedClipForAnnotate = useMemo(() => {
    if (selectedClipId && clips.length > 0) {
      const clip = clips.find(c => c.id === selectedClipId);
      if (clip) return clip;
    }
    // Fall back to first clip if nothing selected
    return clips?.[0] ?? null;
  }, [selectedClipId, clips]);

  // Project management — Zustand store (reactive to profile switches)
  const selectedProject = useProjectsStore(state => state.selectedProject);
  const selectedProjectId = useProjectsStore(state => state.selectedProjectId);
  const fetchProjects = useProjectsStore(state => state.fetchProjects);
  const selectProject = useProjectsStore(state => state.selectProject);
  const clearSelection = useProjectsStore(state => state.clearSelection);
  const discardUncommittedChanges = useProjectsStore(state => state.discardUncommittedChanges);

  // T85a: Initialize session (profile ID header) then warm video cache.
  // T85b: Also fetch profiles for the profile switcher.
  // The backend auto-resolves profile if header is missing, so no render gate needed.
  useEffect(() => {
    // Wire guest-write callback: any successful mutating API call while guest marks activity
    setGuestWriteCallback(() => useAuthStore.getState().markGuestActivity());

    // Update preloader progress bar
    const updatePreloader = (percent, message) => {
      if (window.__preloaderUpdate) window.__preloaderUpdate(percent, message);
    };

    // Dismiss preloader overlay (added outside #root in index.html)
    const dismissPreloader = () => {
      updatePreloader(100, 'Ready');
      const preloader = document.getElementById('preloader');
      if (preloader) {
        // Brief pause at 100% so user sees completion
        setTimeout(() => {
          preloader.classList.add('fade-out');
          setTimeout(() => preloader.remove(), 300);
        }, 150);
      }
    };

    initSession().then(() => {
      // T630/T635: Fire all initial data fetches in parallel after auth resolves
      warmAllUserVideos();
      const dataFetches = [
        useProfileStore.getState().fetchProfiles(),
        useProjectsStore.getState().fetchProjects(),
        useGamesDataStore.getState().fetchGames(),
        useQuestStore.getState().fetchDefinitions(),
        useQuestStore.getState().fetchProgress(),
        useSettingsStore.getState().loadSettings(),
        useGalleryStore.getState().fetchCount(),
      ];

      // Track data fetch progress: 40% → 90%, dismiss at 100%
      let completed = 0;
      let dismissed = false;
      const total = dataFetches.length;
      const tryDismiss = () => { if (!dismissed) { dismissed = true; dismissPreloader(); } };
      dataFetches.forEach(p => {
        const tick = () => {
          completed++;
          const pct = 40 + Math.round((completed / total) * 50);
          updatePreloader(pct, 'Loading your data...');
          if (completed >= total) tryDismiss();
        };
        Promise.resolve(p).then(tick, tick);
      });
      // Safety: dismiss after 8s even if a fetch hangs
      setTimeout(tryDismiss, 8000);

      // Restore navigation state after auth-triggered reload (cross-device recovery)
      const authReturnMode = sessionStorage.getItem('authReturnMode');
      const authReturnProjectId = sessionStorage.getItem('authReturnProjectId');
      const authReturnGameHash = sessionStorage.getItem('authReturnGameHash');
      const authReturnGameName = sessionStorage.getItem('authReturnGameName');
      sessionStorage.removeItem('authReturnMode');
      sessionStorage.removeItem('authReturnProjectId');
      sessionStorage.removeItem('authReturnGameHash');
      sessionStorage.removeItem('authReturnGameName');

      if (authReturnMode) {
        if (authReturnMode === 'annotate' && (authReturnGameHash || authReturnGameName)) {
          // T415: Restore annotation mode — wait for games to load, then navigate
          // AnnotateScreen loads games via pendingGameId in sessionStorage, not selectGame()
          const waitForGames = setInterval(() => {
            const games = useGamesDataStore.getState().games;
            if (games.length === 0) return;
            const game = authReturnGameHash
              ? games.find(g => g.blake3_hash === authReturnGameHash)
              : games.find(g => g.name === authReturnGameName);
            if (game) {
              clearInterval(waitForGames);
              sessionStorage.setItem('pendingGameId', game.id.toString());
              useEditorStore.getState().setEditorMode('annotate');
            }
          }, 100);
          setTimeout(() => clearInterval(waitForGames), 5000);
        } else if (authReturnProjectId) {
          useProjectsStore.getState().selectProject(authReturnProjectId);
          useEditorStore.getState().setEditorMode(authReturnMode);
        } else {
          useEditorStore.getState().setEditorMode(authReturnMode);
        }
      }

      // Payment return: restore editor state and auto-export if redirected from Stripe.
      const paymentParams = new URLSearchParams(window.location.search);
      const payment = paymentParams.get('payment');
      const paymentSessionId = paymentParams.get('session_id');
      if (payment) {
        // Remove query params without reload
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('payment');
        cleanUrl.searchParams.delete('session_id');
        window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.hash);

        // Restore editor state saved before Stripe redirect
        const returnMode = sessionStorage.getItem('paymentReturnMode');
        const returnProjectId = sessionStorage.getItem('paymentReturnProjectId');
        const autoExport = sessionStorage.getItem('paymentAutoExport');
        sessionStorage.removeItem('paymentReturnMode');
        sessionStorage.removeItem('paymentReturnProjectId');
        sessionStorage.removeItem('paymentAutoExport');

        if (returnProjectId) {
          useProjectsStore.getState().selectProject(returnProjectId);
        }
        if (returnMode) {
          useEditorStore.getState().setEditorMode(returnMode);
        }

        if (payment === 'success' && paymentSessionId) {
          fetch(`${API_BASE}/api/payments/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ session_id: paymentSessionId }),
          })
            .then((res) => res.json())
            .then((data) => {
              useCreditStore.getState().fetchCredits();
              if (data.status === 'credits_granted' || data.status === 'already_processed') {
                const credits = data.credits || 0;
                toast.success(`${credits} credits added to your balance!`);
                // Auto-trigger export if user was mid-export when redirected
                if (autoExport) {
                  setTimeout(() => exportButtonRef.current?.triggerExport(), 500);
                }
              } else {
                toast.info('Payment is still processing. Your credits will appear shortly.');
              }
            })
            .catch((err) => {
              console.error('[App] Verify failed:', err);
              useCreditStore.getState().fetchCredits();
              toast.error('Could not verify payment. Your credits may still be added shortly.');
            });
        }
      }
    }).catch((err) => {
      console.error('[App] Session init failed after retries:', err);
      // Clear isCheckingSession so the app renders instead of staying white
      useAuthStore.getState().setSessionState(false);
      dismissPreloader();
    });
  }, []);

  const hasGuestActivity = useAuthStore(state => state.hasGuestActivity);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const isAdmin = useAuthStore(state => state.isAdmin);
  const isCheckingSession = useAuthStore(state => state.isCheckingSession);
  const requireAuth = useAuthStore(state => state.requireAuth);
  const migrationPending = useAuthStore(state => state.migrationPending);
  const retryMigration = useAuthStore(state => state.retryMigration);

  // Export recovery - reconnects to active exports on app startup
  useExportRecovery();

  // T525: Payment return is handled inside initSession().then(...) above
  // so the session cookie is ready before the verify API call.

  // T540: Record achievement when user enters framing mode
  // T635: Gate on !isCheckingSession to avoid firing before auth completes
  // Also require a selected project — editorMode defaults to FRAMING on initial load
  // before redirecting to Projects, which would falsely trigger the achievement.
  useEffect(() => {
    if (!isCheckingSession && editorMode === EDITOR_MODES.FRAMING && selectedProjectId) {
      useQuestStore.getState().recordAchievement('opened_framing_editor');
    }
  }, [editorMode, isCheckingSession, selectedProjectId]);

  // Export button ref (for triggering export programmatically from mode switch dialog)
  const exportButtonRef = useRef(null);


  // Export completion callback - used by Screen components to refresh data
  const handleExportComplete = useCallback(async () => {
    await fetchProjects({ force: true });
    // Downloads count is auto-refreshed by DownloadsPanel via galleryStore
    // T540: Refresh quest progress after any export completes
    useQuestStore.getState().fetchProgress();
    // T770: Navigate home after overlay export completes
    if (editorMode === EDITOR_MODES.OVERLAY) {
      clearSelection();
      useVideoStore.getState().reset();
      setEditorMode(EDITOR_MODES.PROJECT_MANAGER);
      // T780: Auto-open Gallery so user sees their finished video immediately
      setTimeout(() => useGalleryStore.getState().open(), 500);
    }
  }, [fetchProjects, editorMode, clearSelection, setEditorMode]);

  // Handler for loading saved games from ProjectManager
  // Sets pendingGameId in sessionStorage and navigates to annotate mode
  const handleLoadGame = useCallback((gameId) => {
    console.log('[App] Loading game - setting pendingGameId in sessionStorage:', gameId);
    setWarmupPriority(WARMUP_PRIORITY.GAMES); // Prioritize game video warming
    sessionStorage.setItem('pendingGameId', gameId.toString());
    setEditorMode(EDITOR_MODES.ANNOTATE);
  }, [setEditorMode]);

  // Computed state for UI
  const hasOverlayVideo = !!workingVideo?.url;

  // Handler for "Edit in Annotate" button - navigates to Annotate mode with clip's game
  const handleEditInAnnotate = useCallback(() => {
    const gameId = selectedClipForAnnotate?.game_id;
    if (!gameId) return;

    setWarmupPriority(WARMUP_PRIORITY.GAMES); // Prioritize game video warming

    // Store navigation intent for AnnotateScreen to pick up
    sessionStorage.setItem('pendingGameId', gameId.toString());
    const startTime = selectedClipForAnnotate?.start_time;
    if (startTime != null) {
      sessionStorage.setItem('pendingClipSeekTime', startTime.toString());
    }

    // Reset video store to clear stale clipOffset/clipDuration from framing mode
    useVideoStore.getState().reset();

    // Switch to annotate mode
    setEditorMode(EDITOR_MODES.ANNOTATE);
  }, [selectedClipForAnnotate, setEditorMode]);

  // Check if we can edit in annotate (clip has game association)
  const canEditInAnnotate = !!selectedClipForAnnotate?.game_id;

  // Handle mode change between Framing, Overlay, and Project Manager
  const handleModeChange = useCallback((newMode) => {
    if (newMode === editorMode) return;

    console.log(`[App] Switching from ${editorMode} to ${newMode} mode`);

    // Check if leaving framing with uncommitted changes
    // Only show confirmation when there's a working video that would be invalidated
    // With gesture-based sync, framing data is auto-saved, so we only need to warn about
    // re-exporting if there's an existing working video
    if (editorMode === EDITOR_MODES.FRAMING && framingChangedSinceExport && hasOverlayVideo) {
      console.log('[App] Framing changes would invalidate working video - showing confirmation dialog');
      openModeSwitchDialog(newMode, EDITOR_MODES.FRAMING);
      return;
    }

    // Check if leaving overlay with uncommitted changes (and project has final video)
    if (editorMode === EDITOR_MODES.OVERLAY && overlayChangedSinceExport && selectedProject?.has_final_video) {
      console.log('[App] Uncommitted overlay changes detected - showing confirmation dialog');
      openModeSwitchDialog(newMode, EDITOR_MODES.OVERLAY);
      return;
    }

    // For project-manager, also clear selection and refresh projects
    if (newMode === EDITOR_MODES.PROJECT_MANAGER) {
      clearSelection();
      fetchProjects();
    }

    // T580: Reset shared video store on mode switch to prevent stale video
    // from the previous mode (e.g., working video from overlay showing in framing)
    useVideoStore.getState().reset();

    setEditorMode(newMode);
  }, [editorMode, hasOverlayVideo, framingChangedSinceExport, overlayChangedSinceExport, selectedProject?.has_final_video, openModeSwitchDialog, setEditorMode, clearSelection, fetchProjects]);

  // Mode switch dialog handlers
  const handleModeSwitchCancel = useCallback(() => {
    closeModeSwitchDialog();
  }, [closeModeSwitchDialog]);

  const handleModeSwitchExport = useCallback(() => {
    const sourceMode = modeSwitchDialog.sourceMode;
    closeModeSwitchDialog();
    console.log('[App] User chose to export first - triggering export');
    if (exportButtonRef.current?.triggerExport) {
      exportButtonRef.current.triggerExport();
    }
    // Clear the "changed" flag since we triggered an export - user shouldn't be prompted again
    if (sourceMode === EDITOR_MODES.FRAMING) {
      useFramingStore.getState().setFramingChangedSinceExport(false);
    } else if (sourceMode === EDITOR_MODES.OVERLAY) {
      useOverlayStore.getState().setOverlayChangedSinceExport(false);
    }
  }, [closeModeSwitchDialog, modeSwitchDialog.sourceMode]);

  const handleModeSwitchDiscard = useCallback(async () => {
    const targetMode = modeSwitchDialog.pendingMode;
    const sourceMode = modeSwitchDialog.sourceMode;

    // Handle discard based on source mode
    if (sourceMode === EDITOR_MODES.OVERLAY) {
      // For overlay, just reset the changed flag (changes are auto-saved to backend)
      console.log('[App] Discarding overlay changes (resetting flag)');
      useOverlayStore.getState().setOverlayChangedSinceExport(false);
    } else if (selectedProjectId) {
      // For framing, call the backend to discard uncommitted changes
      try {
        console.log('[App] Discarding framing changes');
        await discardUncommittedChanges(selectedProjectId);
      } catch (err) {
        console.error('[App] Failed to discard framing changes:', err);
      }
    }

    closeModeSwitchDialog();

    // Handle project-manager specific cleanup
    if (targetMode === EDITOR_MODES.PROJECT_MANAGER) {
      clearSelection();
      fetchProjects();
    }

    setEditorMode(targetMode || EDITOR_MODES.PROJECT_MANAGER);
  }, [selectedProjectId, discardUncommittedChanges, closeModeSwitchDialog, setEditorMode, modeSwitchDialog.pendingMode, modeSwitchDialog.sourceMode, clearSelection, fetchProjects]);

  // Backward-compatible wrapper for setExportingProject
  const setExportingProject = useCallback((value) => {
    if (value === null) {
      clearExport();
    } else {
      // Note: startExport expects (exportId, projectId, type)
      startExport(value.exportId, value.projectId, value.stage);
    }
  }, [clearExport, startExport]);

  // App-level shared state for context
  const appStateValue = useMemo(() => ({
    editorMode,
    setEditorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,
  }), [
    editorMode,
    setEditorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,
  ]);

  // Block rendering until session is resolved — prevents data fetches from firing
  // before the user identity is established (would fall back to DEFAULT_USER_ID)
  if (isCheckingSession) return null;

  // T550: Admin panel — rendered regardless of project selection
  if (editorMode === EDITOR_MODES.ADMIN) {
    return (
      <>
        <AdminScreen onBack={() => setEditorMode(EDITOR_MODES.PROJECT_MANAGER)} />
        <ToastContainer />
      </>
    );
  }

  // If no project selected and not in annotate mode, show ProjectsScreen
  if (!selectedProject && editorMode !== EDITOR_MODES.ANNOTATE) {
    return (
      <>
        <ProjectsScreen
            onStateReset={clearSelection}
            onLoadGame={handleLoadGame}
          />
        {/* Global Export Indicator - shows progress on ProjectsScreen too */}
        <GlobalExportIndicator />
        {/* Upload Progress Indicator - shows upload progress on all screens */}
        <UploadProgressIndicator />
        {/* Sync Status Indicator - shows when R2 sync has failed */}
        <SyncStatusIndicator />
        {/* T435: Google One Tap auto-prompt for guest users */}
        <GoogleOneTap />
        {/* Auth Gate Modal - shows when GPU action requires authentication */}
        <AuthGateModal />
        {/* T430: Account Settings panel */}
        <AccountSettings />
        {/* Toast Notifications */}
        <ToastContainer />
        {/* Guest activity banner — only shown after guest does meaningful work */}
        {hasGuestActivity && !isAuthenticated && <GuestSaveBanner onSignIn={() => requireAuth(() => {})} />}
        {/* T820: Migration retry banner — shown when guest migration failed */}
        {migrationPending && <MigrationRetryBanner onRetry={retryMigration} />}
        {/* Quest overlay — auto-shows for new users (T540) */}
        <QuestPanel />
        {/* Admin button — fixed top-right, visible only to admins */}
        {isAdmin && <AdminButton onClick={() => setEditorMode(EDITOR_MODES.ADMIN)} />}
      </>
    );
  }

  return (
    <ProjectProvider>
    <AppStateProvider value={appStateValue}>
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Connection status banner - shows when backend is unreachable */}
      <ConnectionStatus />
      {/* Guest activity banner — only shown after guest does meaningful work */}
      {hasGuestActivity && !isAuthenticated && <GuestSaveBanner onSignIn={() => requireAuth(() => {})} />}
      {/* T820: Migration retry banner — shown when guest migration failed */}
      {migrationPending && <MigrationRetryBanner onRetry={retryMigration} />}
      {/* Annotate mode: AnnotateScreen handles its own sidebar + main content */}
      {editorMode === EDITOR_MODES.ANNOTATE && <AnnotateScreen onClearSelection={clearSelection} />}

      {/* Main Content - For framing/overlay modes */}
      {editorMode !== EDITOR_MODES.ANNOTATE && (
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-3 py-4 sm:px-4 sm:py-8">
          {/* Header */}
          <div className="flex flex-col-reverse sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-0 mb-4 sm:mb-8">
            <div className="flex items-center gap-2 sm:gap-4 min-w-0">
              {/* Back to Home button */}
              <Button
                variant="ghost"
                icon={Home}
                iconOnly
                onClick={() => handleModeChange(EDITOR_MODES.PROJECT_MANAGER)}
                title="Home"
              />
              <Breadcrumb
                type="Projects"
                itemName={getProjectDisplayName(selectedProject)}
              />
            </div>
            <div className="flex items-center gap-1 sm:gap-2">
              <CreditBalance />
              <GalleryButton />
              {isAdmin && <AdminButton onClick={() => setEditorMode(EDITOR_MODES.ADMIN)} />}
              {/* Combined mode switcher with Annotate button */}
              <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                {/* Edit in Annotate button - styled like mode tabs */}
                {canEditInAnnotate && (
                  <button
                    onClick={handleEditInAnnotate}
                    className="flex items-center gap-2 px-2 sm:px-4 py-2 rounded-md transition-all duration-200 text-gray-400 hover:text-white hover:bg-white/10"
                    title="Edit source clip in Annotate mode"
                  >
                    <Scissors size={16} />
                    <span className="font-medium text-sm hidden sm:inline">Annotate</span>
                  </button>
                )}
                {/* Framing/Overlay mode toggle - rendered inline */}
                <ModeSwitcher
                  mode={editorMode}
                  onModeChange={handleModeChange}
                  disabled={false}
                  hasOverlayVideo={hasOverlayVideo}
                  framingOutOfSync={framingChangedSinceExport && hasOverlayVideo}
                  hasAnnotateVideo={false}
                  isLoadingWorkingVideo={isLoadingWorkingVideo}
                  inline={true}
                />
              </div>
            </div>
          </div>

          {/* Mode-specific views */}
          {editorMode === EDITOR_MODES.FRAMING && (
            <FramingScreen
              onExportComplete={handleExportComplete}
              exportButtonRef={exportButtonRef}
            />
          )}

          {editorMode === EDITOR_MODES.OVERLAY && (
            <OverlayScreen
              onExportComplete={handleExportComplete}
              exportButtonRef={exportButtonRef}
            />
          )}

        </div>
      </div>
      )}

      {/* Debug Info */}
      <DebugInfo />

      {/* Global Export Indicator - shows progress across all screens */}
      <GlobalExportIndicator />

      {/* Upload Progress Indicator - shows upload progress on all screens */}
      <UploadProgressIndicator />

      {/* Sync Status Indicator - shows when R2 sync has failed */}
      <SyncStatusIndicator />

      {/* Downloads Panel */}
      <DownloadsPanel
        onOpenProject={(projectId) => {
          // Only re-fetch project if it's not already selected
          if (projectId !== selectedProjectId) {
            selectProject(projectId);
          }
          // Always switch to overlay mode (handles case where user is in annotate)
          setEditorMode(EDITOR_MODES.OVERLAY);
        }}
      />

      {/* Quest Panel (T540) */}
      <QuestPanel />

      {/* Mode Switch Confirmation Dialog */}
      <ConfirmationDialog
        isOpen={modeSwitchDialog.isOpen}
        title={modeSwitchDialog.sourceMode === 'overlay' ? 'Uncommitted Overlay Changes' : 'Uncommitted Framing Changes'}
        message={modeSwitchDialog.sourceMode === 'overlay'
          ? 'You have overlay edits that haven\'t been exported yet.\n\n• Export: Create a new final video (GPU processing), then switch modes\n• Discard: Throw away changes and switch modes\n• X: Cancel and stay in overlay mode'
          : 'You have framing edits that haven\'t been exported yet.\n\n• Export: Re-export clip (GPU processing), then switch modes. This will reset any overlay work.\n• Discard: Throw away changes and switch modes\n• X: Cancel and stay in framing mode'
        }
        onClose={handleModeSwitchCancel}
        buttons={[
          {
            label: 'Discard',
            onClick: handleModeSwitchDiscard,
            variant: 'danger'
          },
          {
            label: 'Export',
            onClick: handleModeSwitchExport,
            variant: 'primary'
          }
        ]}
      />

      {/* Toast Notifications */}
      <ToastContainer />

      {/* T435: Google One Tap auto-prompt for guest users */}
      <GoogleOneTap />
      {/* Auth Gate Modal - shows when GPU action requires authentication */}
      <AuthGateModal />
      {/* T430: Account Settings panel */}
      <AccountSettings />

    </div>
    </AppStateProvider>
    </ProjectProvider>
  );
}

function AdminButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-gray-400 hover:text-white text-sm"
      title="Admin Panel"
    >
      <ShieldCheck size={15} />
      <span className="hidden sm:inline font-medium">Admin</span>
    </button>
  );
}

function MigrationRetryBanner({ onRetry }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 border border-amber-500/30 shadow-xl text-sm">
      <span className="text-amber-400">Some of your data from a previous session couldn't be transferred.</span>
      <button
        onClick={onRetry}
        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 transition-colors text-white font-medium whitespace-nowrap"
      >
        Try again
      </button>
    </div>
  );
}

function GuestSaveBanner({ onSignIn }) {
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 border border-yellow-500/40 shadow-xl text-sm">
      <span className="text-yellow-400">⚠</span>
      <span className="text-gray-200">
        You're a guest — your work <span className="text-white font-medium">won't be recoverable</span> without signing in.
      </span>
      <button
        onClick={onSignIn}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 transition-colors text-white font-medium whitespace-nowrap"
      >
        <LogIn size={13} />
        Sign in to save
      </button>
    </div>
  );
}

export default App;
