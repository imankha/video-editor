import React from 'react';
import { Crop, Sparkles } from 'lucide-react';

/**
 * ModeSwitcher - Two-tab toggle for switching between Framing and Overlay modes.
 *
 * Framing Mode: Crop, trim, and speed editing
 * Overlay Mode: Highlight and effect overlays
 *
 * @param {string} mode - Current mode ('framing' | 'overlay')
 * @param {function} onModeChange - Callback when mode changes
 * @param {boolean} disabled - Whether the switcher is disabled (e.g., no video loaded)
 */
export function ModeSwitcher({ mode, onModeChange, disabled = false }) {
  const modes = [
    {
      id: 'framing',
      label: 'Framing',
      icon: Crop,
      description: 'Crop, trim & speed',
    },
    {
      id: 'overlay',
      label: 'Overlay',
      icon: Sparkles,
      description: 'Highlights & effects',
    },
  ];

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
      {modes.map((modeOption) => {
        const Icon = modeOption.icon;
        const isActive = mode === modeOption.id;

        return (
          <button
            key={modeOption.id}
            onClick={() => !disabled && onModeChange(modeOption.id)}
            disabled={disabled}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200
              ${isActive
                ? 'bg-purple-600 text-white shadow-lg'
                : 'text-gray-400 hover:text-white hover:bg-white/10'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
            title={modeOption.description}
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
