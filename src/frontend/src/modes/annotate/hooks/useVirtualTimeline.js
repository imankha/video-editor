import { useMemo } from 'react';

/**
 * Build a virtual timeline from sorted clips.
 *
 * Pure function — no DOM, no side-effects. Suitable for unit testing.
 *
 * @param {Array<{startTime: number, endTime: number, videoSequence?: number|null, id: string}>} clips
 *   Clips sorted by startTime ascending.
 * @returns {VirtualTimeline}
 */
export function buildVirtualTimeline(clips) {
  if (!clips || clips.length === 0) {
    return {
      segments: [],
      totalVirtualDuration: 0,
      virtualToActual: () => null,
      actualToVirtual: () => 0,
      getSegmentAtVirtualTime: () => null,
    };
  }

  // Sort by startTime (defensive — caller should already sort)
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);

  // Build segments with virtual offsets
  let virtualOffset = 0;
  const segments = sorted.map((clip) => {
    const clipDuration = clip.endTime - clip.startTime;
    const segment = {
      clipId: clip.id,
      startTime: clip.startTime,       // actual video time
      endTime: clip.endTime,           // actual video time
      videoSequence: clip.videoSequence ?? null,
      virtualStart: virtualOffset,     // virtual timeline offset
      virtualEnd: virtualOffset + clipDuration,
      duration: clipDuration,
    };
    virtualOffset += clipDuration;
    return segment;
  });

  const totalVirtualDuration = virtualOffset;

  /**
   * Map virtual time → actual video coordinates.
   * @param {number} vt — virtual time in [0, totalVirtualDuration]
   * @returns {{ segmentIndex: number, actualTime: number, segment: object } | null}
   */
  function virtualToActual(vt) {
    if (segments.length === 0) return null;

    // Clamp
    const clamped = Math.max(0, Math.min(vt, totalVirtualDuration));

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      // Use < for virtualEnd so the last frame of a segment maps to the next segment's start
      // Exception: last segment uses <=
      const isLast = i === segments.length - 1;
      if (clamped >= seg.virtualStart && (isLast ? clamped <= seg.virtualEnd : clamped < seg.virtualEnd)) {
        const offsetInSegment = clamped - seg.virtualStart;
        return {
          segmentIndex: i,
          actualTime: seg.startTime + offsetInSegment,
          segment: seg,
        };
      }
    }

    // Fallback: end of last segment
    const last = segments[segments.length - 1];
    return {
      segmentIndex: segments.length - 1,
      actualTime: last.endTime,
      segment: last,
    };
  }

  /**
   * Map actual video time + segment index → virtual time.
   * @param {number} segmentIndex
   * @param {number} actualTime — actual video time
   * @returns {number} virtual time
   */
  function actualToVirtual(segmentIndex, actualTime) {
    if (segmentIndex < 0 || segmentIndex >= segments.length) return 0;
    const seg = segments[segmentIndex];
    const offset = Math.max(0, Math.min(actualTime - seg.startTime, seg.duration));
    return seg.virtualStart + offset;
  }

  /**
   * Get the segment at a given virtual time.
   * @param {number} vt
   * @returns {{ segment: object, segmentIndex: number } | null}
   */
  function getSegmentAtVirtualTime(vt) {
    const result = virtualToActual(vt);
    if (!result) return null;
    return { segment: result.segment, segmentIndex: result.segmentIndex };
  }

  return {
    segments,
    totalVirtualDuration,
    virtualToActual,
    actualToVirtual,
    getSegmentAtVirtualTime,
  };
}

/**
 * React hook wrapper around buildVirtualTimeline.
 * Memoizes the timeline so it only rebuilds when clips change.
 *
 * @param {Array} clips — clip regions (must have startTime, endTime, id, videoSequence)
 * @returns {VirtualTimeline}
 */
export function useVirtualTimeline(clips) {
  return useMemo(() => buildVirtualTimeline(clips), [clips]);
}

export default useVirtualTimeline;
