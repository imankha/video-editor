import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, Plus, CheckCircle, Gamepad2, Image, Filter, Star, Folder, Clock, ChevronRight, AlertTriangle, RefreshCw, Upload, X, FileVideo, Loader2, Share2 } from 'lucide-react';
import { LogoWithText } from './Logo';
import { useAppState } from '../contexts';
import { useSettingsStore } from '../stores/settingsStore';
import { GameClipSelectorModal } from './GameClipSelectorModal';
import { GameDetailsModal } from './GameDetailsModal';
import { Button } from './shared/Button';
import { toast } from './shared/Toast';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { generateClipName, getProjectDisplayName } from '../utils/clipDisplayName';
import { compareGameTime } from '../utils/timeFormat';
import { ProfileDropdown } from './ProfileDropdown';
import { ProfileSportButton } from './ProfileSportButton';
import { CreditBalance } from './CreditBalance';
import { SignInButton } from './SignInButton';
import { useAuthStore } from '../stores/authStore';
import { SECTION_NAMES } from '../config/displayNames';
import { GAME, REEL } from '../config/themeColors';
import { ExpirationBadge } from './ExpirationBadge';
import { StorageExtensionModal } from './StorageExtensionModal';
import { RecapPlayerModal } from './RecapPlayerModal';
import { ShareGameModal } from './ShareGameModal';
import { EditGameModal } from './EditGameModal';
import { prioritizeUrls } from '../utils/cacheWarming';
import { shareInvite } from '../utils/inviteEmail';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import {
  consumePendingRecap,
  setPendingGameReference,
  peekPendingGameReference,
  consumePendingGameReference,
} from '../utils/pendingNavigation';
import { InstallButton } from './InstallButton';
// DraftTile (the restyled ProjectCard) + SegmentedProgressStrip were extracted to their
// own files (T5672). Re-exported below (DraftTile aliased to ProjectCard) so existing
// tests importing them from './ProjectManager' keep resolving.
import { DraftTile } from './DraftTile';
import { SegmentedProgressStrip } from './shared/SegmentedProgressStrip';
import { CardCarousel } from './shared/CardCarousel';
import { GameTile } from './GameTile';
import { ReferenceGameCard } from './ReferenceGameCard';
import { splitByAspect } from '../constants/aspectRatios';
import { DRAFT_STAGE, DRAFT_STAGE_LABELS, DRAFT_STAGE_TINTS, splitByStage } from '../utils/draftStage';

// Shared layout class strings for the Games tab poster grid (T5681/T6310). The
// loaded games grid AND its loading skeleton both consume these so the skeleton
// can never drift from the real layout again (the T6310 bug). If the grid shape
// changes, change it here and both surfaces move together.
const GAMES_GRID_CONTAINER_CLASS = 'w-full max-w-6xl 2xl:max-w-7xl';
const GAMES_TILE_GRID_CLASS = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 lg:gap-4';

// T6810: stage rows for a draft list — one entry per pipeline stage present,
// each carrying its aspect sub-rows. Not-Started drafts all render landscape
// (T6800 sizes them at source aspect regardless of target ratio), so that
// stage gets ONE row with no aspect chip (ratio null) instead of a split that
// would separate identically-shaped tiles by an invisible target ratio.
function stageRowsFor(draftList) {
  return splitByStage(draftList).map(({ stage, projects }) => ({
    stage,
    byAspect: stage === DRAFT_STAGE.NOT_STARTED
      ? [{ ratio: null, projects }]
      : splitByAspect(projects),
  }));
}

