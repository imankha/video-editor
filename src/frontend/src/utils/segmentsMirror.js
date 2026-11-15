import { reindexSegmentSpeedsOnRemove } from '../modes/focus/hooks/useSegments';

/**
 * T4470: the store copy of a clip's cut list (clip.segments_data) is what the
 * header badge, the Sharpen button and the credit price read; the timeline
 * reads useSegments. Each segment gesture's effect on the store copy is
 * computed here, from the copy as it is at write time, so a gesture landing
 * while another one's save is in flight composes instead of overwriting it.
 *
 * Gestures:
 *   { type: 'trim', trimRange }          trim, untrim, detrim start/end (null = no trim)
 *   { type: 'split', time }
 *   { type: 'unsplit', time }
 *   { type: 'speed', index, speed }      1x removes the entry, as useSegments does
 *
 * @param {{boundaries: number[], segmentSpeeds: Object, trimRange: ?Object}} current
 * @param {Object} gesture
 */
export function nextSegments(current, gesture) {
  const { boundaries, segmentSpeeds, trimRange } = current;
  switch (gesture.type) {
    case 'trim':
      return { boundaries, segmentSpeeds, trimRange: gesture.trimRange };
    case 'split':
      return { boundaries: [...boundaries, gesture.time].sort((a, b) => a - b), segmentSpeeds, trimRange };
    case 'unsplit': {
      const k = boundaries.indexOf(gesture.time) - 1;
      return {
        boundaries: boundaries.filter(b => b !== gesture.time),
        segmentSpeeds: k >= 0 ? reindexSegmentSpeedsOnRemove(segmentSpeeds, k) : segmentSpeeds,
        trimRange,
      };
    }
    case 'speed': {
      const speeds = { ...segmentSpeeds };
      if (gesture.speed === 1) delete speeds[gesture.index];
      else speeds[gesture.index] = gesture.speed;
      return { boundaries, segmentSpeeds: speeds, trimRange };
    }
    default:
      throw new Error(`nextSegments: unknown gesture ${JSON.stringify(gesture)}`);
  }
}
