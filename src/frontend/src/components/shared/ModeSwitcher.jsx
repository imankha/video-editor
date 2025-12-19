import React from 'react';
import { Crop, Sparkles, Scissors } from 'lucide-react';

/**
 * ModeSwitcher - Tab toggle for switching between editor modes.
 *
 * Modes:
 * - Annotate: Extract clips from full game footage
 * - Framing: Crop, trim, and speed editing
 * - Overlay: Highlight and effect overlays
 *
 * @param {string} mode - Current mode ('annotate' | 'framing' | 'overlay')
 * @param {function} onModeChange - Callback when mode changes
 * @param {boolean} disabled - Whether the switcher is disabled
 * @param {boolean} hasAnnotateVideo - Whether an annotate video is loaded
 * @param {boolean} hasFramingVideo - Whether a framing video is loaded
 */
export function ModeSwitcher({
  mode,
  onModeChange,
  disabled = false,
  hasAnnotateVideo = false,
  hasFramingVideo = false,
}) {
  const modes = [
    {
      id: 'annotate',
      label: 'Annotate',
      icon: Scissors,
      description: 'Extract clips from game',
      available: hasAnnotateVideo,
      color: 'green',
    },
    {
      id: 'framing',
      label: 'Framing',
      icon: Crop,
      description: 'Crop, trim & speed',
      available: hasFramingVideo,
      color: 'blue',
    },
    {
      id: 'overlay',
      label: 'Overlay',
      icon: Sparkles,
      description: 'Highlights & effects',
      available: hasFramingVideo,
      color: 'purple',
    },
  ];

  // Only show modes that have content OR the current mode
  const visibleModes = modes.filter(m => m.available || m.id === mode);

  // If no modes are visible, show all modes but disabled
  const displayModes = visibleModes.length > 0 ? visibleModes : modes;

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
      {displayModes.map((modeOption) => {
        const Icon = modeOption.icon;
        const isActive = mode === modeOption.id;
        const isAvailable = modeOption.available;

        // Get the appropriate color for active state
        const activeColor = {
          green: 'bg-green-600',
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
            title={isAvailable ? modeOption.description : `${modeOption.label} - Load a video first`}
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
