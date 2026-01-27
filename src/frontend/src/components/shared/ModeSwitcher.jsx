import React from 'react';
import { Crop, Sparkles, Scissors, Loader2 } from 'lucide-react';
import { useAppState } from '../../contexts';

/**
 * ModeSwitcher - Tab toggle for switching between editor modes.
 *
 * Visibility rules:
 * - When no project selected: Show nothing (or just Annotate badge if video loaded)
 * - When project selected: Show Framing and Overlay
 * - Overlay is available if working video OR overlay video exists
 * - Shows warning asterisk if framing has changed since last export
 * - Shows loading spinner if working video is being loaded
 *
 * @param {string} mode - Current mode ('annotate' | 'framing' | 'overlay')
 * @param {function} onModeChange - Callback when mode changes
 * @param {boolean} disabled - Whether the switcher is disabled
 * @param {boolean} hasProject - Whether a project is selected (optional, from context)
 * @param {boolean} hasWorkingVideo - Whether the project has a working video (optional, from context)
 * @param {boolean} hasOverlayVideo - Whether an overlay video is loaded (from export)
 * @param {boolean} framingOutOfSync - Whether framing has changed since last export
 * @param {boolean} hasAnnotateVideo - Whether an annotate video is loaded
 * @param {boolean} isLoadingWorkingVideo - Whether working video is currently loading
 */
export function ModeSwitcher({
  mode,
  onModeChange,
  disabled = false,
  hasProject: hasProjectProp,
  hasWorkingVideo: hasWorkingVideoProp,
  hasOverlayVideo = false,
  framingOutOfSync = false,
  hasAnnotateVideo = false,
  isLoadingWorkingVideo = false,
  inline = false,
}) {
  // Get project state from context
  const { selectedProject } = useAppState();

  // Use props if provided, otherwise derive from context
  const hasProject = hasProjectProp ?? !!selectedProject;
  const hasWorkingVideo = hasWorkingVideoProp ?? (selectedProject?.working_video_id != null);
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
      available: hasProject && (hasWorkingVideo || hasOverlayVideo),
      color: 'purple',
      showWarning: framingOutOfSync,
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

  const buttons = modes.map((modeOption) => {
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
          flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200 relative
          ${isActive
            ? `${activeColor} text-white shadow-lg`
            : isAvailable
              ? 'text-gray-400 hover:text-white hover:bg-white/10'
              : 'text-gray-600 cursor-not-allowed opacity-40'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={
          isLoadingWorkingVideo && modeOption.id === 'overlay'
            ? 'Loading working video...'
            : !isAvailable && modeOption.id === 'overlay'
              ? 'Export from Framing first to enable Overlay mode'
              : modeOption.showWarning
                ? 'Previously exported video no longer matches your settings. Export to create latest video before overlaying.'
                : modeOption.description
        }
      >
        {isLoadingWorkingVideo && modeOption.id === 'overlay' ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Icon size={16} />
        )}
        <span className="font-medium text-sm">{modeOption.label}</span>
        {modeOption.showWarning && isAvailable && (
          <span className="text-yellow-400 font-bold text-xs">*</span>
        )}
      </button>
    );
  });

  // When inline, return just the buttons (parent provides container)
  if (inline) {
    return <>{buttons}</>;
  }

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
      {buttons}
    </div>
  );
}

export default ModeSwitcher;
