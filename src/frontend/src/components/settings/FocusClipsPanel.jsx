import SettingsPanel from './SettingsPanel';

/**
 * FocusClipsPanel (T9270) — the Focus "Clips" tab body.
 *
 * The interactive clip strip / thumbnails are the droppable mobile-reclaimed-space
 * piece (Step 4). This desktop panel surfaces the reel's clip count + framed
 * progress derived from the clips already threaded into the view — never a second
 * stored copy — so the tab is useful without duplicating the timeline's clip lane
 * (where selection/reorder already live).
 *
 * @param {Array} clips — clipsWithCurrentState (may be null for a single clip).
 */
export default function FocusClipsPanel({ clips = null }) {
  const count = clips?.length || 0;
  return (
    <SettingsPanel title="Clips">
      {count > 0 ? (
        <p className="text-sm text-gray-300">
          {count === 1 ? '1 clip in this reel.' : `${count} clips in this reel.`}
        </p>
      ) : (
        <p className="text-sm text-gray-400">Single clip.</p>
      )}
      <p className="text-xs text-gray-500">
        Select, reorder, and trim clips on the timeline below the video.
      </p>
    </SettingsPanel>
  );
}
