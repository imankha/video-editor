# Task 05: Frontend Project UI Components

## Objective
Create the Project Manager view and New Project modal for when no project is selected.

## Dependencies
- Task 04 (frontend hooks)

## Files to Create

### 1. `src/frontend/src/components/ProjectManager.jsx`

```javascript
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
 * ProjectCard - Individual project in the list
 */
function ProjectCard({ project, onSelect, onDelete }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const isComplete = project.progress_percent >= 100;

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
          <span>{Math.round(project.progress_percent)}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${
              isComplete ? 'bg-green-500' : 'bg-purple-500'
            }`}
            style={{ width: `${project.progress_percent}%` }}
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
```

### 2. `src/frontend/src/components/ProjectHeader.jsx`

```javascript
import React, { useState } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';

/**
 * ProjectHeader - Shows selected project name with dropdown to switch
 */
export function ProjectHeader({
  selectedProject,
  projects,
  onSelectProject,
  onBackToManager
}) {
  const [showDropdown, setShowDropdown] = useState(false);

  if (!selectedProject) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg border border-gray-700 transition-colors"
      >
        <FolderOpen size={16} className="text-purple-400" />
        <span className="text-white font-medium">{selectedProject.name}</span>
        <span className="text-gray-500 text-sm">({selectedProject.aspect_ratio})</span>
        <ChevronDown size={16} className="text-gray-400" />
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowDropdown(false)}
          />

          {/* Menu */}
          <div className="absolute top-full left-0 mt-1 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
            {/* Other projects */}
            {projects
              .filter(p => p.id !== selectedProject.id)
              .map(project => (
                <button
                  key={project.id}
                  onClick={() => {
                    onSelectProject(project.id);
                    setShowDropdown(false);
                  }}
                  className="w-full px-4 py-2 text-left hover:bg-gray-700 transition-colors"
                >
                  <div className="text-white">{project.name}</div>
                  <div className="text-xs text-gray-500">
                    {project.aspect_ratio} • {project.clip_count} clips
                  </div>
                </button>
              ))}

            {/* Divider */}
            <div className="border-t border-gray-700 my-1" />

            {/* Back to manager */}
            <button
              onClick={() => {
                onBackToManager();
                setShowDropdown(false);
              }}
              className="w-full px-4 py-2 text-left text-purple-400 hover:bg-gray-700 transition-colors"
            >
              ← Back to Project Manager
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ProjectHeader;
```

## Testing Steps

### 1. Prepare - Create Some Projects via API

```bash
# Create a few test projects
curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Game Highlights", "aspect_ratio": "16:9"}'

curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "TikTok Clips", "aspect_ratio": "9:16"}'

curl -X POST http://localhost:8000/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "Instagram Square", "aspect_ratio": "1:1"}'
```

### 2. Temporarily Integrate Components

Add to App.jsx temporarily for testing:

```javascript
import { ProjectManager } from './components/ProjectManager';
import { ProjectHeader } from './components/ProjectHeader';
import { useProjects } from './hooks/useProjects';

// In App function:
const {
  projects,
  selectedProject,
  loading,
  selectProject,
  createProject,
  deleteProject,
  clearSelection
} = useProjects();

// At the start of the return, before the main content:
if (!selectedProject) {
  return (
    <ProjectManager
      projects={projects}
      loading={loading}
      onSelectProject={selectProject}
      onCreateProject={createProject}
      onDeleteProject={deleteProject}
      onAnnotate={() => console.log('Annotate clicked')}
    />
  );
}
```

### 3. Test Project Manager View

1. **Load the app** - Should show Project Manager with 3 projects
2. **Verify project cards display correctly:**
   - Name, aspect ratio, clip count
   - Progress bar (should be at 0%)
   - Status shows "Not Started"
3. **Hover over project card** - Delete button should appear
4. **Click delete button once** - Should turn red (confirm state)
5. **Wait 3 seconds** - Should return to normal
6. **Click delete twice quickly** - Should delete the project

### 4. Test New Project Modal

1. **Click "New Project" button** - Modal should appear
2. **Verify modal contents:**
   - Name input with placeholder
   - Three aspect ratio buttons
   - Cancel and Create buttons
3. **Try to create without name** - Button should be disabled
4. **Enter a name** - Button should enable
5. **Select different aspect ratios** - Should highlight selected
6. **Click Create** - Modal should close, new project appears in list
7. **Click Cancel** - Modal should close without creating

### 5. Test Project Selection

1. **Click on a project card** - Should select it
2. **Verify selection works** (check console or state)

### 6. Test Project Header (add to test)

When a project is selected, add ProjectHeader to verify:

1. **Shows project name and aspect ratio**
2. **Clicking opens dropdown**
3. **Lists other projects**
4. **"Back to Project Manager" option works**

### 7. Clean Up

Remove temporary test code from App.jsx.

## Success Criteria

- [ ] ProjectManager displays when no project selected
- [ ] Projects list shows name, aspect ratio, clip count, progress
- [ ] Progress bar displays correctly
- [ ] "New Project" button opens modal
- [ ] Modal validates name input (required)
- [ ] Modal aspect ratio selection works
- [ ] Creating project adds it to list
- [ ] Clicking project selects it
- [ ] Delete confirmation works (two-click)
- [ ] ProjectHeader shows selected project
- [ ] ProjectHeader dropdown allows switching projects
- [ ] "Back to Project Manager" deselects project
