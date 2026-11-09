import { Minimize, Rewind, SkipBack, SkipForward, FastForward, Play, Pause } from 'lucide-react';
import { useGuidePulse } from '../../../components/instructions/GuideScope';
import { GUIDE_PULSE } from '../../../components/instructions/guideTargets';

const RAIL_BTN =
  'flex h-11 w-11 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-40';

/**
 * AnnotateTransportStrip (T15370) -- the 56px left strip of the Annotate
 * landscape cockpit. Modelled on Focus's TransportRail.jsx (T10840), but
 * Annotate's transport is a different set of buttons (frame-step + 5s skip,
 * no back-to-home) so this is its own component, not a parameterised reuse
 * (refactor rule 1: abstract on the 3rd duplication).
 *
 * `editorOpen` hides the skips (T8960 parity: only play/pause remains while
 * the play editor is open, same as the windowed AnnotateControls bar).
 * `simplified` hides frame-step (T11860: a fresh game with 0 plays).
 */
export default function AnnotateTransportStrip({
  isPlaying,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onSeekForward,
  onSeekBackward,
  onExit,
  editorOpen = false,
  simplified = false,
  className = '',
}) {
  const playPulse = useGuidePulse(GUIDE_PULSE.ANNOTATE_PLAY, { suppress: isPlaying });
  return (
    <div
      data-testid="annotate-cockpit-left-strip"
      data-cockpit-strip=""
      className={`flex w-14 flex-none flex-col items-center justify-center gap-1.5 border-r border-gray-700 bg-gray-900 py-1.5 ${className}`}
    >
      <button
        type="button"
        onClick={onExit}
        title="Exit fullscreen (Esc)"
        aria-label="Exit fullscreen"
        className={`${RAIL_BTN} mb-auto`}
      >
        <Minimize size={18} aria-hidden="true" />
      </button>

      {!editorOpen && (
        <button
          type="button"
          onClick={() => onSeekBackward?.(5)}
          title="Back 5 seconds"
          aria-label="Back 5 seconds"
          className={RAIL_BTN}
        >
          <Rewind size={18} aria-hidden="true" />
        </button>
      )}

      {!editorOpen && !simplified && (
        <button
          type="button"
          onClick={onStepBackward}
          title="Step backward (one frame)"
          aria-label="Step backward"
          className={RAIL_BTN}
        >
          <SkipBack size={18} aria-hidden="true" />
        </button>
      )}

      <button
        type="button"
        data-testid="annotate-play-button"
        onClick={onTogglePlay}
        title={isPlaying ? 'Pause' : 'Play'}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        className={`flex h-[52px] w-[52px] items-center justify-center rounded-full bg-green-600 text-white shadow-lg active:bg-green-500 ${playPulse}`}
      >
        {isPlaying ? <Pause size={22} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
      </button>

      {!editorOpen && !simplified && (
        <button
          type="button"
          onClick={onStepForward}
          title="Step forward (one frame)"
          aria-label="Step forward"
          className={RAIL_BTN}
        >
          <SkipForward size={18} aria-hidden="true" />
        </button>
      )}

      {!editorOpen && (
        <button
          type="button"
          onClick={() => onSeekForward?.(5)}
          title="Forward 5 seconds"
          aria-label="Forward 5 seconds"
          className={`${RAIL_BTN} mt-auto`}
        >
          <FastForward size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
