import React, { useState, useEffect } from 'react';
import { FolderOpen, Plus, Trash2, Film, CheckCircle, Gamepad2, PlayCircle, Image } from 'lucide-react';

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
  onAnnotate,
  // Games props
  games = [],
  gamesLoading = false,
  onLoadGame,
  onDeleteGame,
  onFetchGames,
  // Downloads props
  downloadsCount = 0,
  onOpenDownloads,
  // Export state
  exportingProject = null, // { projectId, stage: 'framing' | 'overlay' } | null
}) {
  const [activeTab, setActiveTab] = useState('projects'); // 'games' | 'projects'
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  // Fetch games when switching to games tab
  useEffect(() => {
    if (activeTab === 'games' && onFetchGames) {
      onFetchGames();
    }
  }, [activeTab, onFetchGames]);

  const handleCreateProject = async (name, aspectRatio) => {
    await onCreateProject(name, aspectRatio);
    setShowNewProjectModal(false);
  };

  return (
    <div className="flex-1 flex flex-col items-center p-8 bg-gray-900">
      {/* Gallery button - fixed top right corner */}
      {onOpenDownloads && (
        <button
          onClick={onOpenDownloads}
          className="fixed top-4 right-4 z-30 flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-lg transition-colors"
          title="Gallery"
        >
          <Image size={18} className="text-purple-400" />
          <span className="text-sm text-gray-300">Gallery</span>
          {downloadsCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 bg-purple-600 text-white text-xs font-bold rounded-full min-w-[20px] text-center">
              {downloadsCount > 9 ? '9+' : downloadsCount}
            </span>
          )}
        </button>
      )}

      {/* Header */}
      <div className="text-center mb-6">
        <FolderOpen size={48} className="mx-auto mb-4 text-purple-400" />
        <h1 className="text-2xl font-bold text-white mb-2">Clipify</h1>
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
          <button
            onClick={onAnnotate}
            className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
          >
            <Plus size={20} />
            Add Game
          </button>
        ) : (
          <button
            onClick={() => setShowNewProjectModal(true)}
            className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
          >
            <Plus size={20} />
            New Project
          </button>
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
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">
              Your Projects
            </h2>
            <div className="space-y-2">
              {projects.map(project => (
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
          </div>
        )
      )}

      {/* New Project Modal */}
      {showNewProjectModal && (
        <NewProjectModal
          onClose={() => setShowNewProjectModal(false)}
          onCreate={handleCreateProject}
        />
      )}
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
          <button
            onClick={(e) => { e.stopPropagation(); onLoad(); }}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded transition-colors"
          >
            <PlayCircle size={14} />
            Load
          </button>

          {/* Delete button */}
          <button
            onClick={handleDelete}
            className={`p-2 rounded transition-colors ${
              showDeleteConfirm
                ? 'bg-red-600 text-white'
                : 'text-gray-500 hover:text-red-400 hover:bg-gray-700 opacity-0 group-hover:opacity-100'
            }`}
            title={showDeleteConfirm ? 'Click again to confirm' : 'Delete game'}
          >
            <Trash2 size={16} />
          </button>
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

      {/* Legend - only show if not compact */}
      {!isCompact && (
        <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-green-500"></span>
            Done
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-amber-500"></span>
            Exporting
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-blue-500"></span>
            Editing
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-blue-300"></span>
            Ready
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm bg-gray-600"></span>
            Not Started
          </span>
        </div>
      )}
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

  // Determine if this project is currently exporting
  const isExporting = exportingProject?.projectId === project.id ? exportingProject.stage : null;

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
            <h3 className="text-white font-medium">{project.name}</h3>
            {isComplete && (
              <CheckCircle size={16} className="text-green-400" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-gray-400">
            <span>{project.aspect_ratio}</span>
            <span>•</span>
            <span>{project.clip_count} clip{project.clip_count !== 1 ? 's' : ''}</span>
            <span>•</span>
            <span>
              {project.has_final_video ? 'Complete' :
               project.has_working_video ? 'In Overlay' :
               project.clips_in_progress > 0 ? (
                 <span className="text-blue-400">Editing</span>
               ) :
               project.clips_exported > 0 ? 'Exported' : 'Not Started'}
            </span>
          </div>
        </div>

        {/* Delete button */}
        <button
          onClick={handleDelete}
          className={`p-2 rounded transition-colors ${
            showDeleteConfirm
              ? 'bg-red-600 text-white'
              : 'text-gray-500 hover:text-red-400 hover:bg-gray-700 opacity-0 group-hover:opacity-100'
          }`}
          title={showDeleteConfirm ? 'Click again to confirm' : 'Delete project'}
        >
          <Trash2 size={16} />
        </button>
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


/**
 * NewProjectModal - Create a new project
 */
function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [creating, setCreating] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    await onCreate(name.trim(), aspectRatio);
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 className="text-xl font-bold text-white mb-4">New Project</h2>

        <form onSubmit={handleSubmit}>
          {/* Name input */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-2">
              Project Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Highlight Reel"
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
              autoFocus
            />
          </div>

          {/* Aspect ratio selector */}
          <div className="mb-6">
            <label className="block text-sm text-gray-400 mb-2">
              Aspect Ratio
            </label>
            <div className="flex gap-3">
              {[
                { value: '16:9', label: '16:9', desc: 'Landscape (YouTube)' },
                { value: '9:16', label: '9:16', desc: 'Portrait (TikTok/Reels)' },
                { value: '1:1', label: '1:1', desc: 'Square (Instagram)' },
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setAspectRatio(option.value)}
                  className={`flex-1 p-3 rounded-lg border transition-colors ${
                    aspectRatio === option.value
                      ? 'bg-purple-600 border-purple-500 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <div className="font-medium">{option.label}</div>
                  <div className="text-xs opacity-70">{option.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || creating}
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
            >
              {creating ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


export default ProjectManager;
