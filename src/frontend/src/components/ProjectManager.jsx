import React, { useState } from 'react';
import { FolderOpen, Plus, Trash2, Film, CheckCircle } from 'lucide-react';

/**
 * ProjectManager - Shown when no project is selected
 *
 * Displays:
 * - List of existing projects with progress bars
 * - Button to create new project
 * - Button to enter Annotate mode
 */
export function ProjectManager({
  projects,
  loading,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onAnnotate
}) {
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);

  const handleCreateProject = async (name, aspectRatio) => {
    await onCreateProject(name, aspectRatio);
    setShowNewProjectModal(false);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-900">
      {/* Header */}
      <div className="text-center mb-8">
        <FolderOpen size={48} className="mx-auto mb-4 text-purple-400" />
        <h1 className="text-2xl font-bold text-white mb-2">Project Manager</h1>
        <p className="text-gray-400">Select a project or create a new one</p>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-4 mb-8">
        <button
          onClick={() => setShowNewProjectModal(true)}
          className="flex items-center gap-2 px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors"
        >
          <Plus size={20} />
          New Project
        </button>
        <button
          onClick={onAnnotate}
          className="flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
        >
          <Film size={20} />
          Annotate Game
        </button>
      </div>

      {/* Projects List */}
      {loading ? (
        <div className="text-gray-400">Loading projects...</div>
      ) : projects.length === 0 ? (
        <div className="text-gray-500 text-center">
          <p className="mb-2">No projects yet</p>
          <p className="text-sm">Create a new project or annotate a game to get started</p>
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
                onDelete={() => onDeleteProject(project.id)}
              />
            ))}
          </div>
        </div>
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
 * Calculate project progress percentage (derived, not from API)
 */
function calculateProgress(project) {
  if (project.clip_count === 0) return 0;
  const total = project.clip_count + 1;
  const completed = project.clips_framed + (project.has_final_video ? 1 : 0);
  return Math.round((completed / total) * 100 * 10) / 10;
}

/**
 * ProjectCard - Individual project in the list
 */
function ProjectCard({ project, onSelect, onDelete }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const progressPercent = calculateProgress(project);

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

  const isComplete = progressPercent >= 100;

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
               project.has_working_video ? 'Framed' :
               project.clips_framed > 0 ? 'In Progress' : 'Not Started'}
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

      {/* Progress bar */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              isComplete ? 'bg-green-500' : 'bg-purple-500'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
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