// T6810: the stage-labeled carousel rows for one draft list (a game group or
// "Other reels"). ONE renderer for both call sites so the two surfaces can
// never drift. Each stage row = a label chip (legend-tinted stage name +
// count) then one carousel per aspect present within that stage; the aspect
// chip only appears when a stage actually mixes aspects (mirrors the old
// byAspect behavior, now scoped per stage).
function DraftStageRows({
  byStage,
  ariaPrefix,
  onSelectProject,
  onSelectProjectWithMode,
  onDeleteProject,
  exportingProject,
  pendingGameIds,
}) {
  return byStage.map(({ stage, byAspect }) => {
    const stageCount = byAspect.reduce((n, bucket) => n + bucket.projects.length, 0);
    return (
      <div key={stage} data-testid={`stage-row-${stage}`}>
        <div className="px-3 pb-1 flex items-center gap-1.5">
          <span className={`text-[10px] font-semibold ${DRAFT_STAGE_TINTS[stage]} bg-gray-700/40 px-1.5 py-0.5 rounded`}>
            {DRAFT_STAGE_LABELS[stage]}
          </span>
          <span className="text-[10px] text-gray-500">{stageCount}</span>
        </div>
        {byAspect.map(({ ratio, projects: aspectProjects }) => (
          <div key={ratio ?? 'source'}>
            {byAspect.length > 1 && (
              <div className="px-3 pb-1">
                <span className="text-[10px] font-semibold text-gray-500 bg-gray-700/40 px-1.5 py-0.5 rounded">
                  {ratio}
                </span>
              </div>
            )}
            <CardCarousel
              ariaLabel={`${ariaPrefix} ${DRAFT_STAGE_LABELS[stage]}${byAspect.length > 1 ? ` ${ratio}` : ''}`}
            >
              {aspectProjects.map(project => (
                <DraftTile
                  key={project.id}
                  project={project}
                  onSelect={() => onSelectProject(project.id)}
                  onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                  onDelete={() => onDeleteProject(project.id)}
                  exportingProject={exportingProject}
                  pendingGameIds={pendingGameIds}
                />
              ))}
            </CardCarousel>
          </div>
        ))}
      </div>
    );
  });
}

// Group games by month (YYYY-MM) in chronological order (newest first)
function groupGamesByMonth(games) {
  const groups = {};
  const order = [];

  // Sort games by created_at (newest first)
  const sorted = [...games].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  sorted.forEach(game => {
    const date = new Date(game.created_at);
    const key = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    if (!groups[key]) {
      groups[key] = [];
      order.push(key);
    }
    groups[key].push(game);
  });

  return { groups, order };
}

