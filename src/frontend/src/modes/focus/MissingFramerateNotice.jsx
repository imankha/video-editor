import { clipFramerate } from '../../utils/clipSelectors';

/**
 * T4540: Frame's error for a clip with no stored frame rate. Crop keyframes are
 * stored by frame number, so without the rate the crop timing would be a guess,
 * and the render refuses such a clip (400 missing_framerate).
 */
export default function MissingFramerateNotice({ clip }) {
  if (!clip || clipFramerate(clip) != null) return null;
  return (
    <div
      role="alert"
      data-testid="clip-framerate-missing"
      className="mb-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      We couldn't read this play's frame rate, so its framing can't be timed correctly and it can't be made into a highlight.
    </div>
  );
}
