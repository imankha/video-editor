import React from 'react';
import { Crop, Sparkles, Scissors } from 'lucide-react';

/**
 * ModeSwitcher - Tab toggle for switching between editor modes.
 *
 * Visibility rules:
 * - When no project selected: Show nothing (or just Annotate badge if video loaded)
 * - When project selected: Show Framing and Overlay
 * - Overlay is disabled until working_video exists
 *
 * @param {string} mode - Current mode ('annotate' | 'framing' | 'overlay')
 * @param {function} onModeChange - Callback when mode changes
 * @param {boolean} disabled - Whether the switcher is disabled
 * @param {boolean} hasProject - Whether a project is selected
 * @param {boolean} hasWorkingVideo - Whether the project has a working video
 * @param {boolean} hasAnnotateVideo - Whether an annotate video is loaded
 */
export function ModeSwitcher({
  mode,
  onModeChange,
  disabled = false,
  hasProject = false,
  hasWorkingVideo = false,
  hasAnnotateVideo = false,
}) {
  // Define mode configurations for project mode
  const modes = [
    {
      id: 'framing',
      label: 'Framing',
      icon: Crop,
      description: 'Crop, trim & speed',
      available: hasProject,
      color: 'blue',
    },
    {
      id: 'overlay',
      label: 'Overlay',
      icon: Sparkles,
      description: 'Highlights & effects',
      available: hasProject && hasWorkingVideo,
      color: 'purple',
    },
  ];

  // If no project, don't show the mode switcher
  // (Annotate is accessed via the Annotate button in Project Manager)
  if (!hasProject) {
    // If in annotate mode with a video, show a simple indicator
    if (mode === 'annotate' && hasAnnotateVideo) {
      return (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-600 rounded-lg">
          <Scissors size={16} />
          <span className="font-medium text-sm text-white">Annotate Mode</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
      {modes.map((modeOption) => {
        const Icon = modeOption.icon;
        const isActive = mode === modeOption.id;
        const isAvailable = modeOption.available;

        const activeColor = {
          blue: 'bg-blue-600',
          purple: 'bg-purple-600',
        }[modeOption.color] || 'bg-purple-600';

        return (
          <button
            key={modeOption.id}
            onClick={() => !disabled && isAvailable && onModeChange(modeOption.id)}
            disabled={disabled || !isAvailable}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200
              ${isActive
                ? `${activeColor} text-white shadow-lg`
                : isAvailable
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-600 cursor-not-allowed'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            title={
              !isAvailable && modeOption.id === 'overlay'
                ? 'Export from Framing first to enable Overlay mode'
                : modeOption.description
            }
          >
            <Icon size={16} />
            <span className="font-medium text-sm">{modeOption.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ModeSwitcher;
