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
