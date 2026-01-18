import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { FolderOpen, Plus, Trash2, Film, CheckCircle, Gamepad2, PlayCircle, Image, Filter, Star, Folder } from 'lucide-react';
import { useAppState } from '../contexts';
import { useExportStore } from '../stores/exportStore';
import { GameClipSelectorModal } from './GameClipSelectorModal';
import { Button } from './shared/Button';

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
  onSelectProject,
  onSelectProjectWithMode, // (projectId, options) => void - options: { mode: 'framing'|'overlay', clipIndex?: number }
  onCreateProject,
  onDeleteProject,
  onAnnotateWithFile, // (file: File) => void - Navigate to annotate mode with file
  // Games props
  games = [],
  gamesLoading = false,
  onLoadGame,
  onDeleteGame,
  onFetchGames,
  // Downloads props - now optional, from context
  downloadsCount: downloadsCountProp,
  onOpenDownloads,
  // Export state - now optional, from context
  exportingProject: exportingProjectProp,
}) {
  // Get downloads and export state from context
  const { downloadsCount: contextDownloadsCount, exportingProject: contextExportingProject } = useAppState();

  // Use props if provided, otherwise fall back to context
  const downloadsCount = downloadsCountProp ?? contextDownloadsCount ?? 0;
  const exportingProject = exportingProjectProp ?? contextExportingProject;
  const [activeTab, setActiveTab] = useState('projects'); // 'games' | 'projects'
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const gameFileInputRef = useRef(null);

  // Project filter state
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'complete' | 'overlay' | 'editing' | 'not_started'
  const [aspectFilter, setAspectFilter] = useState('all'); // 'all' | '9:16' | '16:9' | '1:1' | '4:5'
  const [creationFilter, setCreationFilter] = useState('all'); // 'all' | 'auto' | 'custom'

  // Filter projects based on selected filters
  const filteredProjects = useMemo(() => {
    return projects.filter(project => {
      // Status filter - matches counting logic
      if (statusFilter !== 'all') {
        const isComplete = project.has_final_video;
        const isInOverlay = !isComplete && project.has_working_video;
        const isEditing = !isComplete && !isInOverlay && project.clips_in_progress > 0;
        const isExported = !isComplete && !isInOverlay && !isEditing && project.clips_exported > 0;
        const isNotStarted = !isComplete && !isInOverlay && !isEditing && !isExported;

        if (statusFilter === 'complete' && !isComplete) return false;
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
      complete: 0,
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
      if (project.has_final_video) {
        counts.complete++;
      } else if (project.has_working_video) {
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
    const statusValuesWithProjects = [counts.complete, counts.overlay, counts.editing, counts.exported, counts.not_started].filter(v => v > 0).length;
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

  // Compute which progress statuses are present across all projects (for shared legend)
  const progressStatuses = useMemo(() => {
    const statuses = { done: false, exporting: false, editing: false, ready: false, pending: false };

    projects.forEach(project => {
      const { clip_count, clips_exported, clips_in_progress, has_working_video, has_overlay_edits, has_final_video } = project;

      // Check clip segments
      for (let i = 0; i < clip_count; i++) {
        if (has_final_video || i < clips_exported) {
          statuses.done = true;
        } else if (i < clips_exported + clips_in_progress) {
          statuses.editing = true;
        } else {
          statuses.pending = true;
        }
      }

      // Check overlay segment
      if (has_final_video) {
        statuses.done = true;
      } else if (has_overlay_edits) {
        statuses.editing = true;
      } else if (has_working_video) {
        statuses.ready = true;
      } else {
        statuses.pending = true;
      }
    });

    return statuses;
  }, [projects]);

  // Handle file selection for new game
  const handleGameFileChange = useCallback((event) => {
    const file = event.target.files?.[0];
    if (file && onAnnotateWithFile) {
      onAnnotateWithFile(file);
    }
    // Reset input so same file can be selected again
    event.target.value = '';
  }, [onAnnotateWithFile]);

  // Trigger file picker for new game
  const handleAddGameClick = useCallback(() => {
    gameFileInputRef.current?.click();
  }, []);

  // Fetch games when switching to games tab or when opening modal
  useEffect(() => {
    if ((activeTab === 'games' || showNewProjectModal) && onFetchGames) {
      onFetchGames();
    }
  }, [activeTab, showNewProjectModal, onFetchGames]);

  // Handle project creation from the new modal
  const handleProjectCreated = useCallback(async (project) => {
    // Refresh projects list to show the new project
    // The modal already created the project via API
    if (onCreateProject) {
      // Just refresh the list - project was already created
      // Call with null to trigger a refresh without creating
    }
    setShowNewProjectModal(false);
    // Select the new project to start editing
    if (project?.id && onSelectProject) {
      onSelectProject(project.id);
    }
  }, [onSelectProject]);

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
        <FolderOpen size={48} className="mx-auto mb-4 text-purple-400" />
        <h1 className="text-2xl font-bold text-white mb-2">Reel Ballers</h1>
        <p className="text-gray-400">Manage your games and projects</p>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1">
        <button
          onClick={() => setActiveTab('games')}
          className={`flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'games'
              ? 'bg-green-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <Gamepad2 size={18} />
          Games
          {games.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-gray-700 rounded-full">
              {games.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('projects')}
          className={`flex items-center gap-2 px-6 py-2 rounded-md font-medium transition-colors ${
            activeTab === 'projects'
              ? 'bg-purple-600 text-white'
              : 'text-gray-400 hover:text-white hover:bg-gray-700'
          }`}
        >
          <FolderOpen size={18} />
          Projects
          {projects.length > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs bg-gray-700 rounded-full">
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
        ) : games.length === 0 ? (
          <div className="text-gray-500 text-center">
            <p className="mb-2">No games yet</p>
            <p className="text-sm">Add a game to annotate your footage</p>
          </div>
        ) : (
          <div className="w-full max-w-2xl">
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
          </div>
        )
      ) : (
        /* Projects List */
        loading ? (
          <div className="text-gray-400">Loading projects...</div>
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
                        { value: 'complete', label: 'Complete', color: 'green' },
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
                                ? opt.color === 'green' ? 'bg-green-600 text-white'
                                  : opt.color === 'blue' ? 'bg-blue-600 text-white'
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
                        Brilliant ({filterCounts.auto})
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
              {/* Shared progress legend - only show statuses that exist */}
              <div className="flex gap-3 text-xs text-gray-500">
                {progressStatuses.done && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-green-500"></span>
                    Done
                  </span>
                )}
                {progressStatuses.exporting && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-amber-500"></span>
                    Exporting
                  </span>
                )}
                {progressStatuses.editing && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-blue-500"></span>
                    Editing
                  </span>
                )}
                {progressStatuses.ready && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-blue-300"></span>
                    Ready
                  </span>
                )}
                {progressStatuses.pending && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-sm bg-gray-600"></span>
                    Not Started
                  </span>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {filteredProjects.length === 0 ? (
                <div className="text-gray-500 text-center py-4">
                  No projects match the current filters
                </div>
              ) : (
                filteredProjects.map(project => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onSelect={() => onSelectProject(project.id)}
                    onSelectWithMode={(options) => onSelectProjectWithMode?.(project.id, options)}
                    onDelete={() => onDeleteProject(project.id)}
                    exportingProject={exportingProject}
                  />
                ))
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
 * - Gray (○): Not started
 *
 * Click handlers:
 * - onClipClick(clipIndex) - Called when a clip segment is clicked
 * - onOverlayClick() - Called when the overlay segment is clicked
 *
 * @param {Object} project - Project data
 * @param {string} isExporting - 'framing' | 'overlay' | null - Which stage is currently exporting
 */
function SegmentedProgressStrip({ project, onClipClick, onOverlayClick, isExporting = null }) {
  const { clip_count, clips_exported, clips_in_progress, has_working_video, has_overlay_edits, has_final_video } = project;

  // Total segments = clips + 1 for overlay stage
  const totalSegments = Math.max(clip_count, 1) + 1;

  // Build segment data
  // If final video exists, entire bar is green (complete)
  // Otherwise:
  // - Green: exported (included in working video)
  // - Yellow: exporting (actively rendering)
  // - Blue: editing (has edits but not exported)
  // - Gray: not started
  const clipSegments = [];
  for (let i = 0; i < clip_count; i++) {
    if (has_final_video || i < clips_exported) {
      clipSegments.push({ status: 'done', label: `Clip ${i + 1}` });
    } else if (isExporting === 'framing') {
      // When framing export is running, all non-exported clips show as exporting
      clipSegments.push({ status: 'exporting', label: `Clip ${i + 1}` });
    } else if (i < clips_exported + clips_in_progress) {
      clipSegments.push({ status: 'in_progress', label: `Clip ${i + 1}` });
    } else {
      clipSegments.push({ status: 'pending', label: `Clip ${i + 1}` });
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

  // Calculate segment width - minimum 4px, flex to fill space
  const minWidth = 4;
  const gapWidth = 2;

  // Status to color mapping
  const statusColors = {
    done: 'bg-green-500',
    exporting: 'bg-amber-500',
    in_progress: 'bg-blue-500',
    ready: 'bg-blue-300',
    pending: 'bg-gray-600'
  };

  // For many clips, use a compact view
  const isCompact = totalSegments > 10;

  return (
    <div className="mt-3">
      {/* Labels row */}
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span className="flex items-center gap-2">
          <span>Framing</span>
          <span className="text-gray-600">({clips_exported}/{clip_count} exported)</span>
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
              title={`${segment.label}: ${
                segment.status === 'done' ? 'Complete' :
                segment.status === 'exporting' ? 'Exporting...' :
                segment.status === 'in_progress' ? 'Editing' :
                segment.status === 'ready' ? 'Ready' :
                'Not Started'
              } (click to open)`}
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
    if (onSelectWithMode) {
      onSelectWithMode({ mode: 'framing', clipIndex });
    }
  };

  const handleOverlayClick = () => {
    if (onSelectWithMode) {
      onSelectWithMode({ mode: 'overlay' });
    }
  };

  const isComplete = project.has_final_video;

  return (
    <div
      onClick={onSelect}
      className="group relative p-4 bg-gray-800 hover:bg-gray-750 rounded-lg cursor-pointer border border-gray-700 hover:border-purple-500 transition-all"
    >
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {project.is_auto_created && (
              <Star size={14} className="text-yellow-400" fill="currentColor" title="Brilliant clip project" />
            )}
            <h3 className="text-white font-medium">{project.name}</h3>
            {isComplete && (
              <CheckCircle size={16} className="text-green-400" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            <span>{project.aspect_ratio}</span>
            <span>•</span>
            <span>{project.clip_count} clip{project.clip_count !== 1 ? 's' : ''}</span>
            {/* Only show status text for non-complete projects - complete is obvious from green bar */}
            {!project.has_final_video && (
              <>
                <span>•</span>
                <span>
                  {isExporting === 'overlay' ? (
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
