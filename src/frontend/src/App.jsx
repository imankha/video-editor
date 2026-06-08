import { useState, useMemo, useRef, useCallback, useEffect, lazy, Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import { warmAllUserVideos, setWarmupPriority, WARMUP_PRIORITY } from './utils/cacheWarming';
import { initSession } from './utils/sessionInit';
import { ConnectionStatus } from './components/ConnectionStatus';
import { DownloadsPanel } from './components/DownloadsPanel';
import { SharedVideoOverlay } from './components/SharedVideoOverlay';
import { SharedAnnotationView } from './components/SharedAnnotationView';
import { QuestPanel } from './components/QuestPanel';
import { ReportProblemButton } from './components/ReportProblemButton';
import { GlobalExportIndicator } from './components/GlobalExportIndicator';
import { UploadProgressIndicator } from './components/UploadProgressIndicator';
import { SyncStatusIndicator } from './components/SyncStatusIndicator';
import { useExportRecovery } from './hooks/useExportRecovery';
import { useIsMobile } from './hooks/useIsMobile';
import { ConfirmationDialog, ToastContainer, UnifiedHeader } from './components/shared';
import { getProjectDisplayName } from './utils/clipDisplayName';
import { SECTION_NAMES } from './config/displayNames';
// Screen components (self-contained, own their hooks)
// ProjectsScreen is static — it's the home/landing screen loaded on every visit
import { ProjectsScreen } from './screens';
// Editor screens are lazy-loaded — only fetched when the user navigates to them
// After a deploy, old chunk hashes no longer exist on the CDN. Catch the import
// failure and reload once so the browser fetches the new HTML with correct hashes.
function lazyWithReload(importFn) {
  return lazy(() => importFn().then(m => {
    sessionStorage.removeItem('chunk-reload');
    return m;
  }).catch(() => {
    if (!sessionStorage.getItem('chunk-reload')) {
      sessionStorage.setItem('chunk-reload', '1');
      window.location.reload();
      return new Promise(() => {});
    }
    return importFn();
  }));
}
const AnnotateScreen = lazyWithReload(() => import('./screens/AnnotateScreen').then(m => ({ default: m.AnnotateScreen })));
const FramingScreen = lazyWithReload(() => import('./screens/FramingScreen').then(m => ({ default: m.FramingScreen })));
const OverlayScreen = lazyWithReload(() => import('./screens/OverlayScreen').then(m => ({ default: m.OverlayScreen })));
const AdminScreen = lazyWithReload(() => import('./screens/AdminScreen').then(m => ({ default: m.AdminScreen })));
import { AppStateProvider, ProjectProvider } from './contexts';
import { AccountSettings } from './components/AccountSettings';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { TermsOfService } from './components/TermsOfService';
import { SignInScreen } from './components/SignInScreen';
import ImpersonationBanner from './components/ImpersonationBanner';
import { useEditorStore, useExportStore, useFramingStore, useOverlayStore, useProjectDataStore, useProjectsStore, useProfileStore, useVideoStore, useGamesDataStore, useSettingsStore, useGalleryStore, EDITOR_MODES, MODE_PATHS, PATH_TO_MODE } from './stores';
import { useAuthStore } from './stores/authStore';
import useUploadStore from './stores/uploadStore';
import { useQuestStore } from './stores/questStore';
import { useCreditStore } from './stores/creditStore';
import { toast } from './components/shared';
import { API_BASE } from './config';
import apiFetch from './utils/apiFetch';

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
    setEditorModeFromPopState,
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

  const isMobile = useIsMobile();

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

  // T3455: Capture campaign params from URL (first-touch attribution)
  useEffect(() => {
    if (sessionStorage.getItem('campaignParams')) return;

    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    const utm_source = params.get('utm_source');
    const utm_medium = params.get('utm_medium');
    const utm_campaign = params.get('utm_campaign');
    const utm_content = params.get('utm_content');
    const utm_term = params.get('utm_term');

    let click_source = null;
    if (params.has('fbclid'))                                                    click_source = 'facebook';
    else if (params.has('gclid') || params.has('gbraid') || params.has('wbraid')) click_source = 'google';
    else if (params.has('ttclid'))                                               click_source = 'tiktok';
    else if (params.has('sclid') || params.has('ScCid'))                         click_source = 'snapchat';
    else if (params.has('epik'))                                                 click_source = 'pinterest';
    else if (params.has('rdt_cid'))                                              click_source = 'reddit';

    if (ref || utm_campaign || click_source) {
      const data = {};
      if (ref)          data.ref = ref;
      if (utm_source)   data.utm_source = utm_source;
      if (utm_medium)   data.utm_medium = utm_medium;
      if (utm_campaign) data.utm_campaign = utm_campaign;
      if (utm_content)  data.utm_content = utm_content;
      if (utm_term)     data.utm_term = utm_term;
      if (click_source) data.click_source = click_source;
      sessionStorage.setItem('campaignParams', JSON.stringify(data));
    }
  }, []);

  // T85a: Initialize session (profile ID header) then warm video cache.
  // T85b: Also fetch profiles for the profile switcher.
  // The backend auto-resolves profile if header is missing, so no render gate needed.
  useEffect(() => {
    const updatePreloader = (percent, message) => {
      if (window.__preloaderUpdate) window.__preloaderUpdate(percent, message);
    };

    const dismissPreloader = () => {
      updatePreloader(100, 'Ready');
      const preloader = document.getElementById('preloader');
      if (preloader) {
        setTimeout(() => {
          preloader.classList.add('fade-out');
          setTimeout(() => preloader.remove(), 300);
        }, 150);
      }
    };

    let initialLoadInProgress = true;

    initSession().then(async (session) => {
      if (!session.isAuthenticated) {
        initialLoadInProgress = false;
        dismissPreloader();
        return;
      }

      // Wait for Phase B (profile ready) before bootstrap
      await session.profileReady;

      // T3370: Single bootstrap call replaces 9+ individual fetches
      updatePreloader(50, 'Loading data...');
      try {
        const res = await apiFetch(`${API_BASE}/api/bootstrap`);
        if (res.ok) {
          const data = await res.json();
          useProfileStore.getState().setFromBootstrap(data.profiles);
          useSettingsStore.getState().setFromBootstrap(data.settings);
          useCreditStore.getState().setFromBootstrap(data.credits);
          useProjectsStore.getState().setFromBootstrap(data.projects);
          useGamesDataStore.getState().setFromBootstrap(data.games);
          useQuestStore.getState().setFromBootstrap(data.quests_progress);
          useGalleryStore.getState().setFromBootstrap(data.downloads);
          // Publish export data for useExportRecovery to consume (avoids separate fetch)
          if (data.exports) {
            window.__bootstrapExports = data.exports;
          }
          window.__bootstrapLoaded = true;
        }
      } catch (err) {
        console.error('[App] Bootstrap failed, falling back to individual fetches:', err);
        await Promise.all([
          useProfileStore.getState().fetchProfiles(),
          useSettingsStore.getState().loadSettings(),
          useProjectsStore.getState().fetchProjects(),
          useGamesDataStore.getState().fetchGames(),
          useQuestStore.getState().fetchProgress(),
          useGalleryStore.getState().fetchCount(),
        ]);
      }

      warmAllUserVideos();
      dismissPreloader();
      initialLoadInProgress = false;

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
          apiFetch(`${API_BASE}/api/payments/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
      useAuthStore.getState().setSessionState(false);
      initialLoadInProgress = false;
      dismissPreloader();
    });

    // T1330: fire the same per-user data fetches when the user logs in
    // (same-device path — cross-device recovery reloads instead).
    const unsubAuth = useAuthStore.subscribe((state, prev) => {
      if (state.isAuthenticated && !prev.isAuthenticated && !initialLoadInProgress) {
        warmAllUserVideos();
        useProfileStore.getState().fetchProfiles();
        useProjectsStore.getState().fetchProjects();
        useGamesDataStore.getState().fetchGames();
        useQuestStore.getState().fetchProgress();
        useSettingsStore.getState().loadSettings();
        useGalleryStore.getState().fetchCount();
      }
    });
    return () => unsubAuth();
  }, []);

  const isAdmin = useAuthStore(state => state.isAdmin);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);
  const isCheckingSession = useAuthStore(state => state.isCheckingSession);

  // T2840: Detect /shared/teammate/:token URL for annotation view
  const [teammateShareToken, setTeammateShareToken] = useState(() => {
    const match = window.location.pathname.match(/^\/shared\/teammate\/([a-f0-9-]+)$/i);
    return match ? match[1] : null;
  });

  // T1780: Detect /shared/:token URL and render overlay player
  const [sharedToken, setSharedToken] = useState(() => {
    if (window.location.pathname.match(/^\/shared\/teammate\//i)) return null;
    const match = window.location.pathname.match(/^\/shared\/([a-f0-9-]+)$/i);
    return match ? match[1] : null;
  });

  // T1740: Detect /privacy and /terms URLs for public legal pages
  const [legalPage] = useState(() => {
    const path = window.location.pathname;
    if (path === '/privacy') return 'privacy';
    if (path === '/terms') return 'terms';
    return null;
  });

  const handleCloseShared = useCallback(() => {
    setSharedToken(null);
    window.history.replaceState({}, '', '/');
  }, []);

  const handleCloseTeammateShare = useCallback(() => {
    setTeammateShareToken(null);
    window.history.replaceState({}, '', '/');
  }, []);

  // Export recovery - reconnects to active exports on app startup
  useExportRecovery();

  // T1540: Warn user before leaving during an active upload
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (useUploadStore.getState().isUploading()) {
        e.preventDefault();
        e.returnValue = 'An upload is in progress. Leaving will cancel it.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Browser/hardware back button support — sync editor mode to URL on popstate
  useEffect(() => {
    // Seed the current URL with state so the first back navigation works
    window.history.replaceState({ mode: editorMode }, '', MODE_PATHS[editorMode] || '/home');

    const handlePopState = () => {
      const targetMode = PATH_TO_MODE[window.location.pathname];
      const currentMode = useEditorStore.getState().editorMode;
      if (!targetMode || targetMode === currentMode) return;

      // Unsaved framing changes -- restore URL and ask
      if (currentMode === EDITOR_MODES.FRAMING
          && useFramingStore.getState().framingChangedSinceExport
          && useProjectDataStore.getState().workingVideo?.url) {
        window.history.pushState({ mode: currentMode }, '', MODE_PATHS[currentMode]);
        useEditorStore.getState().openModeSwitchDialog(targetMode, EDITOR_MODES.FRAMING);
        return;
      }

      // Unsaved overlay changes -- restore URL and ask
      if (currentMode === EDITOR_MODES.OVERLAY
          && useOverlayStore.getState().overlayChangedSinceExport
          && useProjectsStore.getState().selectedProject?.has_final_video) {
        window.history.pushState({ mode: currentMode }, '', MODE_PATHS[currentMode]);
        useEditorStore.getState().openModeSwitchDialog(targetMode, EDITOR_MODES.OVERLAY);
        return;
      }

      if (targetMode === EDITOR_MODES.PROJECT_MANAGER) {
        useProjectsStore.getState().clearSelection();
        requestAnimationFrame(() => useProjectsStore.getState().fetchProjects());
      }

      useVideoStore.getState().reset();
      useEditorStore.getState().setEditorModeFromPopState(targetMode);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Handle mode change between Framing, Overlay, Annotate, and Project Manager
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

    // T1550: Switching from framing/overlay to annotate — use existing edit-in-annotate logic
    if (newMode === EDITOR_MODES.ANNOTATE && editorMode !== EDITOR_MODES.ANNOTATE) {
      handleEditInAnnotate();
      return;
    }

    // For project-manager, also clear selection
    if (newMode === EDITOR_MODES.PROJECT_MANAGER) {
      clearSelection();
    }

    // T580: Reset shared video store on mode switch to prevent stale video
    // from the previous mode (e.g., working video from overlay showing in framing)
    useVideoStore.getState().reset();

    setEditorMode(newMode);

    // Refresh projects after mode switch renders to avoid double-render freeze
    if (newMode === EDITOR_MODES.PROJECT_MANAGER) {
      requestAnimationFrame(() => fetchProjects());
    }

    if (selectedProjectId && ['annotate', 'framing', 'overlay'].includes(newMode)) {
      apiFetch(`${API_BASE}/api/projects/${selectedProjectId}/state?current_mode=${encodeURIComponent(newMode)}`, {
        method: 'PATCH'
      }).catch(e => console.error('[App] Failed to persist mode:', e));
    }
  }, [editorMode, hasOverlayVideo, framingChangedSinceExport, overlayChangedSinceExport, selectedProject?.has_final_video, openModeSwitchDialog, setEditorMode, clearSelection, fetchProjects, handleEditInAnnotate, selectedProjectId]);

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
    }

    const finalMode = targetMode || EDITOR_MODES.PROJECT_MANAGER;
    setEditorMode(finalMode);

    if (finalMode === EDITOR_MODES.PROJECT_MANAGER) {
      requestAnimationFrame(() => fetchProjects());
    }

    if (selectedProjectId && ['annotate', 'framing', 'overlay'].includes(finalMode)) {
      apiFetch(`${API_BASE}/api/projects/${selectedProjectId}/state?current_mode=${encodeURIComponent(finalMode)}`, {
        method: 'PATCH'
      }).catch(e => console.error('[App] Failed to persist mode:', e));
    }
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

  // T1740: Public legal pages — accessible without authentication (CalOPPA requirement)
  if (legalPage === 'privacy') return <PrivacyPolicy />;
  if (legalPage === 'terms') return <TermsOfService />;

  // Block rendering until session is resolved — prevents data fetches from firing
  // before the user identity is established (would fall back to DEFAULT_USER_ID)
  if (isCheckingSession) return null;

  // T2840: Shared annotation view — after session check so auth state is known
  if (teammateShareToken) {
    return <SharedAnnotationView shareToken={teammateShareToken} onClose={handleCloseTeammateShare} />;
  }

  // T1780: Shared video — public route, no auth required
  if (sharedToken && !isAuthenticated) {
    return <SharedVideoOverlay shareToken={sharedToken} onClose={handleCloseShared} />;
  }

  // Auth wall — unauthenticated users see sign-in screen (public routes handled above)
  if (!isAuthenticated) return <SignInScreen />;

  // T550: Admin panel — rendered regardless of project selection
  if (editorMode === EDITOR_MODES.ADMIN) {
    return (
      <>
        <ImpersonationBanner />
        <Suspense fallback={null}>
          <AdminScreen onBack={() => setEditorMode(EDITOR_MODES.PROJECT_MANAGER)} />
        </Suspense>
        <ToastContainer />
      </>
    );
  }

  // If no project selected and not in annotate mode, show ProjectsScreen
  if (!selectedProject && editorMode !== EDITOR_MODES.ANNOTATE) {
    return (
      <>
        <ImpersonationBanner />
        {/* Shared bg-gray-900 wrapper: content + quest panel flow together, min-h-screen ensures background covers viewport */}
        <div className="min-h-screen bg-gray-900">
          <ProjectsScreen
              onStateReset={clearSelection}
              onLoadGame={handleLoadGame}
            />
          {/* Quest panel — static, flows after project content (T1600) */}
          <QuestPanel inline />
          {/* Report button — mobile only (desktop has floating global button in main.jsx) */}
          <div className="sm:hidden text-center py-4">
            <ReportProblemButton />
          </div>
          {/* T1740: Legal footer */}
          <footer className="text-center py-6 text-xs text-gray-500 space-x-3">
            <a href="/privacy" className="hover:text-gray-300 transition-colors">Privacy Policy</a>
            <span>|</span>
            <a href="/terms" className="hover:text-gray-300 transition-colors">Terms of Service</a>
          </footer>
        </div>
        {/* Global Export Indicator - shows progress on ProjectsScreen too */}
        <GlobalExportIndicator />
        {/* Upload Progress Indicator - shows upload progress on all screens */}
        <UploadProgressIndicator />
        {/* Sync Status Indicator - shows when R2 sync has failed */}
        <SyncStatusIndicator />
        {/* T430: Account Settings panel */}
        <AccountSettings />
        {/* Toast Notifications */}
        <ToastContainer />
        {/* Admin button — fixed top-right, visible only to admins */}
        {isAdmin && <AdminButton onClick={() => setEditorMode(EDITOR_MODES.ADMIN)} />}
        {/* T1780: Shared video overlay */}
        {sharedToken && <SharedVideoOverlay shareToken={sharedToken} onClose={handleCloseShared} />}
      </>
    );
  }

  return (
    <ProjectProvider>
    <AppStateProvider value={appStateValue}>
    <ImpersonationBanner />
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 flex">
      {/* Connection status banner - shows when backend is unreachable */}
      <ConnectionStatus />
      {/* Annotate mode: AnnotateScreen handles its own sidebar + main content */}
      {editorMode === EDITOR_MODES.ANNOTATE && (
        <Suspense fallback={null}>
          <AnnotateScreen
            onClearSelection={clearSelection}
            onModeChange={handleModeChange}
          />
        </Suspense>
      )}

      {/* Main Content - For framing/overlay modes */}
      {editorMode !== EDITOR_MODES.ANNOTATE && (
      <div className="flex-1 overflow-auto">
        <div className="container mx-auto px-3 pt-4 pb-48 sm:px-4 sm:pt-8 sm:pb-8">
          {/* T1550: Unified header */}
          <UnifiedHeader
            onHomeClick={() => handleModeChange(EDITOR_MODES.PROJECT_MANAGER)}
            breadcrumbType={SECTION_NAMES.DRAFTS}
            breadcrumbItemName={getProjectDisplayName(selectedProject)}
            editorMode={editorMode}
            onModeChange={handleModeChange}
            hasProject={true}
            hasWorkingVideo={!!selectedProject?.working_video_id}
            hasOverlayVideo={hasOverlayVideo}
            framingOutOfSync={framingChangedSinceExport && hasOverlayVideo}
            hasAnnotateVideo={canEditInAnnotate}
            isLoadingWorkingVideo={isLoadingWorkingVideo}
          />

          {/* Mode-specific views */}
          {editorMode === EDITOR_MODES.FRAMING && (
            <Suspense fallback={null}>
              <FramingScreen
                onExportComplete={handleExportComplete}
                exportButtonRef={exportButtonRef}
              />
            </Suspense>
          )}

          {editorMode === EDITOR_MODES.OVERLAY && (
            <Suspense fallback={null}>
              <OverlayScreen
                onExportComplete={handleExportComplete}
                exportButtonRef={exportButtonRef}
              />
            </Suspense>
          )}

        </div>
      </div>
      )}


      {/* Global Export Indicator - shows progress across all screens */}
      <GlobalExportIndicator />

      {/* Upload Progress Indicator - shows upload progress on all screens */}
      <UploadProgressIndicator />

      {/* Sync Status Indicator - shows when R2 sync has failed */}
      <SyncStatusIndicator />

      {/* Downloads Panel */}
      <DownloadsPanel
        onOpenProject={async (projectId) => {
          // Reset stores to clear stale data from previous project
          useProjectDataStore.getState().reset();
          useFramingStore.getState().reset();
          useOverlayStore.getState().reset();
          useVideoStore.getState().reset();
          // Always re-fetch: name may have changed via gallery rename
          await Promise.all([
            fetchProjects({ force: true }),
            selectProject(projectId),
          ]);
          // Default to framing mode when opening a completed reel
          setEditorMode(EDITOR_MODES.FRAMING);
        }}
      />

      {/* Quest Panel (T540) — only on desktop in editor modes (shown inline on Home screen for mobile) */}
      {!isMobile && (
        <QuestPanel />
      )}

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

      {/* GoogleOneTap + AuthGateModal are mounted once in main.jsx. */}
      {/* T430: Account Settings panel */}
      <AccountSettings />

      {/* T1780: Shared video overlay */}
      {sharedToken && <SharedVideoOverlay shareToken={sharedToken} onClose={handleCloseShared} />}

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

export default App;
