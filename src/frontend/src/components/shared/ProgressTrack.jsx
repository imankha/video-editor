import React from 'react';

/**
 * ProgressTrack — track background + progress fill + optional hover fill (T6320).
 *
 * Store-free, pure display. Both VideoControls and CollectionPlayer compose this
 * with their OWN className/style tokens so each surface keeps its exact current
 * look (Gate 1: parameterize, not converge — see T6320-shared-progress-track-primitive.md).
 * Callers pass full class strings rather than semantic tokens (color/height/etc.)
 * because the two surfaces' markup genuinely differs (fill positioning, rounding,
 * overflow clipping) — a token API would have to re-derive that divergence anyway.
 *
 * `children` render inside the track's positioned box, after the fill, so a
 * caller can nest a PlayheadHandle when it wants the handle clipped together
 * with the track (VideoControls). A caller whose track clips overflow
 * (`overflow-hidden`, e.g. CollectionPlayer) should NOT nest the handle here —
 * render it as a sibling instead, so the handle isn't cut off at a segment
 * boundary (T6320 Gate 3: allow overflow, don't clamp).
 */
export function ProgressTrack({
  progress,
  trackClassName,
  trackStyle,
  fillClassName,
  hoverPercent,
  hoverClassName = 'absolute inset-y-0 left-0 bg-white/20 rounded-full',
  children,
}) {
  return (
    <div className={trackClassName} style={trackStyle}>
      {hoverPercent != null && (
        <div className={hoverClassName} style={{ width: `${hoverPercent}%` }} />
      )}
      <div className={fillClassName} style={{ width: `${progress}%` }} />
      {children}
    </div>
  );
}

export default ProgressTrack;