// The active tab is URL state (/home/games -> Games, /home/reels -> Reel Drafts),
// never persisted. Map a pathname to its tab, or null when the URL names no tab
// (bare /home) so callers can fall back to a default. (T5677)
function tabFromPath(pathname) {
  if (pathname === '/home/games') return 'games';
  if (pathname === '/home/reels') return 'projects';
  return null;
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
  // URL-first: a deep link / refresh to /home/games or /home/reels lands on that
  // tab. Bare /home falls back to the projects-count default. (T5677)
  const initialTab = tabFromPath(window.location.pathname)
    ?? (projects.length === 0 ? 'games' : 'projects');
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
  // T5820: transient cross-profile-reference landing state (NOT persisted — pure
  // in-memory affordance). highlightGameId briefly rings the game we navigated to;
  // referenceNotice shows the degraded-link message when the owning game is gone.
  const [highlightGameId, setHighlightGameId] = useState(null);
  const [referenceNotice, setReferenceNotice] = useState(null);
  const currentProfileId = useProfileStore((s) => s.currentProfileId);
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
      // T6810: drafts render one labeled carousel row per pipeline stage
      // (Not Started -> In Framing -> In Overlay -> Ready), each stage keeping
      // the aspect sub-split so tile heights stay consistent within a row;
      // count/statusCounts above stay whole-game (all stages combined).
      groups[key].byStage = stageRowsFor(groups[key].projects);
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

    return { groups, sortedKeys, ungrouped, ungroupedByStage: stageRowsFor(ungrouped) };
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
    // A URL-named tab is authoritative — don't let the projects-count default
    // flip a cold /home/games deep link over to Reel Drafts. (T5677)
    if (tabFromPath(window.location.pathname)) {
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

  // T5730: post-claim landing = the claimed game's recap (watching first), with a
  // one-time "tag your athlete's plays" nudge toward Annotate. Consumed once the
  // games list has loaded so the freshly-imported game is present; the breadcrumb
  // is cleared on read so it fires exactly once (never on a later home visit).
  useEffect(() => {
    if (loading || games.length === 0) return;
    const recapGameId = consumePendingRecap();
    if (recapGameId == null) return;
    const game = games.find(g => g.id === recapGameId);
    if (!game) return;
    setRecapGame({ game, initialTab: 'team' });
    toast.info('Tag your athlete’s plays', {
      message: 'This game is on your Team layer — open Annotate to tag your own athlete.',
    });
  }, [games, loading]);
  // T5820: clicking a reference card is a composite gesture — set the transient
  // cross-profile breadcrumb, hint the Games tab (the existing read-once
  // `projectManagerTab` mechanism, consumed by the effect above), then switch to
  // the owning profile. The switch resets the data stores + navigates to Project
  // Manager; the sessionStorage breadcrumb survives that reset (it clears Zustand
  // only), and the effect below consumes it once the owning profile's games land.
  const handleOpenReference = useCallback((game) => {
    if (!game?.source_profile_id) {
      console.error('[ProjectManager] reference card clicked without a source_profile_id — backend bug', game);
      return;
    }
    setPendingGameReference({
      sourceProfileId: game.source_profile_id,
      sourceGameId: game.source_game_id,
      sourceProfileName: game.source_profile_name,
    });
    sessionStorage.setItem('projectManagerTab', 'games');
    useProfileStore.getState().switchProfile(game.source_profile_id);
  }, []);

  // T5820: after landing in the owning profile, locate the real game by its exact
  // `source_game_id` (projected by GET /api/games under is_reference — T5800),
  // scroll it into view and ring it briefly. Detection of a deleted owning game is
  // at THIS point (a list that settled with no match), never a cross-profile
  // existence check on render.
  //
  // The switch flips currentProfileId BEFORE _resetDataStores refetches, so there is
  // a transient render where we're "on" the owning profile but `games` still holds
  // the previous profile's (stale) list with gamesLoading momentarily false. Consuming
  // then would false-degrade. So we wait for the owning profile's OWN fetch to run:
  // only consume after we've observed gamesLoading go true (fetch started) and back
  // to false (fetch settled) while on the target profile.
  const referenceLoadStartedRef = useRef(false);
  useEffect(() => {
    const pending = peekPendingGameReference();
    if (!pending) return;
    if (currentProfileId !== pending.sourceProfileId) return;
    if (gamesLoading) {
      referenceLoadStartedRef.current = true; // the target profile's fetch is in flight
      return;
    }
    if (!referenceLoadStartedRef.current) return; // still the stale pre-refetch list

    referenceLoadStartedRef.current = false;
    consumePendingGameReference();
    setActiveTab('games');

    if (pending.sourceGameId == null) {
      console.error('[ProjectManager] reference breadcrumb missing sourceGameId — backend bug', pending);
      return;
    }

    const target = games.find(
      (g) => !g.is_reference && g.id === pending.sourceGameId
    );
    if (target) {
      setHighlightGameId(target.id);
      requestAnimationFrame(() => {
        gamesContainerRef.current
          ?.querySelector(`[data-game-id="${target.id}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      const t = setTimeout(() => setHighlightGameId(null), 2500);
      return () => clearTimeout(t);
    }

    // Degraded link: the owning game was deleted after the move. Keep the user
    // informed (no silent no-op); the reference card stays for grouping context.
    // Same owner-label rule as ReferenceGameCard: an UNNAMED profile is normal
    // data (the default profile has no name) and the app calls it "Default";
    // only a genuinely absent name falls back to the vague wording.
    const ownerLabel = pending.sourceProfileName
      || (pending.sourceProfileName == null ? 'that profile' : 'Default');
    setReferenceNotice(`This game is no longer in ${ownerLabel}.`);
    const t = setTimeout(() => setReferenceNotice(null), 6000);
    return () => clearTimeout(t);
  }, [games, gamesLoading, currentProfileId, setActiveTab]);

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
      <div className="text-center pt-10 sm:pt-0 mb-4">
        <LogoWithText className="mx-auto mb-3" logoSize={40} textClassName="text-2xl sm:text-3xl" />
        <p className="text-gray-400 text-sm">Share Your Player's Brilliance</p>
      </div>

      {/* Continue Where You Left Off - compact 2-up on mobile, full on desktop */}
      {showRecentSection && (
        <div className="w-full max-w-2xl mb-4">
          <div className="flex items-center gap-2 mb-2 sm:mb-3">
            <Clock size={14} className="text-gray-500" />
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Continue Where You Left Off
            </h2>
          </div>
          <div className="flex gap-2 sm:gap-3">
            {/* Recent Game (left) */}
            {recentItems.recentGame && (
              <button
                onClick={() => onLoadGame(recentItems.recentGame.id)}
                className={`flex-1 min-w-0 min-h-[44px] flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg border transition-all text-left ${GAME.bgSubtle} ${GAME.borderSubtle} ${GAME.bgSubtleHover}`}
              >
                <div className={`p-1.5 sm:p-2 rounded-lg ${GAME.bgIcon}`}>
                  <Gamepad2 size={18} className={GAME.accent} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-white font-medium truncate block">
                    {recentItems.recentGame.name}
                  </span>
                  <div className="hidden sm:block text-xs text-gray-500">
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
                className={`flex-1 min-w-0 min-h-[44px] flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3 rounded-lg border transition-all text-left ${REEL.bgSubtle} ${REEL.borderSubtle} ${REEL.bgSubtleHover}`}
              >
                <div className={`p-1.5 sm:p-2 rounded-lg ${REEL.bgIcon}`}>
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
                  <div className="hidden sm:block text-xs text-gray-500">
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
      <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mb-4">
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
      <div className="mb-4 sm:mb-5">
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

      {/* T5820: degraded cross-profile link notice — the owning game was deleted
          after the move, so the reference could not resolve to a real game. Shown
          briefly so the click is never a silent no-op. */}
      {referenceNotice && (
        <div
          role="status"
          data-reference-notice
          className="mb-4 flex items-start gap-2 rounded-lg border border-yellow-800/50 bg-yellow-900/30 px-3 py-2 text-sm text-yellow-200"
        >
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-yellow-400" />
          <span>{referenceNotice}</span>
          <button
            type="button"
            onClick={() => setReferenceNotice(null)}
            aria-label="Dismiss"
            className="ml-auto flex-shrink-0 text-yellow-400/70 hover:text-yellow-200"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Content */}
      {activeTab === 'games' ? (
        /* Games List */
        gamesLoading ? (
          <GamesListSkeleton />
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
          <div className={GAMES_GRID_CONTAINER_CLASS}>
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

            {/* Your Games Section - Chronological Poster Grid (T5681) */}
            {games.length > 0 && (() => {
              const { groups, order } = groupGamesByMonth(games);
              return (
                <>
                  <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-4">
                    Your Games
                  </h2>
                  <div ref={gamesContainerRef} className="space-y-6">
                    {order.map(monthKey => (
                      <div key={monthKey}>
                        {/* Month header with game count */}
                        <div className="mb-3 flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-300">{monthKey}</h3>
                          <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
                            {groups[monthKey].length} game{groups[monthKey].length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        {/* Landscape tile grid: 6-up desktop, 3-up tablet, 2-up mobile */}
                        <div className={GAMES_TILE_GRID_CLASS}>
                          {groups[monthKey].map(game => (
                            <div
                              key={game.id}
                              data-game-id={game.id}
                              className={game.id === highlightGameId
                                ? 'rounded-lg ring-2 ring-green-400 ring-offset-2 ring-offset-gray-900 transition-shadow duration-300'
                                : undefined}
                            >
                              {/* T5820: a reference (cross-profile link) renders a distinct,
                                  non-editable link card; real games render the unchanged tile. */}
                              {game.is_reference ? (
                                <ReferenceGameCard game={game} onOpen={handleOpenReference} />
                              ) : (
                                <GameTile
                                  game={game}
                                  onLoad={() => onLoadGame(game.id)}
                                  onDelete={() => onDeleteGame(game.id)}
                                  onExtend={() => setExtensionGame(game)}
                                  onPlayRecap={(tab) => setRecapGame({ game, initialTab: tab })}
                                  onShare={() => setShareGame(game)}
                                  onEdit={() => setEditGame(game)}
                                />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              );
            })()}
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
          /* Drafts tab widens to max-w-6xl so the carousels use the viewport (Q1 /
             audit finding #13 desktop dead-space fix); the Games tab now uses the same
             GAMES_GRID_CONTAINER_CLASS width (max-w-6xl 2xl:max-w-7xl) for its poster grid. */
          <div className="w-full max-w-6xl 2xl:max-w-7xl">
            {/* Filters - only show when useful. Groups sit inline (gap-x) when they fit,
                and wrap onto their own line when they don't. */}
            {showFilters && (
              <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {/* Status Filter */}
                {filterCounts.showStatusFilter && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Status</span>
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
                          className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
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
                )}

                {/* Aspect Ratio Filter */}
                {filterCounts.showAspectFilter && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Aspect Ratio</span>
                    <button
                      onClick={() => setAspectFilter('all')}
                      className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
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
                        className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
                          aspectFilter === ratio
                            ? `${REEL.bg} text-white`
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        {ratio} ({count})
                      </button>
                    ))}
                  </div>
                )}

                {/* Creation Type Filter */}
                {filterCounts.showCreationFilter && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Created By</span>
                    <button
                      onClick={() => setCreationFilter('all')}
                      className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
                        creationFilter === 'all'
                          ? `${REEL.bg} text-white`
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setCreationFilter('auto')}
                      className={`flex items-center gap-1 px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
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
                      className={`flex items-center gap-1 px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
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
                  {/* Ungrouped drafts (no game) -> one "Other reels" section; one
                      labeled carousel row per pipeline stage present, each stage
                      aspect-split so row heights stay consistent (T6810) */}
                  {groupedProjects.ungrouped.length > 0 && (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 px-3 py-2 min-h-11">
                        <span className="text-sm font-medium text-gray-200 flex-1">Other reels</span>
                        <span className="text-xs text-gray-500 bg-gray-700/50 px-2 py-0.5 rounded-full">
                          {groupedProjects.ungrouped.length}
                        </span>
                      </div>
                      <DraftStageRows
                        byStage={groupedProjects.ungroupedByStage}
                        ariaPrefix="Other reels"
                        onSelectProject={onSelectProject}
                        onSelectProjectWithMode={onSelectProjectWithMode}
                        onDeleteProject={onDeleteProject}
                        exportingProject={exportingProject}
                        pendingGameIds={pendingGameIds}
                      />
                    </div>
                  )}

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
                      {/* One labeled carousel row per pipeline stage present
                          (Not Started -> In Framing -> In Overlay -> Ready), each
                          stage aspect-split so a row never mixes tile heights (T6810). */}
                      <DraftStageRows
                        byStage={group.byStage}
                        ariaPrefix={`${groupKey} drafts`}
                        onSelectProject={onSelectProject}
                        onSelectProjectWithMode={onSelectProjectWithMode}
                        onDeleteProject={onDeleteProject}
                        exportingProject={exportingProject}
                        pendingGameIds={pendingGameIds}
                      />
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
 * GamesListSkeleton - placeholder shown while the Games tab loads (T4771, rebuilt
 * T6310). Mirrors the loaded poster grid (GameTile, T5681): same container width
 * and same responsive tile grid as the real list (shared via GAMES_GRID_CONTAINER_CLASS
 * / GAMES_TILE_GRID_CLASS), with `aspect-video` shells instead of GameTiles, so data
 * arriving does not snap the layout. Pure render — no fetching, no subscribing.
 *
 * `count` defaults to 6: the grid is 6-up on desktop, 3-up on tablet, 2-up on
 * mobile, and 6 divides all three, so it fills exactly one desktop row / two tablet
 * rows / three mobile rows with no ragged partial row at any breakpoint.
 */
export function GamesListSkeleton({ count = 6 }) {
  return (
    <div className={GAMES_GRID_CONTAINER_CLASS} data-testid="games-skeleton">
      {/* "Your Games" heading placeholder */}
      <div className="h-3.5 w-24 bg-gray-700/70 rounded mb-4 animate-pulse" />
      <div className={GAMES_TILE_GRID_CLASS}>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="aspect-video bg-gray-800 rounded-lg border border-gray-700 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

// Back-compat re-exports (T5672 extraction): tests and callers import these from here.
export { DraftTile as ProjectCard, SegmentedProgressStrip };

export default ProjectManager;
