import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, Plus, Trash2, Film, CheckCircle, Gamepad2, Image, Filter, Star, Folder, Clock, ChevronRight, AlertTriangle, RefreshCw, Tag, Upload, X, FileVideo, Loader2, Pencil, Eye, EyeOff, Play, Crop, Layers, Share2, Target, Zap } from 'lucide-react';
import { LogoWithText } from './Logo';
import { MediaPlayer } from './MediaPlayer';
import { useAppState } from '../contexts';
import { useExportStore } from '../stores/exportStore';
import { useProjectsStore } from '../stores/projectsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { GameClipSelectorModal } from './GameClipSelectorModal';
import { GameDetailsModal } from './GameDetailsModal';
import { Button } from './shared/Button';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { generateClipName, getProjectDisplayName, getClipDisplayName } from '../utils/clipDisplayName';
import { formatGameClock, compareGameTime } from '../utils/timeFormat';
import { RATING_NOTATION, RATING_BADGE_COLORS } from './shared/clipConstants';
import { ProfileDropdown } from './ProfileDropdown';
import { ProfileSportButton } from './ProfileSportButton';
import { CreditBalance } from './CreditBalance';
import { SignInButton } from './SignInButton';
import { useAuthStore } from '../stores/authStore';
import { useSyncStore } from '../stores/syncStore';
import { useGalleryStore } from '../stores/galleryStore';
import { useQuestStore } from '../stores/questStore';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { SECTION_NAMES } from '../config/displayNames';
import { GAME, REEL } from '../config/themeColors';
import { ExpirationBadge, getDaysUntil } from './ExpirationBadge';
import { StorageExtensionModal } from './StorageExtensionModal';
import { RecapPlayerModal } from './RecapPlayerModal';
import { ShareGameModal } from './ShareGameModal';
import { EditGameModal } from './EditGameModal';
import { prioritizeUrls } from '../utils/cacheWarming';
import { shareInvite } from '../utils/inviteEmail';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { InstallButton } from './InstallButton';
import { useIsMobile } from '../hooks/useIsMobile';

const SCORING_TAGS = new Set([
  'Goal', 'Touchdown Pass', 'Touchdown Catch', 'Touchdown Run', 'Field Goal',
  'Scoring', 'Dunk', 'Try',
]);
const PLAYMAKING_TAGS = new Set(['Assist', 'Chance Creation', 'Shot']);

