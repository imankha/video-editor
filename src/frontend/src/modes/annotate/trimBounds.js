/**
 * T9480 -- the ONE trim-bounds policy. Drag, typed entry and step buttons all
 * route through `clampTrim`; `clampToVisibleWindow` is named and applied
 * SEPARATELY, drag-only, because the visible +/-30s window is a VIEW concern,
 * not a media bound. Before this module the drag handler inlined the clamp
 * twice (once per handle) and conflated the two concerns -- clamping to the
 * visible window meant a boundary the window didn't show was unreachable even
 * by typed entry, which is exactly why a parent could "fight the drag handle".
 */

/** Minimum clip duration in seconds -- moved here from ClipScrubRegion.jsx (one owner). */
export const MIN_REGION_DURATION = 0.5;

/**
 * The ONE trim-bounds policy: true media bounds + the minimum-duration
 * invariant between start/end. Never swaps start/end.
 *
 * @param {{start:number, end:number, edge:'start'|'end', mediaStart?:number, mediaEnd:number}} args
 * @returns {{value:number, rejected:boolean, clamped:boolean, message:string|null}}
 */
export function clampTrim({ start, end, edge, mediaStart = 0, mediaEnd }) {
  if (edge !== 'start' && edge !== 'end') {
    throw new Error(`clampTrim: edge must be 'start' or 'end', got ${JSON.stringify(edge)}`);
  }

  let value = edge === 'start' ? start : end;
  let clamped = false;
  let message = null;

  // Minimum-duration invariant between the two handles first (a handle must
  // never cross its partner)...
  if (edge === 'start' && value > end - MIN_REGION_DURATION) {
    value = end - MIN_REGION_DURATION;
    clamped = true;
    message = 'Start must stay at least 0.5s before the end.';
  } else if (edge === 'end' && value < start + MIN_REGION_DURATION) {
    value = start + MIN_REGION_DURATION;
    clamped = true;
    message = 'End must stay at least 0.5s after the start.';
  }

  // ...then the true media bounds, which always win LAST: you can never
  // select time outside the actual video, even if that leaves a span
  // narrower than MIN_REGION_DURATION near the very edge of a clip.
  if (value < mediaStart) {
    value = mediaStart;
    clamped = true;
    message = 'That is before the start of the video.';
  } else if (mediaEnd != null && value > mediaEnd) {
    value = mediaEnd;
    clamped = true;
    message = 'That is past the end of the video.';
  }

  // Structurally unreachable once the MIN-duration clamp above holds (the
  // region always had >= MIN_REGION_DURATION before this edit) -- asserted,
  // not a normal runtime path. A media span narrower than MIN_REGION_DURATION
  // would be the only way to trip this, which the app never produces.
  const resultingSpan = edge === 'start' ? end - value : value - start;
  const rejected = resultingSpan <= 0;
  if (rejected) {
    console.error('clampTrim: resulting span <= 0 -- media bounds narrower than MIN_REGION_DURATION?', {
      start, end, edge, mediaStart, mediaEnd,
    });
  }

  return { value, rejected, clamped, message: rejected ? null : message };
}

/**
 * The visible +/-30s (or edit-zoom) window -- a VIEW constraint, drag-only.
 * Named and kept separate from `clampTrim` so the "why" of each constraint is
 * greppable: typed entry and step buttons reach the true media bounds; only
 * dragging is limited to what the window currently shows.
 */
export function clampToVisibleWindow({ value, edge, windowStart, windowEnd }) {
  return edge === 'start' ? Math.max(windowStart, value) : Math.min(windowEnd, value);
}
