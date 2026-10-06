import { Crop, Sparkles, Scissors, Loader2, Lock } from 'lucide-react';
import { useAppState } from '../../contexts';
import { GAME, REEL } from '../../config/themeColors';
import { toast } from './Toast';
import { allowEnterFraming } from '../../utils/reelReEditable';
import { ANNOTATE, MODE_SWITCHER_NAMES } from '../../config/displayNames';

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
 * @param {boolean} isLoadingGameData - T11830: Annotate /load in flight; locked tabs show a spinner, not a lock
 */
export function ModeSwitcher({
  mode,
  onModeChange,
  disabled = false,
  hasProject: hasProjectProp,
  hasSelectedPlay = true,
  hasWorkingVideo: hasWorkingVideoProp,
  project: projectProp,
  hasOverlayVideo = false,
  framingOutOfSync = false,
  hasAnnotateVideo = false,
  isLoadingWorkingVideo = false,
  isLoadingGameData = false,
  inline = false,
}) {
  // Get project state from context
  const { selectedProject } = useAppState();

  // Use props if provided, otherwise derive from context
  const modeProject = projectProp ?? selectedProject;
  const hasProject = hasProjectProp ?? !!modeProject;
  const hasWorkingVideo = hasWorkingVideoProp
    ?? (modeProject?.has_working_video ?? (modeProject?.working_video_id != null));
  // Define mode configurations
  const modes = [
    {
      id: 'annotate',
      label: MODE_SWITCHER_NAMES.ANNOTATE,
      icon: Scissors,
      description: ANNOTATE.MODE_DESCRIPTION,
      available: hasAnnotateVideo || mode === 'annotate',
      color: 'game',
    },
    {
      id: 'framing',
      label: MODE_SWITCHER_NAMES.FRAMING,
      icon: Crop,
      description: 'Reframe, trim & speed',
      available: hasProject,
      color: 'reel',
    },
    {
      id: 'overlay',
      label: MODE_SWITCHER_NAMES.SPOTLIGHT,
      icon: Sparkles,
      description: 'Spotlight, text & cover',
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

    // T11830: a tab that is only locked because the plays have not arrived yet.
    const isLockedWhileLoading = isLoadingGameData && !isAvailable;

    const titleText =
      isLockedWhileLoading
        ? 'Loading your plays...'
        : isLoadingWorkingVideo && modeOption.id === 'overlay'
        ? 'Loading working video...'
        : !isAvailable && modeOption.id === 'framing'
          ? hasSelectedPlay
            ? 'Rate a play Brilliant, then choose Make Highlight Now.'
            : 'Select a Brilliant play to frame it.'
          : !isAvailable && modeOption.id === 'overlay'
            ? hasProject
              ? 'Generate Highlight to unlock Spotlight.'
              : 'Make a highlight first. Spotlight comes after Framing.'
            : modeOption.showWarning
              ? 'Previously generated video no longer matches your settings. Generate the latest video before overlaying.'
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
          // T11220: a legacy multi-clip project (clip_count > 1) cannot enter
          // Focus/Framing — the shared guard refuses with a clear toast rather
          // than switching modes (which would burn credits on a re-export that
          // then 400s). ONE guard shared with OverlayScreen's Reapply tiles,
          // App's mode switch, and DraftTile.
          if (modeOption.id === 'framing' && !allowEnterFraming(modeProject)) return;
          onModeChange(modeOption.id);
        }}
        disabled={disabled}
        aria-disabled={disabled || !isAvailable}
        aria-busy={isLockedWhileLoading ? 'true' : undefined}
        className={`
          ${inline
            // T11740: stacked icon-over-label, equal 3-col cells below `md`; today's
            // single-row tab at `md`+ (where the compact header is one row again).
            ? 'flex flex-col items-center justify-center gap-0.5 h-12 px-1 min-w-0 md:flex-row md:justify-start md:h-11 md:gap-2 md:px-4 md:py-2'
            : 'flex h-11 items-center gap-2 px-2 sm:px-4 py-2'
          } rounded-md transition-all duration-200 relative
          ${isActive
            ? modeOption.color === 'reel'
              ? `${activeColor} text-gray-950 shadow-lg`
              : `${activeColor} text-white shadow-lg`
            : isAvailable
              ? 'text-white/70 hover:text-white hover:bg-white/10 ring-1 ring-inset ring-yellow-400/70'
              : 'text-white/30 cursor-not-allowed'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
        title={titleText}
      >
        {isLockedWhileLoading || (isLoadingWorkingVideo && modeOption.id === 'overlay') ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          isAvailable ? <Icon size={16} /> : <Lock size={16} />
        )}
        <span
          className={
            inline
              ? 'font-medium leading-tight text-center text-[11px] md:text-sm md:text-left md:whitespace-nowrap'
              : 'font-medium text-sm whitespace-nowrap'
          }
        >
          {modeOption.label}
        </span>
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