function TagBadges({ tagBadges }) {
  if (!tagBadges || Object.keys(tagBadges).length === 0) return null;
  const pills = [];
  for (const [tag, count] of Object.entries(tagBadges)) {
    const isScoring = SCORING_TAGS.has(tag);
    const isPlaymaking = PLAYMAKING_TAGS.has(tag);
    if (!isScoring && !isPlaymaking) continue;
    const Icon = isScoring ? Target : Zap;
    const colors = isScoring
      ? 'text-amber-400 bg-amber-400/15 border-amber-400/30'
      : 'text-cyan-400 bg-cyan-400/15 border-cyan-400/30';
    const label = count > 1 && tag === 'Try' ? 'Tries'
      : count > 1 ? `${tag}s`
      : tag;
    pills.push(
      <span key={tag} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold ${colors}`}>
        <Icon size={10} />{count > 1 && count} {label}
      </span>
    );
  }
  if (pills.length === 0) return null;
  return <>{pills}</>;
}

/**
 * ProjectManager - Shown when no project is selected
 *
 * Displays:
 * - Tab navigation: Games | Projects
 * - Games: List of saved games with option to load into annotate mode
 * - Projects: List of existing projects with progress bars
 * - Buttons to add new game or create new project
 */
export function ProjectManager({
  projects,
  loading,
  error, // Projects fetch error
  onSelectProject,
  onSelectProjectWithMode, // (projectId, options) => void - options: { mode: 'framing'|'overlay', clipIndex?: number }
  onCreateProject,
  onRefreshProjects,
  onDeleteProject,
  onAnnotateWithFile, // (file: File) => void - Navigate to annotate mode with file
  // Games props
  games = [],
  gamesLoading = false,
  gamesError, // Games fetch error
  onLoadGame,
  onDeleteGame,
  onFetchGames,
  // Downloads props - now optional, from context
  unseenReelsCount: unseenReelsCountProp,
  onOpenDownloads,
  // Export state - now optional, from context
  exportingProject: exportingProjectProp,
  // Pending uploads props
  pendingUploads = [],
  onResumeUpload,
  onCancelPendingUpload,
  // Active upload props (in-progress upload from uploadStore)
  activeUpload = null, // { fileName, progress, phase, message }
  onClickActiveUpload, // Navigate back to annotate mode
  onCancelActiveUpload, // Cancel active upload
  // Pending game IDs - projects referencing these are blocked
  pendingGameIds = new Set(),
}) {
  // Get downloads and export state from context
  const { unseenReelsCount: contextUnseenReelsCount, exportingProject: contextExportingProject } = useAppState();

  // Use props if provided, otherwise fall back to context
  const unseenReelsCount = unseenReelsCountProp ?? contextUnseenReelsCount ?? 0;
  const exportingProject = exportingProjectProp ?? contextExportingProject;
  const hasClips = games.some(g => g.clip_count > 0);
  const initialTab = projects.length === 0 ? 'games' : 'projects';
  const [activeTab, setActiveTabRaw] = useState(initialTab);
  const setActiveTab = useCallback((tab) => {
    setActiveTabRaw(tab);
    const path = tab === 'games' ? '/home/games' : '/home/reels';
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path);
    }
  }, []);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showGameDetailsModal, setShowGameDetailsModal] = useState(false);
  const [extensionGame, setExtensionGame] = useState(null);
  const [recapGame, setRecapGame] = useState(null);
  const [shareGame, setShareGame] = useState(null);
  const [editGame, setEditGame] = useState(null);
  const gameFileInputRef = useRef(null);
  const resumeFileInputRef = useRef(null);
  const gamesContainerRef = useRef(null);
  const promotedGameIdsRef = useRef(new Set());
  const [resumingUploadFilename, setResumingUploadFilename] = useState(null); // Track which upload we're resuming

  // Project filter state - persisted via settings store
  const {
    settings,
    setStatusFilter,
    setAspectFilter,
    setCreationFilter,
  } = useSettingsStore();

  const { statusFilter, aspectFilter, creationFilter } = settings.projectFilters;

  // Viewport-aware cache warming: promote visible game videos in the warm queue
  useEffect(() => {
    const container = gamesContainerRef.current;
    if (!container || games.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
      const urls = [];
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const gameId = entry.target.dataset.gameId;
        if (!gameId || promotedGameIdsRef.current.has(gameId)) continue;
        promotedGameIdsRef.current.add(gameId);
        const url = useGamesDataStore.getState().getGameVideoUrl(gameId);
        if (url) urls.push(url);
      }
      if (urls.length > 0) prioritizeUrls(urls);
    }, { threshold: 0.1 });

    for (const child of container.children) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, [games]);

  // Filter projects based on selected filters
  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      // Status filter - matches counting logic
      // T66: 'complete' and 'uncompleted' removed - completed projects are archived
      if (statusFilter !== 'all') {
        const isInOverlay = project.has_working_video;
        const isEditing = !isInOverlay && project.clips_in_progress > 0;
        const isExported = !isInOverlay && !isEditing && project.clips_exported > 0;
        const isNotStarted = !isInOverlay && !isEditing && !isExported;

        if (statusFilter === 'overlay' && !isInOverlay) return false;
        if (statusFilter === 'editing' && !isEditing) return false;
        if (statusFilter === 'exported' && !isExported) return false;
        if (statusFilter === 'not_started' && !isNotStarted) return false;
      }

      // Aspect ratio filter
      if (aspectFilter !== 'all' && project.aspect_ratio !== aspectFilter) {
        return false;
      }

      // Creation type filter
      if (creationFilter !== 'all') {
        if (creationFilter === 'auto' && !project.is_auto_created) return false;
        if (creationFilter === 'custom' && project.is_auto_created) return false;
      }

      return true;
    });
  }, [projects, statusFilter, aspectFilter, creationFilter]);

  // Get counts for filter badges and determine which filters are useful
  const filterCounts = useMemo(() => {
    const counts = {
      all: projects.length,
      // T66: 'complete' and 'uncompleted' removed - completed projects are archived
      overlay: 0,
      editing: 0,
      exported: 0,
      not_started: 0,
      aspects: {},
      auto: 0,
      custom: 0
    };

    projects.forEach(project => {
      // Status counts - matches ProjectCard display logic
      // T66: All projects in DB are uncompleted (completed ones are archived)
      if (project.has_working_video) {
        counts.overlay++;
      } else if (project.clips_in_progress > 0) {
        counts.editing++;
      } else if (project.clips_exported > 0) {
        counts.exported++;
      } else {
        counts.not_started++;
      }

      // Aspect ratio counts
      const ratio = project.aspect_ratio || '9:16';
      counts.aspects[ratio] = (counts.aspects[ratio] || 0) + 1;

      // Creation type counts
      if (project.is_auto_created) {
        counts.auto++;
      } else {
        counts.custom++;
      }
    });

    // Determine which filters are useful (have more than one distinct value)
    const statusValuesWithProjects = [counts.overlay, counts.editing, counts.exported, counts.not_started].filter(v => v > 0).length;
    counts.showStatusFilter = statusValuesWithProjects > 1;
    counts.showAspectFilter = Object.keys(counts.aspects).length > 1;
    counts.showCreationFilter = counts.auto > 0 && counts.custom > 0;

    // A filter panel is also "useful" whenever its filter is ACTIVE (non-default):
    // hiding the panel for a zero-match active filter leaves the user with an
    // invisible filter they cannot see or clear (staging bug 2026-07-04).
    counts.showStatusFilter = counts.showStatusFilter || statusFilter !== 'all';
    counts.showAspectFilter = counts.showAspectFilter || aspectFilter !== 'all';
    counts.showCreationFilter = counts.showCreationFilter || creationFilter !== 'all';

    return counts;
  }, [projects, statusFilter, aspectFilter, creationFilter]);

  // Only show filters if we have more than 1 project and at least one filter is useful
  const showFilters = projects.length > 1 && (
    filterCounts.showStatusFilter ||
    filterCounts.showAspectFilter ||
    filterCounts.showCreationFilter
  );

  // Helper to compute status counts for a list of projects
  // Returns two things:
  // 1. Project-level counts (for header badges): how many projects in each overall state
  // 2. Segment-level presence (for legend): which colors appear in ANY project's progress strip
  const getProjectStatusCounts = useCallback((projectList) => {
    // Project-level counts (each project counted once based on overall status)
    let projectsDone = 0;
    let projectsInOverlay = 0;
    let projectsInProgress = 0;
    let projectsNotStarted = 0;

    // Segment-level presence (for legend - tracks if ANY segment of this color exists)
    let hasGreenSegments = false;      // done/exported clips or final video
    let hasDarkBlueSegments = false;   // clips in progress (editing)
    let hasLightBlueSegments = false;  // overlay ready (has working video)
    let hasGraySegments = false;       // pending/not started

    projectList.forEach(project => {
      const { has_final_video, clips_exported, clips_in_progress, has_working_video, has_overlay_edits, clip_count } = project;

      // === Project-level categorization (for header counts) ===
      if (has_final_video) {
        projectsDone++;
      } else if (has_working_video) {
        projectsInOverlay++;
      } else if (clips_exported > 0 || clips_in_progress > 0 || has_overlay_edits) {
        projectsInProgress++;
      } else {
        projectsNotStarted++;
      }

      // === Segment-level presence (for legend) ===
      // Green: any exported clips OR final video complete
      if (has_final_video || clips_exported > 0) {
        hasGreenSegments = true;
      }
      // Dark blue: any clips being edited OR overlay edits in progress
      if (clips_in_progress > 0 || (has_overlay_edits && !has_final_video && !has_working_video)) {
        hasDarkBlueSegments = true;
      }
      // Light blue: overlay ready (has working video but not final)
      if (has_working_video && !has_final_video) {
        hasLightBlueSegments = true;
      }
      // Gray: any pending clips OR pending overlay
      const clipsWithProgress = (clips_exported || 0) + (clips_in_progress || 0);
      const totalClips = clip_count || 0;
      if (clipsWithProgress < totalClips) {
        hasGraySegments = true; // Some clips not started
      }
      if (!has_working_video && !has_final_video) {
        hasGraySegments = true; // Overlay not started
      }
    });

    return {
      // Project counts (for header badges)
      done: projectsDone,
      inOverlay: projectsInOverlay,
      inProgress: projectsInProgress,
      notStarted: projectsNotStarted,
      total: projectList.length,
      // Segment presence flags (for legend)
      segments: {
        done: hasGreenSegments,
        inProgress: hasDarkBlueSegments,
        inOverlay: hasLightBlueSegments,
        notStarted: hasGraySegments,
      }
    };
  }, []);

  // Group filtered projects by game group_key for hierarchical display
  const groupedProjects = useMemo(() => {
    const groups = {};
    const ungrouped = [];

    filteredProjects.forEach(project => {
      const key = project.group_key;
      if (key) {
        if (!groups[key]) {
          groups[key] = { projects: [], statusCounts: null };
        }
        groups[key].projects.push(project);
      } else {
        ungrouped.push(project);
      }
    });

    // Compute status counts and most recent game date for each group
    Object.keys(groups).forEach(key => {
      // Order drafts within a game by their in-game time so Reel Drafts matches
      // the annotation clip-list and My Reels order (T4080). Single-clip drafts
      // carry clip_game_start_time (backend-derived); multi-clip drafts sort last.
      groups[key].projects.sort((a, b) =>
        compareGameTime(a.clip_game_start_time, b.clip_game_start_time));
      groups[key].statusCounts = getProjectStatusCounts(groups[key].projects);
      // Find the most recent game date in this group
      let mostRecentDate = null;
      groups[key].projects.forEach(project => {
        (project.game_dates || []).forEach(dateStr => {
          if (dateStr) {
            const date = new Date(dateStr);
            if (!isNaN(date) && (!mostRecentDate || date > mostRecentDate)) {
              mostRecentDate = date;
            }
          }
        });
      });
      groups[key].mostRecentDate = mostRecentDate;
    });

    // Sort group keys: incomplete groups first, then by most recent game date (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      const aComplete = groups[a].statusCounts.done === groups[a].statusCounts.total;
      const bComplete = groups[b].statusCounts.done === groups[b].statusCounts.total;

      // Incomplete groups come first
      if (aComplete !== bComplete) {
        return aComplete ? 1 : -1;
      }
      // Within same completion status, sort by most recent game date (newest first)
      const aDate = groups[a].mostRecentDate;
      const bDate = groups[b].mostRecentDate;
      if (aDate && bDate) {
        return bDate - aDate; // Newest first
      }
      if (aDate) return -1; // a has date, b doesn't
      if (bDate) return 1; // b has date, a doesn't
      // Neither has date, sort alphabetically
      return a.localeCompare(b);
    });

    return { groups, sortedKeys, ungrouped };
  }, [filteredProjects, getProjectStatusCounts]);

  // Compute most recent items for "Continue Where You Left Off" section
  const recentItems = useMemo(() => {
    // Get most recent project (by last_opened_at, fall back to created_at)
    const sortedProjects = [...projects].sort((a, b) => {
      const aTime = a.last_opened_at || a.created_at;
      const bTime = b.last_opened_at || b.created_at;
      return new Date(bTime) - new Date(aTime);
    });
    const recentProject = sortedProjects[0] || null;

    // Get most recent game (by created_at)
    const sortedGames = [...games].sort((a, b) => {
      return new Date(b.created_at) - new Date(a.created_at);
    });
    const recentGame = sortedGames[0] || null;

    // Determine which is more recent overall
    let mostRecentType = null;
    if (recentProject && recentGame) {
      const projectTime = new Date(recentProject.last_opened_at || recentProject.created_at);
      const gameTime = new Date(recentGame.created_at);
      mostRecentType = projectTime > gameTime ? 'project' : 'game';
    } else if (recentProject) {
      mostRecentType = 'project';
    } else if (recentGame) {
      mostRecentType = 'game';
    }

    return { recentProject, recentGame, mostRecentType };
  }, [projects, games]);

  // Only show recent section if there's at least one recent item
  const showRecentSection = recentItems.recentProject || recentItems.recentGame;


  // Handle file selection for new game (legacy - keeping for reference)
  const handleGameFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file && onAnnotateWithFile) {
      onAnnotateWithFile({ file });
    }
    // Reset input so same file can be selected again
    event.target.value = '';
  }, [onAnnotateWithFile]);

  // Handle file selection for resuming upload
  const handleResumeFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file && onResumeUpload) {
      onResumeUpload(file, resumingUploadFilename);
    }
    // Reset state
    setResumingUploadFilename(null);
    event.target.value = '';
  }, [onResumeUpload, resumingUploadFilename]);

  // Trigger file picker for resume
  const handleResumeClick = useCallback((originalFilename) => {
    setResumingUploadFilename(originalFilename);
    resumeFileInputRef.current?.click();
  }, []);

  // Auth gate — force login before creating persistent data
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const handleInviteClick = useCallback(() => shareInvite(), []);

  // Open game details modal (requires auth)
  const handleAddGameClick = useCallback(() => {
    requireAuth(() => setShowGameDetailsModal(true));
  }, [requireAuth]);

  // Handle game creation with details
  const handleCreateGame = useCallback(async (gameDetails) => {
    if (onAnnotateWithFile) {
      await onAnnotateWithFile(gameDetails);
    }
  }, [onAnnotateWithFile]);

  // ProjectsScreen already fetches games on mount — no need to duplicate here.
  // The tab-switch effect below handles refreshing when user switches to games tab.

  // Switch to projects tab once projects load (initial state may be wrong since data isn't fetched yet at mount)
  const hasSetInitialTab = useRef(false);
  useEffect(() => {
    // T1550: Check for tab hint from navigation (e.g., clicking "Games" breadcrumb in Annotate)
    const hint = sessionStorage.getItem('projectManagerTab');
    if (hint) {
      sessionStorage.removeItem('projectManagerTab');
      setActiveTab(hint);
      hasSetInitialTab.current = true;
      return;
    }
    if (!hasSetInitialTab.current && !loading && projects.length > 0) {
      setActiveTab('projects');
      hasSetInitialTab.current = true;
    }
  }, [projects, loading]);

  // Refetch games when opening "new project" modal (needs fresh game list)
  useEffect(() => {
    if (showNewProjectModal && onFetchGames) {
      onFetchGames();
    }
  }, [showNewProjectModal, onFetchGames]);

  // Handle project creation from the new modal
  const handleProjectCreated = useCallback(async (project) => {
    // Close modal first
    setShowNewProjectModal(false);

    // Refresh projects list to show the new project
    // The modal already created the project via API
    // Don't navigate into the project - let user click on it from the projects page
    // This ensures extraction status is checked before entering Framing mode
    if (onRefreshProjects) {
      await onRefreshProjects();
    }
  }, [onRefreshProjects]);

  return (
    <div className="flex-1 flex flex-col items-center p-4 sm:p-8 bg-gray-900">
      {/* Hidden file input for game video selection */}
      <input
        ref={gameFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleGameFileChange}
        className="hidden"
      />

      {/* Hidden file input for resuming uploads */}
      <input
        ref={resumeFileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleResumeFileChange}
        className="hidden"
      />

      {/* Credits anchored far left */}
      {isAuthenticated && (
        <div className="fixed top-4 left-4 z-30">
          <CreditBalance />
        </div>
      )}

      {/* Top right controls - Gallery (auth only) + Invite + Sign-in/Profile */}
      <div className="fixed top-4 right-4 z-30 flex items-center gap-3 sm:gap-4">
        <InstallButton />
        {isAuthenticated && onOpenDownloads && (
          <Button
            variant="reelOutline"
            icon={Image}
            onClick={onOpenDownloads}
            title={unseenReelsCount > 0
              ? `${SECTION_NAMES.LIBRARY} (${unseenReelsCount} new)`
              : SECTION_NAMES.LIBRARY}
          >
            <span className="hidden sm:inline">{SECTION_NAMES.LIBRARY}</span>
            {unseenReelsCount > 0 && (
              <span className={`px-1.5 py-0.5 ${REEL.bg} text-white text-xs font-bold rounded-full min-w-[20px] text-center`}>
                {unseenReelsCount}
              </span>
            )}
          </Button>
        )}
        {isAuthenticated && (
          <Button
            variant="reelOutline"
            icon={Share2}
            onClick={handleInviteClick}
            title="Invite a Friend"
          >
            <span className="hidden sm:inline">Invite</span>
          </Button>
        )}
        <SignInButton />
        <ProfileSportButton />
        <ProfileDropdown />
      </div>

      {/* Header — pt-10 clears the fixed top-right controls on mobile */}
      <div className="text-center pt-10 sm:pt-0 mb-6">
        <LogoWithText className="mx-auto mb-4" />
        <p className="text-gray-400">Learn from, organize, and celebrate your athlete's moments</p>
      </div>

      {/* Continue Where You Left Off - Recent Section (hidden on mobile) */}
      {showRecentSection && (
        <div className="hidden sm:block w-full max-w-2xl mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-gray-500" />
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Continue Where You Left Off
            </h2>
          </div>
          <div className="flex gap-3">
            {/* Recent Game (left) */}
            {recentItems.recentGame && (
              <button
                onClick={() => onLoadGame(recentItems.recentGame.id)}
                className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${GAME.bgSubtle} ${GAME.borderSubtle} ${GAME.bgSubtleHover}`}
              >
                <div className={`p-2 rounded-lg ${GAME.bgIcon}`}>
                  <Gamepad2 size={18} className={GAME.accent} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-medium truncate block">
                    {recentItems.recentGame.name}
                  </span>
                  <div className="text-xs text-gray-500">
                    {recentItems.recentGame.clip_count} clip{recentItems.recentGame.clip_count !== 1 ? 's' : ''} annotated
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
              </button>
            )}

            {/* Recent Reel (right) */}
            {recentItems.recentProject && (
              <button
                onClick={() => {
                  const p = recentItems.recentProject;
                  const needsOverlay = p.has_working_video && (
                    !p.has_final_video ||
                    (p.working_video_created_at && p.final_video_created_at &&
                     p.working_video_created_at > p.final_video_created_at)
                  );
                  if (needsOverlay) {
                    onSelectProjectWithMode?.(p.id, { mode: 'overlay' });
                  } else {
                    onSelectProject(p.id);
                  }
                }}
                className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${REEL.bgSubtle} ${REEL.borderSubtle} ${REEL.bgSubtleHover}`}
              >
                <div className={`p-2 rounded-lg ${REEL.bgIcon}`}>
                  <FolderOpen size={18} className={REEL.accent} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-medium truncate">
                      {getProjectDisplayName(recentItems.recentProject)}
                    </span>
                    {recentItems.recentProject.has_final_video && (
                      <CheckCircle size={14} className="text-green-400 flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {recentItems.recentProject.clip_count} clip{recentItems.recentProject.clip_count !== 1 ? 's' : ''}
                    {' · '}
                    {recentItems.recentProject.has_final_video ? 'Complete' :
                     recentItems.recentProject.has_working_video ? 'In Overlay' :
                     recentItems.recentProject.clips_in_progress > 0 ? 'Framing started' : 'Not Started'}
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tab Navigation - styled to match ModeSwitcher */}
      <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mb-6">
        <button
          onClick={() => setActiveTab('games')}
          className={`flex items-center gap-2 px-3 py-2 sm:px-4 rounded-md font-medium text-sm transition-all duration-200 ${
            activeTab === 'games'
              ? `${GAME.bg} text-white shadow-lg`
              : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Gamepad2 size={16} />
          Games
          {games.length > 0 && (
            <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'games' ? GAME.bgDark : 'bg-gray-700'
            }`}>
              {games.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`flex items-center gap-2 px-3 py-2 sm:px-4 rounded-md font-medium text-sm transition-all duration-200 ${
            activeTab === 'projects'
              ? `${REEL.bg} text-white shadow-lg`
              : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <FolderOpen size={16} />
          {SECTION_NAMES.DRAFTS}
          {projects.length > 0 && (
            <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'projects' ? REEL.bgDark : 'bg-gray-700'
            }`}>
              {projects.length}
            </span>
          )}
        </button>
      </div>

      {/* Action Button */}
      <div className="mb-4 sm:mb-8">
        {activeTab === 'games' ? (
          <Button
            variant="success"
            size="lg"
            icon={Plus}
            onClick={handleAddGameClick}
          >
            Add Game
          </Button>
        ) : (
          <Button
            variant="cyan"
            size="lg"
            icon={Plus}
            disabled={!hasClips}
            title={!hasClips ? "Extract clips from a game first using Annotate mode" : undefined}
            onClick={() => setShowNewProjectModal(true)}
          >
            New Reel
          </Button>
        )}
      </div>

      {/* Content */}
      {activeTab === 'games' ? (
        /* Games List */
        gamesLoading ? (
          <div className="text-gray-400">Loading games...</div>
        ) : gamesError ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-red-400 mb-3">
              <AlertTriangle size={20} />
              <span className="font-medium">Failed to load games</span>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              {gamesError.includes('fetch') || gamesError.includes('network')
                ? 'Cannot connect to server. Check your internet connection.'
                : gamesError}
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={RefreshCw}
              onClick={onFetchGames}
            >
              Retry
            </Button>
          </div>
        ) : games.length === 0 && pendingUploads.length === 0 && !activeUpload ? (
          <div className="text-gray-500 text-center">
            <p className="mb-2">No games yet</p>
            <p className="text-sm">Add a game to annotate your footage</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl">
            {/* Active Upload Section - Currently uploading */}
            {activeUpload && (
              <div className="mb-6">
                <h2 className={`text-sm font-semibold ${GAME.accent} uppercase tracking-wide mb-3 flex items-center gap-2`}>
                  <Loader2 size={14} className="animate-spin" />
                  Uploading
                </h2>
                <ActiveUploadCard
                  upload={activeUpload}
                  onClick={onClickActiveUpload}
                  onCancel={onCancelActiveUpload}
                />
              </div>
            )}

            {/* Pending Uploads Section - Paused/interrupted uploads (exclude active upload) */}
            {(() => {
              // Filter out files being actively uploaded from pending list to avoid duplication
              // For multi-video uploads, check against all individual file names
              const filteredPending = activeUpload
                ? pendingUploads.filter(p => {
                    if (p.original_filename === activeUpload.fileName) return false;
                    // Multi-video: filter out any file that's part of the active upload
                    if (activeUpload.files) {
                      return !activeUpload.files.some(f => f.name === p.original_filename);
                    }
                    return true;
                  })
                : pendingUploads;
              return filteredPending.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-yellow-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                    <Upload size={14} />
                    Pending Uploads
                  </h2>
                  <div className="space-y-2">
                    {filteredPending.map(upload => (
                      <PendingUploadCard
                        key={upload.session_id}
                        upload={upload}
                        onResume={() => handleResumeClick(upload.original_filename)}
                        onCancel={() => onCancelPendingUpload(upload.session_id)}
                      />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Your Games Section */}
            {games.length > 0 && (
              <>
                <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Your Games
                </h2>
                <div ref={gamesContainerRef} className="space-y-2">
                  {games.map(game => (
                    <div key={game.id} data-game-id={game.id}>
                      <GameCard
                        game={game}
                        onLoad={() => onLoadGame(game.id)}
                        onDelete={() => onDeleteGame(game.id)}
                        onExtend={() => setExtensionGame(game)}
                        onPlayRecap={(tab) => setRecapGame({ game, initialTab: tab })}
                        onShare={() => setShareGame(game)}
                        onEdit={() => setEditGame(game)}
                      />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      ) : (
        /* Projects List */
        loading ? (
          <div className="text-gray-400">{`Loading ${SECTION_NAMES.DRAFTS_LOWER}...`}</div>
        ) : error ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-red-400 mb-3">
              <AlertTriangle size={20} />
              <span className="font-medium">{`Failed to load ${SECTION_NAMES.DRAFTS_LOWER}`}</span>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              {error.includes('fetch') || error.includes('network')
                ? 'Cannot connect to server. Check your internet connection.'
                : error}
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-gray-500 text-center">
            <p className="mb-2">{`No ${SECTION_NAMES.DRAFTS_LOWER} yet`}</p>
            <p className="text-sm">Create a new reel or add a game to get started</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl">
            {/* Filters - only show when useful */}
            {showFilters && (
              <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-3">
                {/* Status Filter */}
                {filterCounts.showStatusFilter && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Status</label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { value: 'all', label: 'All' },
                        // T66: 'complete' and 'uncompleted' removed - completed projects are archived
                        { value: 'overlay', label: 'In Overlay', color: 'blue' },
                        { value: 'editing', label: 'Framing Started', color: 'blue' },
                        { value: 'exported', label: 'Exported', color: 'purple' },
                        { value: 'not_started', label: 'Not Started', color: 'gray' }
                      ].map(opt => {
                        const count = opt.value === 'all' ? filterCounts.all : filterCounts[opt.value];
                        // Never hide the ACTIVE chip, even at 0 matches — it must stay clickable to clear
                        if (count === 0 && opt.value !== 'all' && opt.value !== statusFilter) return null;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setStatusFilter(opt.value)}
                            className={`px-2.5 py-1 text-xs rounded transition-colors ${
                              statusFilter === opt.value
                                ? opt.color === 'blue' ? 'bg-blue-600 text-white'
                                  : opt.color === 'gray' ? 'bg-gray-600 text-white'
                                  : `${REEL.bg} text-white`
                                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            }`}
                          >
                            {opt.label} ({count})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Aspect Ratio Filter */}
                {filterCounts.showAspectFilter && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Aspect Ratio</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setAspectFilter('all')}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          aspectFilter === 'all'
                            ? `${REEL.bg} text-white`
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        All
                      </button>
                      {Object.entries(filterCounts.aspects).map(([ratio, count]) => (
                        <button
                          key={ratio}
                          onClick={() => setAspectFilter(ratio)}
                          className={`px-2.5 py-1 text-xs rounded transition-colors ${
                            aspectFilter === ratio
                              ? `${REEL.bg} text-white`
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          {ratio} ({count})
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Creation Type Filter */}
                {filterCounts.showCreationFilter && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Created By</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setCreationFilter('all')}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          creationFilter === 'all'
                            ? `${REEL.bg} text-white`
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setCreationFilter('auto')}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                          creationFilter === 'auto'
                            ? 'bg-yellow-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                        title="Auto-created from 5-star clips"
                      >
                        <Star size={12} className={creationFilter === 'auto' ? 'text-white' : 'text-yellow-400'} />
                        Auto ({filterCounts.auto})
                      </button>
                      <button
                        onClick={() => setCreationFilter('custom')}
                        className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded transition-colors ${
                          creationFilter === 'custom'
                            ? `${REEL.bg} text-white`
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                        title={`Manually created ${SECTION_NAMES.DRAFTS_LOWER}`}
                      >
                        <Folder size={12} className={creationFilter === 'custom' ? 'text-white' : REEL.accent} />
                        Custom ({filterCounts.custom})
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
                {filteredProjects.length === projects.length
                  ? `Your ${SECTION_NAMES.DRAFTS}`
                  : `Showing ${filteredProjects.length} of ${projects.length} ${SECTION_NAMES.DRAFTS}`}
              </h2>
            </div>
            <div className="space-y-2">
              {filteredProjects.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  <p>{`No ${SECTION_NAMES.DRAFTS_LOWER} match the current filters`}</p>
                  <button
                    onClick={() => {
                      setStatusFilter('all');
                      setAspectFilter('all');
                      setCreationFilter('all');
                    }}
                    className="mt-2 px-3 py-1.5 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
                  >
                    {`Clear filters (show all ${projects.length})`}
                  </button>
                </div>
              ) : (
                <>
                  {/* Ungrouped projects (no game association) shown first */}
                  {groupedProjects.ungrouped.map(project => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onSelect={() => onSelectProject(project.id)}
                      onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                      onDelete={() => onDeleteProject(project.id)}
                      exportingProject={exportingProject}
                      pendingGameIds={pendingGameIds}
                    />
                  ))}

                  {/* Grouped projects by game - expand if has incomplete or unpublished projects */}
                  {groupedProjects.sortedKeys.map(groupKey => {
                    const group = groupedProjects.groups[groupKey];
                    const hasIncomplete = group.statusCounts.done < group.statusCounts.total;
                    const hasUnpublished = group.projects.some(p => p.has_final_video && !p.is_published);
                    return (
                    <CollapsibleGroup
                      key={groupKey}
                      title={groupKey}
                      count={group.projects.length}
                      statusCounts={group.statusCounts}
                      defaultExpanded={hasIncomplete || hasUnpublished}
                    >
                      <div className="space-y-2">
                        {group.projects.map(project => (
                          <ProjectCard
                            key={project.id}
                            project={project}
                            onSelect={() => onSelectProject(project.id)}
                            onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                            onDelete={() => onDeleteProject(project.id)}
                            exportingProject={exportingProject}
                            pendingGameIds={pendingGameIds}
                          />
                        ))}
                      </div>
                    </CollapsibleGroup>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )
      )}

      {/* New Project Modal - Game/Clip selector */}
      <GameClipSelectorModal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
        onCreate={handleProjectCreated}
        games={games}
        existingProjectNames={projects?.map(p => p.name) || []}
      />

      {/* Game Details Modal - for creating a new game */}
      <GameDetailsModal
        isOpen={showGameDetailsModal}
        onClose={() => setShowGameDetailsModal(false)}
        onCreateGame={handleCreateGame}
      />

      {extensionGame && (
        <StorageExtensionModal
          game={extensionGame}
          onClose={() => setExtensionGame(null)}
          onExtensionSuccess={onFetchGames}
        />
      )}

      {recapGame && (
        <RecapPlayerModal
          game={recapGame.game || recapGame}
          initialTab={recapGame.initialTab}
          onClose={() => setRecapGame(null)}
        />
      )}

      {shareGame && (
        <ShareGameModal
          gameId={shareGame.id}
          gameName={shareGame.name}
          onClose={() => setShareGame(null)}
        />
      )}

      {editGame && (
        <EditGameModal
          isOpen={!!editGame}
          game={editGame}
          onClose={() => setEditGame(null)}
        />
      )}

    </div>
  );
}


/**
 * PendingUploadCard - Shows a paused/pending upload with resume option
 * Clicking the card or Resume button opens file picker, then navigates to Annotate
 */
function PendingUploadCard({ upload, onResume, onCancel }) {
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const handleCancel = (e) => {
    e.stopPropagation();
    if (showCancelConfirm) {
      onCancel();
    } else {
      setShowCancelConfirm(true);
      setTimeout(() => setShowCancelConfirm(false), 3000);
    }
  };

  // Format file size
  const formatSize = (bytes) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  // Format as "Jan 15, 2:30 PM" or "Jan 15" if different day
  const formatDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div
      onClick={onResume}
      className="group relative p-3 sm:p-4 bg-yellow-900/20 hover:bg-yellow-900/30 rounded-lg border border-yellow-600/50 hover:border-yellow-500 cursor-pointer transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileVideo size={18} className="text-yellow-400" />
            {upload.label && <span className="text-yellow-400 text-sm font-medium shrink-0">{upload.label}:</span>}
            <h3 className="text-white font-medium truncate">{upload.original_filename}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-400">
            <span>{formatSize(upload.file_size)}</span>
            <span>•</span>
            <span>{upload.completed_parts} / {upload.total_parts} parts uploaded</span>
            <span>•</span>
            <span>Started {formatDate(upload.created_at)}</span>
          </div>

          {/* Progress bar */}
          <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-600 transition-all duration-300"
              style={{ width: `${upload.progress_percent}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          {/* Resume button */}
          <Button
            variant="warning"
            size="sm"
            icon={Upload}
            onClick={(e) => { e.stopPropagation(); onResume(); }}
          >
            Resume
          </Button>

          {/* Cancel button */}
          <Button
            variant={showCancelConfirm ? 'danger' : 'ghost'}
            size="sm"
            icon={X}
            iconOnly
            onClick={handleCancel}
            className={!showCancelConfirm ? 'opacity-0 group-hover:opacity-100' : ''}
            title={showCancelConfirm ? 'Click again to confirm' : 'Cancel upload'}
          />
        </div>
      </div>
    </div>
  );
}


/**
 * ActiveUploadCard - Shows an in-progress upload with progress bar
 * Clicking navigates back to annotate mode
 */
function ActiveUploadCard({ upload, onClick, onCancel }) {
  // Format file size
  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  };

  return (
    <div
      onClick={onClick}
      className={`group relative p-3 sm:p-4 ${GAME.bgCard} ${GAME.bgCardHover} rounded-lg border ${GAME.borderCard} ${GAME.borderHover} cursor-pointer transition-all`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileVideo size={18} className={GAME.accent} />
            <h3 className="text-white font-medium truncate">{upload.fileName}</h3>
            {onCancel && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancel(); }}
                className="ml-auto p-1 text-gray-500 hover:text-red-400 transition-colors"
                title="Cancel upload"
              >
                <X size={16} />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-400">
            {upload.fileSize && <span>{formatSize(upload.fileSize)}</span>}
            {upload.fileSize && upload.message && <span>•</span>}
            <span>{upload.message || 'Uploading...'}</span>
          </div>

          {/* Progress bar */}
          <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${GAME.progressBar} transition-all duration-300`}
              style={{ width: `${upload.progress || 0}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500 text-right">
            {upload.progress || 0}%
          </div>
        </div>

      </div>
    </div>
  );
}


/**
 * GameCard - Individual game in the list
 */
export function GameCard({ game, onLoad, onDelete, onExtend, onPlayRecap, onShare, onEdit }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);
  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const isMobile = useIsMobile();
  const isExpired = game.storage_status === 'expired';

  const hasBeenViewed = game.viewed_duration > 0;
  const rawPercent = game.video_duration > 0
    ? (game.viewed_duration / game.video_duration) * 100
    : 0;
  const viewedPercent = hasBeenViewed ? Math.max(1, Math.min(100, Math.round(rawPercent))) : 0;
  const isFullyReviewed = viewedPercent >= 95;
  const isPartiallyReviewed = hasBeenViewed && !isFullyReviewed;
  const isNew = !hasBeenViewed;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const hasRecap = Boolean(game.recap_video_url);
  const canExtend = game.can_extend !== false;
  const daysLeft = getDaysUntil(game.storage_expires_at);
  const isNearExpiry = !isExpired && daysLeft !== null && daysLeft < 14;

  const longPressFired = useRef(false);

  const handleClick = (e) => {
    if (isMobile) {
      if (longPressFired.current) return;
      if (actionsRevealed) {
        const isButton = e.target.closest('button');
        if (isButton) return;
        setActionsRevealed(false);
        setShowDeleteConfirm(false);
        return;
      }
    }
    if (isExpired) {
      if (canExtend) {
        onExtend?.();
      } else if (hasRecap) {
        onPlayRecap?.();
      }
    } else {
      onLoad();
    }
  };

  const handleTouchStart = () => {
    touchMoved.current = false;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      setActionsRevealed(true);
    }, 500);
  };

  const handleTouchMove = () => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = (e) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressFired.current) {
      e.preventDefault();
    }
  };

  const hasAnnotations = game.clip_count > 0;

  if (isExpired) {
    return (
      <div
        className="group relative p-3 sm:p-4 bg-yellow-950/20 rounded-lg border border-yellow-800/40 transition-all hover:bg-yellow-950/30"
      >
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Gamepad2 size={18} className="text-yellow-500 flex-shrink-0" />
              <h3 className="text-white font-medium truncate">{game.name}</h3>
              <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 flex-shrink-0">
                <Clock size={10} />
                Expired
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-400">
              <span>{new Date(game.created_at).toLocaleDateString()}</span>
              <span>•</span>
              <span>{game.clip_count} clip{game.clip_count !== 1 ? 's' : ''}</span>
              {game.clip_count > 0 && (
                <>
                  {game.brilliant_count > 0 && (
                    <>
                      <span>•</span>
                      <span style={{ color: RATING_BADGE_COLORS[5] }}>{game.brilliant_count}{RATING_NOTATION[5]}</span>
                    </>
                  )}
                  {game.good_count > 0 && (
                    <>
                      <span>•</span>
                      <span style={{ color: RATING_BADGE_COLORS[4] }}>{game.good_count}{RATING_NOTATION[4]}</span>
                    </>
                  )}
                  <span className="hidden sm:inline">•</span>
                  <span className="hidden sm:inline" title="Quality score: brilliant×3 + good×2 + interesting×0 + mistake×(−1) + blunder×(−2)">
                    Quality: {(game.brilliant_count || 0) * 3 + (game.good_count || 0) * 2 + (game.mistake_count || 0) * -1 + (game.blunder_count || 0) * -2}
                  </span>
                  <TagBadges tagBadges={game.tag_badges} />
                </>
              )}
            </div>
          </div>

          {hasAnnotations && (
            <button
              onClick={(e) => { e.stopPropagation(); onPlayRecap?.('annotations'); }}
              className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-base font-medium bg-transparent ${GAME.accent} border-2 ${GAME.borderSubtle} hover:bg-green-900/30 hover:text-green-300 hover:border-green-500 transition-all`}
              title="Watch the recap (annotations and highlights)"
            >
              <Play size={18} />
              Recap
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-center gap-2">
          {canExtend && (
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              onClick={(e) => { e.stopPropagation(); onExtend?.(); }}
              title="Extend storage"
            >
              Extend Storage
            </Button>
          )}
          <Button
            variant={showDeleteConfirm ? 'danger' : 'ghost'}
            size="sm"
            icon={Trash2}
            onClick={handleDelete}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Remove from list'}
          >
            Remove
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      className={`group relative p-3 sm:p-4 bg-gray-800 rounded-lg border border-gray-700 transition-all hover:bg-gray-750 cursor-pointer ${GAME.borderHover}`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Gamepad2 size={18} className={`${GAME.accent} flex-shrink-0`} />
            <h3 className="text-white font-medium truncate">{game.name}</h3>
            {isFullyReviewed && (
              <CheckCircle size={14} className={GAME.accent} title="Fully reviewed" />
            )}
            {isPartiallyReviewed && (
              <span className="text-xs text-gray-400 flex items-center gap-1" title={`${viewedPercent}% reviewed`}>
                <Eye size={12} className="text-gray-500" />
                {viewedPercent}%
              </span>
            )}
            {isNew && game.video_duration > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-300">New</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-400">
            <span>{new Date(game.created_at).toLocaleDateString()}</span>
            <span>•</span>
            <span>{game.clip_count} clip{game.clip_count !== 1 ? 's' : ''}</span>
            {game.clip_count > 0 && (
              <>
                {game.brilliant_count > 0 && (
                  <>
                    <span>•</span>
                    <span style={{ color: RATING_BADGE_COLORS[5] }}>{game.brilliant_count}{RATING_NOTATION[5]}</span>
                  </>
                )}
                {game.good_count > 0 && (
                  <>
                    <span>•</span>
                    <span style={{ color: RATING_BADGE_COLORS[4] }}>{game.good_count}{RATING_NOTATION[4]}</span>
                  </>
                )}
                <span className="hidden sm:inline">•</span>
                <span className="hidden sm:inline" title="Quality score: brilliant×3 + good×2 + interesting×0 + mistake×(−1) + blunder×(−2)">
                  Quality: {(game.brilliant_count || 0) * 3 + (game.good_count || 0) * 2 + (game.mistake_count || 0) * -1 + (game.blunder_count || 0) * -2}
                </span>
                <TagBadges tagBadges={game.tag_badges} />
              </>
            )}
          </div>
        </div>

        {/* Edit + Share + Delete buttons - hover on desktop, long-press on mobile */}
        {(!isMobile || actionsRevealed) && (
          <div className={`flex items-center gap-1 transition-opacity ${isMobile ? 'opacity-100' : ''}`}>
            <Button
              variant="ghost"
              size="sm"
              icon={Pencil}
              iconOnly
              onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
              className={isMobile ? '' : 'opacity-0 group-hover:opacity-100'}
              title="Edit game details"
            />
            {!isExpired && (
              <Button
                variant="ghost"
                size="sm"
                icon={Share2}
                iconOnly
                onClick={(e) => { e.stopPropagation(); onShare?.(); }}
                className={isMobile ? '' : 'opacity-0 group-hover:opacity-100'}
                title="Share game"
              />
            )}
            <Button
              variant={showDeleteConfirm ? 'danger' : 'ghost'}
              size="sm"
              icon={Trash2}
              iconOnly
              onClick={handleDelete}
              className={isMobile ? '' : (!showDeleteConfirm ? 'opacity-0 group-hover:opacity-100' : '')}
              title={showDeleteConfirm ? 'Click again to confirm' : 'Delete game'}
            />
          </div>
        )}
      </div>

      {isNearExpiry && (
        <div className="mt-2 flex items-center justify-between border-t border-gray-700 pt-2">
          <span className="flex items-center gap-1.5 text-sm text-yellow-400">
            <Clock size={14} />
            Expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
          </span>
          {canExtend && (
            <Button
              variant="ghost"
              size="sm"
              icon={RefreshCw}
              onClick={(e) => { e.stopPropagation(); onExtend?.(); }}
            >
              Extend Storage
            </Button>
          )}
        </div>
      )}

      {hasBeenViewed && game.video_duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-700 rounded-b-lg overflow-hidden">
          <div
            className="h-full bg-green-500"
            style={{ width: `${viewedPercent}%` }}
          />
        </div>
      )}
    </div>
  );
}


/**
 * SegmentedProgressStrip - Visual progress indicator with segments
 *
 * Shows one segment per clip + one for overlay/final export.
 * Scales from 1 to 100+ clips by adjusting segment widths.
 *
 * Colors:
 * - Green (✓): Done/Complete (solid fill is reserved for done)
 * - Yellow/Amber: Exporting (actively rendering)
 * - Blue half-fill over gray: Started (has edits, not exported)
 * - Light Blue: Ready (for overlay - working video exists)
 * - Gray (○): Not started
 *
 * Click handlers:
 * - onClipClick(clipIndex) - Called when a clip segment is clicked
 * - onOverlayClick() - Called when the overlay segment is clicked
 *
 * @param {Object} project - Project data
 * @param {string} isExporting - 'framing' | 'overlay' | null - Which stage is currently exporting
 */
export function SegmentedProgressStrip({ project, onClipClick, onOverlayClick, isExporting = null, isOffline = false, failedExportType = null }) {
  const {
    clip_count,
    clips_exported,
    clips_in_progress,
    clips = [], // Clip details from backend
    has_working_video,
    has_overlay_edits,
    has_final_video
  } = project;

  // Once framing is complete (has_working_video), show a single "Framing" segment
  // instead of per-clip segments. Framing exports ALL clips into ONE working video,
  // so per-clip progress is only meaningful BEFORE framing is done.
  const framingComplete = has_working_video || has_final_video;

  // Build segment data
  const clipSegments = [];

  if (framingComplete) {
    // Framing done - show single "Framing" segment as complete
    clipSegments.push({ status: 'done', label: 'Framing', tags: [] });
  } else if (isExporting === 'framing') {
    // Currently exporting - show single "Framing" segment as exporting (or disconnected)
    clipSegments.push({ status: isOffline ? 'disconnected' : 'exporting', label: 'Framing', tags: [] });
  } else if (failedExportType === 'framing') {
    // Framing export failed - show single "Framing" segment as failed
    clipSegments.push({ status: 'export_failed', label: 'Framing', tags: [] });
  } else {
    // Framing not done - show per-clip editing status
    for (let i = 0; i < clip_count; i++) {
      const clipInfo = clips[i];
      const clipName = getClipDisplayName(clipInfo, `Clip ${i + 1}`);
      const clipTags = clipInfo?.tags || [];

      if (clips_in_progress > 0 && i < clips_in_progress) {
        clipSegments.push({ status: 'in_progress', label: clipName, tags: clipTags });
      } else {
        clipSegments.push({ status: 'pending', label: clipName, tags: clipTags });
      }
    }
  }

  // Overlay segment status:
  // - green: final video exported
  // - yellow: exporting final video
  // - blue: overlay edits in progress
  // - light blue: working video exists but no overlay edits yet (ready)
  // - gray: no working video
  let overlayStatus = 'pending';
  if (has_final_video) {
    overlayStatus = 'done';
  } else if (isExporting === 'overlay') {
    overlayStatus = isOffline ? 'disconnected' : 'exporting';
  } else if (failedExportType === 'overlay') {
    overlayStatus = 'export_failed';
  } else if (has_overlay_edits) {
    overlayStatus = 'in_progress';
  } else if (has_working_video) {
    overlayStatus = 'ready';
  }
  const overlaySegment = { status: overlayStatus, label: 'Overlay' };

  const allSegments = [...clipSegments, overlaySegment];

  // Total segments for compact view calculation
  const totalSegments = allSegments.length;

  // Calculate segment width - minimum 4px, flex to fill space
  const minWidth = 4;
  const gapWidth = 2;

  // Status to color mapping
  // in_progress gets a gray track with a blue bottom half-fill (rendered below) so
  // "started" reads as unfinished by shape, not just hue - solid fill means done (T3540)
  const statusColors = {
    done: 'bg-green-500',
    exporting: 'bg-amber-500',
    export_failed: 'bg-orange-500',
    disconnected: 'bg-gray-400',
    in_progress: 'bg-gray-600',
    ready: 'bg-blue-300',
    pending: 'bg-gray-600'
  };

  // For many clips, use a compact view
  const isCompact = totalSegments > 10;

  return (
    <div className="mt-3">
      {/* Labels row */}
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        {has_final_video ? (
          <span className="text-green-400 w-full text-center">Done</span>
        ) : (
          <>
            <span className="flex items-center gap-2">
              {isExporting === 'framing' && isOffline ? (
                <span className="text-red-400">Not Connected</span>
              ) : isExporting === 'framing' ? (
                <span className="text-amber-400 flex items-center gap-1">
                  <RefreshCw size={10} className="animate-spin" />
                  Framing...
                </span>
              ) : framingComplete ? (
                <span className="text-green-400">Framing</span>
              ) : (
                <span>Framing</span>
              )}
            </span>
            {isExporting === 'overlay' && isOffline ? (
              <span className="text-red-400">Not Connected</span>
            ) : isExporting === 'overlay' ? (
              <span className="text-amber-400 flex items-center gap-1">
                <RefreshCw size={10} className="animate-spin" />
                Exporting...
              </span>
            ) : (
              <span>Overlay</span>
            )}
          </>
        )}
      </div>

      {/* Segments strip */}
      <div
        className="flex h-3 bg-gray-700 rounded overflow-hidden"
        style={{ gap: `${gapWidth}px` }}
      >
        {allSegments.map((segment, index) => {
          const isLast = index === allSegments.length - 1;
          const isOverlay = isLast;
          const clipIndex = isOverlay ? -1 : index;

          const handleClick = (e) => {
            e.stopPropagation(); // Don't trigger card's onClick
            if (isOverlay && onOverlayClick) {
              onOverlayClick();
            } else if (!isOverlay && onClipClick) {
              onClipClick(clipIndex);
            }
          };

          const isInProgress = segment.status === 'in_progress';

          return (
            <div
              key={index}
              onClick={handleClick}
              className={`${statusColors[segment.status]} ${isInProgress ? 'relative overflow-hidden' : ''} transition-all cursor-pointer hover:brightness-110 ${
                isLast ? 'rounded-r' : ''
              } ${index === 0 ? 'rounded-l' : ''}`}
              style={{
                flex: isLast ? '0 0 20%' : '1 1 0',
                minWidth: `${minWidth}px`
              }}
              title={`${segment.label}${segment.tags?.length ? ` [${segment.tags.join(', ')}]` : ''}: ${
                segment.status === 'done' ? 'Complete' :
                segment.status === 'disconnected' ? 'Not Connected' :
                segment.status === 'exporting' ? 'Exporting...' :
                segment.status === 'in_progress' ? (isOverlay ? 'Started - export to complete' : 'Started - export framing to complete') :
                segment.status === 'ready' ? 'Ready' :
                'Not Started'
              } (click to open)`}
            >
              {isInProgress && (
                <div className="absolute bottom-0 inset-x-0 h-1/2 bg-blue-500 pointer-events-none" />
              )}
            </div>
          );
        })}
      </div>

    </div>
  );
}

/**
 * ProjectCard - Individual project in the list
 *
 * Click behavior:
 * - Click on project name/info area: Open with smart mode (auto-detect next action)
 * - Click on a clip segment: Open in framing mode with that clip selected
 * - Click on overlay segment: Open in overlay mode
 */
export function ProjectCard({ project, onSelect, onSelectWithMode, onDelete, exportingProject = null, pendingGameIds = new Set() }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  // T4050: when a durable publish fails to reach R2 (503 sync_failed), the card
  // stays put and we stash the gesture args so the user can Retry the exact same
  // "Move to My Reels" with one click (no refetch, no optimistic removal).
  const [publishRetry, setPublishRetry] = useState(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [actionsRevealed, setActionsRevealed] = useState(false);
  const longPressTimer = useRef(null);
  const touchMoved = useRef(false);
  const longPressFired = useRef(false);
  const isMobile = useIsMobile();
  const isOffline = useSyncStore((state) => state.isOffline);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef(null);
  const renameProject = useProjectsStore(state => state.renameProject);
  const fetchProjects = useProjectsStore(state => state.fetchProjects);

  const publishProject = async ({ openGallery }) => {
    setIsPublishing(true);
    // T4050 publish tracing: card removal is driven by fetchProjects re-reading
    // backend state below (NOT an optimistic local removal). These [Publish] logs
    // let a real "Move to My Reels" attempt be traced end-to-end (click -> POST ->
    // 200 -> refetch) and correlated with the backend [Publish]/[SYNC] log lines.
    console.log(`[Publish] click project=${project.id} openGallery=${openGallery} -> POST publish`);
    try {
      const response = await apiFetch(`${API_BASE}/api/downloads/publish/${project.id}`, {
        method: 'POST',
      });
      // T4050: a durable sync failure means the publish committed locally but never
      // reached R2. Returning 200 would let fetchProjects remove the card while the
      // reel silently reverts on the next session. Keep the card, skip the refetch,
      // and surface Retry (same gesture) instead of the blunt alert.
      if (response.status === 503) {
        const error = await response.json().catch(() => ({}));
        if (error.code === 'sync_failed') {
          console.warn(`[Publish] project=${project.id} sync_failed (503) - card kept, offering Retry`);
          setPublishRetry({ openGallery });
          return;
        }
      }
      if (!response.ok) {
        const error = await response.json();
        // Card is NOT removed on failure: we throw before fetchProjects, the catch
        // alerts, and the draft stays put.
        console.warn(`[Publish] project=${project.id} FAILED status=${response.status} - card kept in Drafts`);
        throw new Error(error.detail || 'Failed to publish');
      }
      const result = await response.json();
      setPublishRetry(null);
      console.log(`[Publish] project=${project.id} 200 ok archived=${result.archived} final_video_id=${result.final_video_id}`);
      if (!result.archived) {
        console.warn(`[ProjectCard] Project ${project.id} published but archive failed - card stays in Drafts.`);
      }
      // Model changed (a reel was published) -> update count badge + dispatch the
      // collections-changed event so the My Reels list refreshes itself.
      useGalleryStore.getState().fetchCount({ force: true });
      useGalleryStore.getState().notifyCollectionsChanged();
      console.log(`[Publish] project=${project.id} refetching projects (card removal reflects backend state)`);
      fetchProjects({ force: true });
      // quest_4 "Move to My Reels" step — the publish gesture completes it.
      useQuestStore.getState().recordAchievement('moved_to_my_reels');
      if (openGallery) {
        useGalleryStore.getState().open();
      }
    } catch (error) {
      console.error('[Publish] error:', error);
      alert(`Failed to move to ${SECTION_NAMES.LIBRARY}: ${error.message}`);
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePublishToMyReels = (e) => {
    e.stopPropagation();
    publishProject({ openGallery: true });
  };

  const handleHideFromDrafts = (e) => {
    e.stopPropagation();
    publishProject({ openGallery: false });
  };

  const handleStartRename = (e) => {
    e.stopPropagation();
    setRenameValue(project.name || '');
    setIsRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  };

  const handleSaveRename = async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === project.name) {
      setIsRenaming(false);
      return;
    }
    try {
      await renameProject(project.id, trimmed);
    } catch {
      // Revert on failure — store didn't update
    }
    setIsRenaming(false);
  };

  const handleRenameKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleSaveRename();
    } else if (e.key === 'Escape') {
      setIsRenaming(false);
    }
  };

  // Check export store for active exports (survives refresh)
  const activeExports = useExportStore((state) => state.activeExports);
  const storeExport = Object.values(activeExports).find(
    (exp) => exp.projectId === project.id && (exp.status === 'pending' || exp.status === 'processing')
  );

  // Determine if this project is currently exporting
  // Check both context (current session) and store (recovered from server)
  const isExporting = exportingProject?.projectId === project.id
    ? exportingProject.stage
    : storeExport?.type || null;

  // Check for failed exports (only when not actively exporting)
  const failedExport = !isExporting
    ? Object.values(activeExports).find(
        (exp) => exp.projectId === project.id && exp.status === 'error'
      ) || null
    : null;
  const failedExportType = failedExport?.type || null;

  const isWaitingForUpload = project.game_ids?.some(id => pendingGameIds.has(id));
  const canOpen = !isWaitingForUpload;

  const handleDelete = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
    } else {
      setShowDeleteConfirm(true);
      // Auto-hide after 3 seconds
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  const handleClipClick = (clipIndex) => {
    if (!canOpen) return; // Block if no clips extracted
    if (onSelectWithMode) {
      onSelectWithMode({ mode: 'framing', clipIndex });
    }
  };

  const handleOverlayClick = () => {
    if (!canOpen) return; // Block if no clips extracted
    if (onSelectWithMode) {
      onSelectWithMode({ mode: 'overlay' });
    }
  };

  const handleCardClick = () => {
    if (isRenaming) return;
    if (isMobile && actionsRevealed) {
      setActionsRevealed(false);
      return;
    }
    if (!canOpen) return;
    const needsOverlay = project.has_working_video && (
      !project.has_final_video ||
      (project.working_video_created_at && project.final_video_created_at &&
       project.working_video_created_at > project.final_video_created_at)
    );
    if (needsOverlay) {
      onSelectWithMode({ mode: 'overlay' });
    } else {
      onSelect();
    }
  };

  const handleTouchStart = () => {
    touchMoved.current = false;
    longPressFired.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      longPressFired.current = true;
      setActionsRevealed(true);
    }, 500);
  };

  const handleTouchMove = () => {
    touchMoved.current = true;
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchEnd = (e) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    if (longPressFired.current) {
      e.preventDefault();
    }
  };

  const isComplete = project.has_final_video;

  const isReadyToPublish = isComplete && !project.is_published;

  return (
    <div
      data-testid="project-card"
      onClick={isReadyToPublish ? undefined : handleCardClick}
      onTouchStart={isMobile ? handleTouchStart : undefined}
      onTouchMove={isMobile ? handleTouchMove : undefined}
      onTouchEnd={isMobile ? handleTouchEnd : undefined}
      className={`group relative p-3 sm:p-4 bg-gray-800 rounded-lg border transition-all ${
        isReadyToPublish
          ? 'border-gray-700'
          : canOpen
            ? `hover:bg-gray-750 cursor-pointer border-gray-700 ${REEL.borderHover}`
            : 'cursor-not-allowed border-gray-700 opacity-75'
      }`}
      title={undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-2">
            {project.is_auto_created && (
              <Star size={14} className="text-yellow-400 flex-shrink-0" fill="currentColor" title="Auto-created reel" />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                onBlur={handleSaveRename}
                onClick={(e) => e.stopPropagation()}
                className={`text-white font-medium bg-transparent border-b ${REEL.border} outline-none w-full`}
                autoFocus
              />
            ) : (
              <>
                <h3 className="text-white font-medium truncate">
                  {getProjectDisplayName(project)}
                </h3>
                <button
                  onClick={handleStartRename}
                  className={`${isMobile ? (actionsRevealed ? 'opacity-60' : 'opacity-0 pointer-events-none') : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'} text-gray-400 transition-opacity flex-shrink-0`}
                  title="Rename reel"
                >
                  <Pencil size={14} />
                </button>
              </>
            )}
            {isComplete && project.is_published && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${REEL.bgMuted} ${REEL.accent} flex-shrink-0`}>
                <CheckCircle size={12} />
                In {SECTION_NAMES.LIBRARY}
              </span>
            )}
            {/* T3920: clip's game time (single-clip drafts only) */}
            {formatGameClock(project.clip_game_start_time) && (
              <span className="shrink-0 text-sm text-gray-400" title="Game time">
                {formatGameClock(project.clip_game_start_time)}
              </span>
            )}
          </div>

          {/* Tags row */}
          {project.is_auto_created && project.clips?.[0]?.tags?.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {project.clips[0].tags.map((tag, idx) => (
                <span
                  key={idx}
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs ${REEL.bgMuted} ${REEL.accentMuted} rounded`}
                >
                  <Tag size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-sm text-gray-400">
            <span>{project.aspect_ratio}</span>
            <span>•</span>
            <span>{project.clip_count} clip{project.clip_count !== 1 ? 's' : ''}</span>
            {isComplete && (
              <>
                <span>•</span>
                <span className="inline-flex items-center gap-1 text-green-400">
                  <CheckCircle size={12} />
                  Done
                </span>
              </>
            )}
            {!project.has_final_video && (
              <>
                <span>•</span>
                <span>
                  {isWaitingForUpload ? (
                    <span className="text-amber-400 inline-flex items-center gap-1">
                      <Upload size={12} />
                      Waiting for upload
                    </span>
                  ) :
                  isExporting && isOffline ? (
                    <span className="text-gray-400">Disconnected</span>
                  ) :
                  isExporting === 'overlay' ? (
                    <span className="text-amber-400">Exporting...</span>
                  ) :
                  isExporting === 'framing' ? (
                    <span className="text-amber-400">Exporting...</span>
                  ) :
                  failedExportType ? (
                    <span className="text-orange-400">Export Failed</span>
                  ) :
                  project.has_working_video ? 'In Overlay' :
                  project.clips_in_progress > 0 ? (
                    <span className="text-blue-400">Framing started</span>
                  ) :
                  project.clips_exported > 0 ? 'Exported' : 'Not Started'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Top-right: Move CTA for ready-to-publish, delete icon for other states */}
        {isReadyToPublish ? (
          <button
            onClick={handlePublishToMyReels}
            disabled={isPublishing}
            className={`flex-shrink-0 flex items-center justify-center gap-2 px-6 py-3 rounded-lg text-base font-medium bg-transparent ${REEL.accent} border-2 ${REEL.borderSubtle} hover:bg-cyan-900/30 hover:text-cyan-300 hover:border-cyan-500 transition-all disabled:opacity-50`}
          >
            {isPublishing ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Image size={18} />
            )}
            Move to {SECTION_NAMES.LIBRARY}
          </button>
        ) : (
          <Button
            variant={showDeleteConfirm ? 'danger' : 'ghost'}
            size="sm"
            icon={Trash2}
            iconOnly
            onClick={handleDelete}
            className={isMobile
              ? (!showDeleteConfirm && !actionsRevealed ? 'opacity-0 pointer-events-none' : '')
              : (!showDeleteConfirm ? 'opacity-0 group-hover:opacity-100' : '')}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'}
          />
        )}
      </div>

      {publishRetry && (
        /* T4050: durable publish couldn't reach the cloud — keep the card and let
           the user retry the same gesture instead of silently reverting later. */
        <div className="mt-2 flex items-center justify-center gap-2 text-sm" role="alert">
          <span className="text-amber-400">Couldn&apos;t save to the cloud.</span>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); publishProject(publishRetry); }}
            disabled={isPublishing}
            className="px-3 py-1 rounded-md font-medium border border-amber-500 text-amber-300 hover:bg-amber-900/30 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}

      {isComplete ? (
        /* Secondary actions row — shown for all Done reels, published or not */
        <div className="mt-2 flex items-center justify-center gap-2">
          {project.final_video_id && (
            <Button
              variant="ghost"
              size="sm"
              icon={Play}
              iconOnly
              onClick={(e) => { e.stopPropagation(); setIsPreviewing(true); }}
              title="Preview video"
            />
          )}
          <Button
            variant="ghost"
            size="sm"
            icon={Crop}
            iconOnly
            onClick={(e) => { e.stopPropagation(); handleClipClick(0); }}
            title="Open in Framing"
          />
          <Button
            variant="ghost"
            size="sm"
            icon={Layers}
            iconOnly
            onClick={(e) => { e.stopPropagation(); handleOverlayClick(); }}
            title="Open in Overlay"
          />
          {isReadyToPublish ? (
            <Button
              variant={showDeleteConfirm ? 'danger' : 'ghost'}
              size="sm"
              icon={Trash2}
              iconOnly
              onClick={handleDelete}
              title={showDeleteConfirm ? 'Click again to confirm' : 'Delete reel'}
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              icon={EyeOff}
              iconOnly
              loading={isPublishing}
              onClick={handleHideFromDrafts}
              title={`Hide from Drafts (stays in ${SECTION_NAMES.LIBRARY})`}
            />
          )}
        </div>
      ) : (
        /* Segmented progress strip - clickable segments for direct navigation */
        <SegmentedProgressStrip
          project={project}
          onClipClick={handleClipClick}
          onOverlayClick={handleOverlayClick}
          isExporting={isExporting}
          isOffline={isOffline}
          failedExportType={failedExportType}
        />
      )}

      {/* Video preview modal */}
      {isPreviewing && project.final_video_id && (
        <>
          <div
            className="fixed inset-0 bg-black/80 z-[60]"
            onClick={(e) => { e.stopPropagation(); setIsPreviewing(false); }}
          />
          <div className="fixed inset-4 md:inset-12 lg:inset-20 z-[70] flex flex-col bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800">
              <div className="flex items-center gap-3">
                <Film size={20} className={REEL.accent} />
                <h3 className="text-white font-medium">{getProjectDisplayName(project)}</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                iconOnly
                onClick={(e) => { e.stopPropagation(); setIsPreviewing(false); }}
              />
            </div>
            <div className="flex-1 min-h-0">
              <MediaPlayer
                src={`${API_BASE}/api/downloads/${project.final_video_id}/stream`}
                autoPlay
                onClose={() => setIsPreviewing(false)}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}


export default ProjectManager;
