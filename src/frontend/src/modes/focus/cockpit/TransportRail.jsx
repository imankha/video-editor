import { ArrowLeft, ChevronsLeft, ChevronsRight, Play, Pause } from 'lucide-react';
import { FOCUS_COCKPIT } from '../../../config/displayNames';

const RAIL_BTN =
  'flex h-11 w-11 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 transition-colors';

/**
 * Split a time in seconds into a two-line timecode: `HH:MM:SS` over `.mmm`.
 * Full precision is preserved (the 56px rail has room for both lines), matching
 * the design's `00:00:04` / `.976` readout.
 */
function formatTimecode(seconds) {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const whole = Math.floor(t);
  const hh = String(Math.floor(whole / 3600)).padStart(2, '0');
  const mm = String(Math.floor((whole % 3600) / 60)).padStart(2, '0');
  const ss = String(whole % 60).padStart(2, '0');
  const frac = Math.round((t - whole) * 1000);
  return { clock: `${hh}:${mm}:${ss}`, frac: `.${String(frac).padStart(3, '0')}` };
}

/**
 * TransportRail (T10840, Zone A) — the 56px left edge rail. Left-thumb arc:
 * Back at the top, the step-back / play / step-forward cluster vertically
 * centered (play at the easiest reach point on the screen), and a two-line
 * mono timecode pinned to the bottom.
 */
export default function TransportRail({
  isPlaying,
  currentTime,
  togglePlay,
  stepForward,
  stepBackward,
  onExitToHome,
}) {
  const { clock, frac } = formatTimecode(currentTime);
  return (
    <div
      data-testid="cockpit-transport"
      className="flex w-14 flex-none flex-col items-center justify-between border-r border-gray-700 bg-gray-900 py-1.5"
    >
      <button
        type="button"
        data-testid="cockpit-back"
        onClick={onExitToHome}
        title={FOCUS_COCKPIT.BACK}
        aria-label={FOCUS_COCKPIT.BACK}
        className={RAIL_BTN}
      >
        <ArrowLeft size={20} aria-hidden="true" />
      </button>

      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={stepBackward}
          title="Step back"
          aria-label="Step back"
          className={RAIL_BTN}
        >
          <ChevronsLeft size={20} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="cockpit-play"
          onClick={togglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#a855f7] text-white shadow-lg shadow-purple-500/40 active:bg-purple-400"
        >
          {isPlaying ? <Pause size={22} aria-hidden="true" /> : <Play size={22} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={stepForward}
          title="Step forward"
          aria-label="Step forward"
          className={RAIL_BTN}
        >
          <ChevronsRight size={20} aria-hidden="true" />
        </button>
      </div>

      <div data-testid="cockpit-timecode" className="flex flex-col items-center pb-1">
        <span className="font-mono tabular-nums text-xs text-gray-300">{clock}</span>
        <span className="font-mono tabular-nums text-[10px] text-gray-400">{frac}</span>
      </div>
    </div>
  );
}
