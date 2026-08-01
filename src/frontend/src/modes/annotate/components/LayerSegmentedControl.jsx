import React from 'react';
import { User, Users } from 'lucide-react';

/**
 * LayerSegmentedControl - Two-value My Athlete | Team segmented control.
 *
 * Shared by the mode toggle (ClipsSidePanel header), the desktop per-clip
 * control (ClipDetailsEditor), and the mobile per-clip control
 * (AnnotateFullscreenOverlay) — the one-layer-per-clip model (T5700).
 *
 * value: true/null/undefined => My Athlete (matches the `my_athlete ?? true`
 * legacy-NULL rule); false => Team. onChange receives the next boolean.
 */
export function LayerSegmentedControl({
  value,
  onChange,
  size = 'md',
  className = '',
  disabled = false,
  disabledReason = '',
  ariaLabel = 'Clip layer',
}) {
  const isMine = value !== false;
  const seg = 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md ' +
    'text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900 ' +
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none';
  const pad = size === 'sm'
    ? 'px-2.5 py-1 coarse-pointer:min-h-[44px]'
    : 'px-3 py-1.5 coarse-pointer:min-h-[44px]';

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      title={disabled ? disabledReason : undefined}
      className={`flex gap-1 p-0.5 bg-gray-800 border border-gray-700 rounded-lg ${className}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={isMine}
        aria-label={disabled ? `My Athlete layer — ${disabledReason}` : 'My Athlete layer'}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => onChange(true)}
        className={`${seg} ${pad} focus-visible:ring-cyan-400 ${
          isMine
            ? 'bg-cyan-600 text-white shadow-sm'
            : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
        }`}
      >
        <User size={14} /> My Athlete
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={!isMine}
        aria-label={disabled ? `Team layer — ${disabledReason}` : 'Team layer'}
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => onChange(false)}
        className={`${seg} ${pad} focus-visible:ring-amber-400 ${
          !isMine
            ? 'bg-amber-600 text-white shadow-sm'
            : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
        }`}
      >
        <Users size={14} /> Team
      </button>
    </div>
  );
}

export default LayerSegmentedControl;
