import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, Plus, Trash2, Film, CheckCircle, Gamepad2, PlayCircle, Image, Filter, Star, Folder, Clock, ChevronRight, AlertTriangle, RefreshCw, Tag, Upload, X, FileVideo, Loader2 } from 'lucide-react';
import { Logo } from './Logo';
import { useAppState } from '../contexts';
import { useExportStore } from '../stores/exportStore';
import { useSettingsStore } from '../stores/settingsStore';
import { GameClipSelectorModal } from './GameClipSelectorModal';
import { GameDetailsModal } from './GameDetailsModal';
import { Button } from './shared/Button';
import { CollapsibleGroup } from './shared/CollapsibleGroup';
import { generateClipName } from '../modes/annotate/constants/soccerTags';
import { getProjectDisplayName, getClipDisplayName } from '../utils/clipDisplayName';

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
  downloadsCount: downloadsCountProp,
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
}) {
  // Get downloads and export state from context
  const { downloadsCount: contextDownloadsCount, exportingProject: contextExportingProject } = useAppState();

  // Use props if provided, otherwise fall back to context
  const downloadsCount = downloadsCountProp ?? contextDownloadsCount ?? 0;
  const exportingProject = exportingProjectProp ?? contextExportingProject;
  const [activeTab, setActiveTab] = useState('projects'); // 'games' | 'projects'
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showGameDetailsModal, setShowGameDetailsModal] = useState(false);
  const gameFileInputRef = useRef(null);
  const resumeFileInputRef = useRef(null);
  const [resumingUploadFilename, setResumingUploadFilename] = useState(null); // Track which upload we're resuming

  // Project filter state - persisted via settings store
  const {
    settings,
    loadSettings,
    setStatusFilter,
    setAspectFilter,
    setCreationFilter,
  } = useSettingsStore();

  const { statusFilter, aspectFilter, creationFilter } = settings.projectFilters;

  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

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

    return counts;
  }, [projects]);

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

  // Open game details modal
  const handleAddGameClick = useCallback(() => {
    setShowGameDetailsModal(true);
  }, []);

  // Handle game creation with details
  const handleCreateGame = useCallback(async (gameDetails) => {
    if (onAnnotateWithFile) {
      await onAnnotateWithFile(gameDetails);
    }
  }, [onAnnotateWithFile]);

  // Fetch games on mount and when switching to games tab or when opening modal
  // We always fetch on mount so the "Continue Where You Left Off" section works
  useEffect(() => {
    if (onFetchGames) {
      onFetchGames();
    }
  }, [onFetchGames]);

  // Also refetch when switching to games tab or when opening modal
  useEffect(() => {
    if ((activeTab === 'games' || showNewProjectModal) && onFetchGames) {
      onFetchGames();
    }
  }, [activeTab, showNewProjectModal, onFetchGames]);

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
    <div className="flex-1 flex flex-col items-center p-8 bg-gray-900">
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

      {/* Gallery button - fixed top right corner */}
      {onOpenDownloads && (
        <Button
          variant="outline"
          icon={Image}
          onClick={onOpenDownloads}
          className="fixed top-4 right-4 z-30"
          title="Gallery"
        >
          Gallery
          {downloadsCount > 0 && (
            <span className="px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
              {downloadsCount > 9 ? '9+' : downloadsCount}
            </span>
          )}
        </Button>
      )}

      {/* Header */}
      <div className="text-center mb-6">
        <Logo size={48} className="mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">Reel Ballers</h1>
        <p className="text-gray-400">Manage your games and projects</p>
      </div>

      {/* Continue Where You Left Off - Recent Section */}
      {showRecentSection && (
        <div className="w-full max-w-2xl mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock size={14} className="text-gray-500" />
            <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Continue Where You Left Off
            </h2>
          </div>
          <div className="flex gap-3">
            {/* Recent Project */}
            {recentItems.recentProject && (
              <button
                onClick={() => onSelectProject(recentItems.recentProject.id)}
                className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                  recentItems.mostRecentType === 'project'
                    ? 'bg-purple-900/30 border-purple-500/50 hover:bg-purple-900/50'
                    : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                }`}
              >
                <div className={`p-2 rounded-lg ${
                  recentItems.mostRecentType === 'project' ? 'bg-purple-600/30' : 'bg-gray-700'
                }`}>
                  <FolderOpen size={18} className={
                    recentItems.mostRecentType === 'project' ? 'text-purple-400' : 'text-gray-400'
                  } />
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
                     recentItems.recentProject.clips_in_progress > 0 ? 'Editing' : 'Not Started'}
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-500 flex-shrink-0" />
              </button>
            )}

            {/* Recent Game */}
            {recentItems.recentGame && (
              <button
                onClick={() => onLoadGame(recentItems.recentGame.id)}
                className={`flex-1 flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                  recentItems.mostRecentType === 'game'
                    ? 'bg-green-900/30 border-green-500/50 hover:bg-green-900/50'
                    : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800'
                }`}
              >
                <div className={`p-2 rounded-lg ${
                  recentItems.mostRecentType === 'game' ? 'bg-green-600/30' : 'bg-gray-700'
                }`}>
                  <Gamepad2 size={18} className={
                    recentItems.mostRecentType === 'game' ? 'text-green-400' : 'text-gray-400'
                  } />
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
          </div>
        </div>
      )}

      {/* Tab Navigation - styled to match ModeSwitcher */}
      <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mb-6">
        <button
          onClick={() => setActiveTab('games')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all duration-200 ${
            activeTab === 'games'
              ? 'bg-green-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Gamepad2 size={16} />
          Games
          {games.length > 0 && (
            <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'games' ? 'bg-green-700' : 'bg-gray-700'
            }`}>
              {games.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`flex items-center gap-2 px-4 py-2 rounded-md font-medium text-sm transition-all duration-200 ${
            activeTab === 'projects'
              ? 'bg-purple-600 text-white shadow-lg'
              : 'text-gray-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <FolderOpen size={16} />
          Projects
          {projects.length > 0 && (
            <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
              activeTab === 'projects' ? 'bg-purple-700' : 'bg-gray-700'
            }`}>
              {projects.length}
            </span>
          )}
        </button>
      </div>

      {/* Action Button */}
      <div className="mb-8">
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
            variant="primary"
            size="lg"
            icon={Plus}
            onClick={() => setShowNewProjectModal(true)}
          >
            New Project
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
                ? 'Cannot connect to server. Is the backend running?'
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
                <h2 className="text-sm font-semibold text-green-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" />
                  Uploading
                </h2>
                <ActiveUploadCard
                  upload={activeUpload}
                  onClick={onClickActiveUpload}
                />
              </div>
            )}

            {/* Pending Uploads Section - Paused/interrupted uploads (exclude active upload) */}
            {(() => {
              // Filter out the currently uploading file from pending list to avoid duplication
              const filteredPending = activeUpload
                ? pendingUploads.filter(p => p.original_filename !== activeUpload.fileName)
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
                <div className="space-y-2">
                  {games.map(game => (
                    <GameCard
                      key={game.id}
                      game={game}
                      onLoad={() => onLoadGame(game.id)}
                      onDelete={() => onDeleteGame(game.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )
      ) : (
        /* Projects List */
        loading ? (
          <div className="text-gray-400">Loading projects...</div>
        ) : error ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 text-red-400 mb-3">
              <AlertTriangle size={20} />
              <span className="font-medium">Failed to load projects</span>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              {error.includes('fetch') || error.includes('network')
                ? 'Cannot connect to server. Is the backend running?'
                : error}
            </p>
            <p className="text-gray-600 text-xs">
              Make sure the backend server is running on port 8000
            </p>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-gray-500 text-center">
            <p className="mb-2">No projects yet</p>
            <p className="text-sm">Create a new project or add a game to get started</p>
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
                        { value: 'editing', label: 'Editing', color: 'blue' },
                        { value: 'exported', label: 'Exported', color: 'purple' },
                        { value: 'not_started', label: 'Not Started', color: 'gray' }
                      ].map(opt => {
                        const count = opt.value === 'all' ? filterCounts.all : filterCounts[opt.value];
                        if (count === 0 && opt.value !== 'all') return null;
                        return (
                          <button
                            key={opt.value}
                            onClick={() => setStatusFilter(opt.value)}
                            className={`px-2.5 py-1 text-xs rounded transition-colors ${
                              statusFilter === opt.value
                                ? opt.color === 'blue' ? 'bg-blue-600 text-white'
                                  : opt.color === 'gray' ? 'bg-gray-600 text-white'
                                  : 'bg-purple-600 text-white'
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
                            ? 'bg-purple-600 text-white'
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
                              ? 'bg-purple-600 text-white'
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
                            ? 'bg-purple-600 text-white'
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
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                        title="Manually created projects"
                      >
                        <Folder size={12} className={creationFilter === 'custom' ? 'text-white' : 'text-purple-400'} />
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
                  ? `Your Projects`
                  : `Showing ${filteredProjects.length} of ${projects.length} Projects`}
              </h2>
            </div>
            <div className="space-y-2">
              {filteredProjects.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  No projects match the current filters
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
                    />
                  ))}

                  {/* Grouped projects by game - expand if has incomplete projects */}
                  {groupedProjects.sortedKeys.map(groupKey => {
                    const group = groupedProjects.groups[groupKey];
                    const hasIncomplete = group.statusCounts.done < group.statusCounts.total;
                    return (
                    <CollapsibleGroup
                      key={groupKey}
                      title={groupKey}
                      count={group.projects.length}
                      statusCounts={group.statusCounts}
                      defaultExpanded={hasIncomplete}
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
      className="group relative p-4 bg-yellow-900/20 hover:bg-yellow-900/30 rounded-lg border border-yellow-600/50 hover:border-yellow-500 cursor-pointer transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileVideo size={18} className="text-yellow-400" />
            <h3 className="text-white font-medium truncate">{upload.original_filename}</h3>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
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
function ActiveUploadCard({ upload, onClick }) {
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
      className="group relative p-4 bg-green-900/20 hover:bg-green-900/30 rounded-lg border border-green-600/50 hover:border-green-500 cursor-pointer transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileVideo size={18} className="text-green-400" />
            <h3 className="text-white font-medium truncate">{upload.fileName}</h3>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            {upload.fileSize && <span>{formatSize(upload.fileSize)}</span>}
            {upload.fileSize && upload.message && <span>•</span>}
            <span>{upload.message || 'Uploading...'}</span>
          </div>

          {/* Progress bar */}
          <div className="mt-2 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-600 transition-all duration-300"
              style={{ width: `${upload.progress || 0}%` }}
            />
          </div>
          <div className="mt-1 text-xs text-gray-500 text-right">
            {upload.progress || 0}%
          </div>
        </div>

        <div className="flex items-center gap-2 ml-4">
          <Button
            variant="secondary"
            size="sm"
            icon={PlayCircle}
            onClick={(e) => { e.stopPropagation(); onClick?.(); }}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}


/**
 * GameCard - Individual game in the list
 */
function GameCard({ game, onLoad, onDelete }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleDelete = (e) => {
    e.stopPropagation();
    if (showDeleteConfirm) {
      onDelete();
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  return (
    <div
      onClick={onLoad}
      className="group relative p-4 bg-gray-800 hover:bg-gray-750 rounded-lg cursor-pointer border border-gray-700 hover:border-green-500 transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <Gamepad2 size={18} className="text-green-400" />
            <h3 className="text-white font-medium">{game.name}</h3>
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            <span>{game.clip_count} clip{game.clip_count !== 1 ? 's' : ''}</span>
            <span>•</span>
            <span>{new Date(game.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Load button */}
          <Button
            variant="success"
            size="sm"
            icon={PlayCircle}
            onClick={(e) => { e.stopPropagation(); onLoad(); }}
          >
            Load
          </Button>

          {/* Delete button */}
          <Button
            variant={showDeleteConfirm ? 'danger' : 'ghost'}
            size="sm"
            icon={Trash2}
            iconOnly
            onClick={handleDelete}
            className={!showDeleteConfirm ? 'opacity-0 group-hover:opacity-100' : ''}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete game'}
          />
        </div>
      </div>
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
 * - Green (✓): Done/Complete
 * - Yellow/Amber: Exporting (actively rendering)
 * - Blue (◐): Editing (has edits, not exported)
 * - Light Blue: Ready (for overlay - working video exists)
 * - Orange: Extracting (GPU extraction in progress)
 * - Gray (○): Not started / pending extraction
 *
 * Click handlers:
 * - onClipClick(clipIndex) - Called when a clip segment is clicked
 * - onOverlayClick() - Called when the overlay segment is clicked
 *
 * @param {Object} project - Project data
 * @param {string} isExporting - 'framing' | 'overlay' | null - Which stage is currently exporting
 */
function SegmentedProgressStrip({ project, onClipClick, onOverlayClick, isExporting = null }) {
  const {
    clip_count,
    clips_exported,
    clips_in_progress,
    clips_extracted = clip_count, // Default to all extracted for backwards compat
    clips_extracting = 0,
    clips_pending_extraction = 0,
    clips = [], // Clip details from backend
    has_working_video,
    has_overlay_edits,
    has_final_video
  } = project;

  // Calculate how many clips are in each extraction state
  const clipsNotExtracted = clip_count - clips_extracted;
  const isAnyExtracting = clips_extracting > 0 || clips_pending_extraction > 0;

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
    // Currently exporting - show single "Framing" segment as exporting
    clipSegments.push({ status: 'exporting', label: 'Framing', tags: [] });
  } else {
    // Framing not done - show per-clip progress for extraction/editing status
    for (let i = 0; i < clip_count; i++) {
      const clipInfo = clips[i];
      const clipName = getClipDisplayName(clipInfo, `Clip ${i + 1}`);
      const clipTags = clipInfo?.tags || [];
      const clipIsExtracted = clipInfo?.is_extracted !== false;
      const clipIsExtracting = clipInfo?.is_extracting || false;

      if (!clipIsExtracted) {
        // Clip still needs extraction
        if (clipIsExtracting) {
          clipSegments.push({ status: 'extracting', label: clipName, tags: clipTags });
        } else {
          clipSegments.push({ status: 'pending_extraction', label: clipName, tags: clipTags });
        }
      } else if (clips_in_progress > 0 && i < clips_in_progress) {
        // Clip has edits in progress
        clipSegments.push({ status: 'in_progress', label: clipName, tags: clipTags });
      } else {
        // Clip ready but not framed yet
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
    overlayStatus = 'exporting';
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
  const statusColors = {
    done: 'bg-green-500',
    exporting: 'bg-amber-500',
    in_progress: 'bg-blue-500',
    ready: 'bg-blue-300',
    extracting: 'bg-orange-500 animate-pulse',
    pending_extraction: 'bg-gray-600 border border-orange-500',
    pending: 'bg-gray-600'
  };

  // For many clips, use a compact view
  const isCompact = totalSegments > 10;

  return (
    <div className="mt-3">
      {/* Labels row */}
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span className="flex items-center gap-2">
          {isAnyExtracting ? (
            <span className="text-orange-400 flex items-center gap-1">
              <RefreshCw size={10} className="animate-spin" />
              Extracting ({clips_extracted}/{clip_count})
            </span>
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
        <span>Overlay</span>
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

          return (
            <div
              key={index}
              onClick={handleClick}
              className={`${statusColors[segment.status]} transition-all cursor-pointer hover:brightness-110 ${
                isLast ? 'rounded-r' : ''
              } ${index === 0 ? 'rounded-l' : ''}`}
              style={{
                flex: isLast ? '0 0 20%' : '1 1 0',
                minWidth: `${minWidth}px`
              }}
              title={`${segment.label}${segment.tags?.length ? ` [${segment.tags.join(', ')}]` : ''}: ${
                segment.status === 'done' ? 'Complete' :
                segment.status === 'exporting' ? 'Exporting...' :
                segment.status === 'in_progress' ? 'Editing' :
                segment.status === 'ready' ? 'Ready' :
                segment.status === 'extracting' ? 'Extracting...' :
                segment.status === 'pending_extraction' ? 'Waiting for extraction' :
                'Not Started'
              }${segment.status !== 'extracting' && segment.status !== 'pending_extraction' ? ' (click to open)' : ''}`}
            />
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
function ProjectCard({ project, onSelect, onSelectWithMode, onDelete, exportingProject = null }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  // Extraction status
  const clipsExtracted = project.clips_extracted ?? project.clip_count;
  const clipsExtracting = project.clips_extracting ?? 0;
  const clipsPendingExtraction = project.clips_pending_extraction ?? 0;
  const isAnyExtracting = clipsExtracting > 0 || clipsPendingExtraction > 0;
  const hasExtractedClips = clipsExtracted > 0;
  // Always allow opening projects - users should be able to see/edit clips while extraction runs
  // Backend tracks extraction state via modal_tasks and won't double-trigger
  const canOpen = true;

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
    if (!canOpen) return; // Block if no clips extracted
    onSelect();
  };

  const isComplete = project.has_final_video;

  return (
    <div
      onClick={handleCardClick}
      className={`group relative p-4 bg-gray-800 rounded-lg border transition-all ${
        canOpen
          ? 'hover:bg-gray-750 cursor-pointer border-gray-700 hover:border-purple-500'
          : 'cursor-not-allowed border-gray-700 opacity-75'
      }`}
      title={!canOpen ? 'Extraction in progress...' : undefined}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {project.is_auto_created && (
              <Star size={14} className="text-yellow-400 flex-shrink-0" fill="currentColor" title="Auto-created project" />
            )}
            <h3 className="text-white font-medium truncate">
              {getProjectDisplayName(project)}
            </h3>
            {isComplete && (
              <CheckCircle size={16} className="text-green-400 flex-shrink-0" />
            )}
          </div>
          {/* Tags row - show first clip's tags for auto-created projects */}
          {project.is_auto_created && project.clips?.[0]?.tags?.length > 0 && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {project.clips[0].tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs bg-purple-900/50 text-purple-300 rounded"
                >
                  <Tag size={10} />
                  {tag}
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            <span>{project.aspect_ratio}</span>
            <span>•</span>
            <span>{project.clip_count} clip{project.clip_count !== 1 ? 's' : ''}</span>
            {/* Only show status text for non-complete projects - complete is obvious from green bar */}
            {!project.has_final_video && (
              <>
                <span>•</span>
                <span>
                  {isAnyExtracting ? (
                    <span className="text-orange-400 flex items-center gap-1">
                      <RefreshCw size={12} className="animate-spin" />
                      Extracting ({clipsExtracted}/{project.clip_count})
                    </span>
                  ) :
                  isExporting === 'overlay' ? (
                    <span className="text-amber-400">Exporting...</span>
                  ) :
                  isExporting === 'framing' ? (
                    <span className="text-amber-400">Exporting...</span>
                  ) :
                  project.has_working_video ? 'In Overlay' :
                  project.clips_in_progress > 0 ? (
                    <span className="text-blue-400">Editing</span>
                  ) :
                  project.clips_exported > 0 ? 'Exported' : 'Not Started'}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Delete button */}
        <Button
          variant={showDeleteConfirm ? 'danger' : 'ghost'}
          size="sm"
          icon={Trash2}
          iconOnly
          onClick={handleDelete}
          className={!showDeleteConfirm ? 'opacity-0 group-hover:opacity-100' : ''}
          title={showDeleteConfirm ? 'Click again to confirm' : 'Delete project'}
        />
      </div>

      {/* Segmented progress strip - clickable segments for direct navigation */}
      <SegmentedProgressStrip
        project={project}
        onClipClick={handleClipClick}
        onOverlayClick={handleOverlayClick}
        isExporting={isExporting}
      />
    </div>
  );
}


export default ProjectManager;
