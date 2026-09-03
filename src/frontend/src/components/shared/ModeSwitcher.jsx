import { Crop, Sparkles, Scissors, Loader2 } from 'lucide-react';
import { useAppState } from '../../contexts';
import { GAME, REEL } from '../../config/themeColors';
import { SCREENS } from '../../stores/editorStore';
import { toast } from './Toast';

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
  // Define mode configurations
  const modes = [
    {
      id: 'annotate',
      label: SCREENS.ANNOTATE.label,
      icon: Scissors,
      description: 'Clip extraction',
      available: hasAnnotateVideo || mode === 'annotate',
      color: 'game',
    },
    {
      id: 'framing',
      label: SCREENS.FRAMING.label,
      icon: Crop,
      description: 'Crop, trim & speed',
      available: hasProject,
      color: 'reel',
    },
    {
      id: 'overlay',
      label: SCREENS.OVERLAY.label,
      icon: Sparkles,
      description: 'Highlights & effects',
      available: hasProject && (hasWorkingVideo || hasOverlayVideo),
      color: 'reel',
      showWarning: framingOutOfSync,
    },
  ];

  // If no project and not in annotate mode, don't show the mode switcher
  if (!hasProject && !(mode === 'annotate' && hasAnnotateVideo)) {
    return null;
  }

  const buttons = modes.map((modeOption) => {
    const Icon = modeOption.icon;
    const isActive = mode === modeOption.id;
    const isAvailable = modeOption.available;

    const activeColor = {
      game: GAME.bg,
      reel: REEL.bg,
    }[modeOption.color] || REEL.bg;

    const titleText =
      isLoadingWorkingVideo && modeOption.id === 'overlay'
        ? 'Loading working video...'
        : !isAvailable && modeOption.id === 'framing'
          ? 'Select a reel first'
          : !isAvailable && modeOption.id === 'overlay'
            ? hasProject ? 'Export from Focus first to enable Overlay mode' : 'Select a reel first'
            : modeOption.showWarning
              ? 'Previously exported video no longer matches your settings. Export to create latest video before overlaying.'
              : modeOption.description;

    return (
      <button
        key={modeOption.id}
        data-testid={`mode-${modeOption.id}`}
        onClick={() => {
          if (disabled) return;
          if (!isAvailable) {
            // T8480: a locked tab must explain itself on tap, not just on hover
            // (native title is unreachable on touch). aria-disabled instead of
            // the disabled attribute below, or this click never fires.
            toast.info(titleText, { dedupKey: 'mode-locked' });
            return;
          }
          onModeChange(modeOption.id);
        }}
        disabled={disabled}
        aria-disabled={disabled || !isAvailable}
        className={`
          flex items-center gap-2 px-2 sm:px-4 py-2 rounded-md transition-all duration-200 relative
          ${isActive
            ? `${activeColor} text-white shadow-lg`
            : isAvailable
              ? 'text-white/70 hover:text-white hover:bg-white/10'
              : 'text-white/30 cursor-not-allowed'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={titleText}
      >
        {isLoadingWorkingVideo && modeOption.id === 'overlay' ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <Icon size={16} />
        )}
        <span className="font-medium text-sm hidden sm:inline">{modeOption.label}</span>
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
