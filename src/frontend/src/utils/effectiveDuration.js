/**
 * Effective (post-trim, post-speed) clip-duration math.
 *
 * This is the ONE cost calculator (Monetization Pass / EPIC.md): every user-facing
 * output-length and credit number derives from `calculateEffectiveDuration`, and the
 * backend charge uses the same model. The number on the Framing indicator, on the
 * Export button (T5790), in the insufficient-credits modal, and in the backend charge
 * must never disagree.
 *
 * Extracted from `containers/ExportButtonContainer.jsx` (T5780) as a pure module so the
 * Framing screen can show a live output-length indicator without importing the export
 * container.
 */

/**
 * Calculate effective clip duration after trim and speed adjustments
 * @param {Object} clip - Clip object with duration, segments, trimRange
 * @returns {number} Effective duration in seconds
 *
 * Handles multiple data formats:
 * 1. Frontend format: {segments: {segmentSpeeds, boundaries, trimRange}, trimRange}
 * 2. DB saved format: {segments: {trim_start, trim_end, segments: [{start, end, speed}]}}
 */
export function calculateEffectiveDuration(clip) {
  if (!clip.duration && clip.duration !== 0) {
    console.warn(`[calculateEffectiveDuration] clip ${clip.id} missing duration — caller must set it from metadata cache`);
  }

  // `segments` is the live frontend-format edit state (present on the selected clip
  // via FramingContainer's clipsWithCurrentState); `segments_data` is the saved
  // backend blob raw clips carry for every OTHER clip. Reading both lets one calculator
  // cover the selected clip's live state AND the saved state of the rest (T5780).
  const segments = clip.segments || clip.segments_data || {};

  // Handle trimRange - can be in segments.trimRange, clip.trimRange, or as segments.trim_start/trim_end
  let trimRange = segments.trimRange || clip.trimRange;
  if (!trimRange && (segments.trim_start !== undefined || segments.trim_end !== undefined)) {
    // DB saved format uses trim_start/trim_end
    trimRange = {
      start: segments.trim_start ?? 0,
      end: segments.trim_end ?? clip.duration
    };
  }

  // Start with full duration or trimmed range
  const start = trimRange?.start ?? 0;
  const end = trimRange?.end ?? clip.duration;

  // Handle speed data - can be segmentSpeeds object or segments array
  const segmentSpeeds = segments.segmentSpeeds || {};
  const boundaries = segments.boundaries || [0, clip.duration];
  const speedSegmentsArray = segments.segments; // DB format: [{start, end, speed}]

  // Check if we have speed changes
  const hasSpeedChanges = Object.keys(segmentSpeeds).length > 0 ||
    (Array.isArray(speedSegmentsArray) && speedSegmentsArray.some(s => s.speed !== 1.0));

  // If no speed changes, simple calculation
  if (!hasSpeedChanges) {
    return end - start;
  }

  // Calculate duration accounting for speed changes
  let totalDuration = 0;

  if (Array.isArray(speedSegmentsArray) && speedSegmentsArray.length > 0) {
    // DB format: use segments array directly
    for (const seg of speedSegmentsArray) {
      const segStart = Math.max(seg.start, start);
      const segEnd = Math.min(seg.end, end);
      if (segEnd > segStart) {
        const speed = seg.speed || 1.0;
        totalDuration += (segEnd - segStart) / speed;
      }
    }
  } else {
    // Frontend format: use boundaries and segmentSpeeds
    for (let i = 0; i < boundaries.length - 1; i++) {
      const segStart = Math.max(boundaries[i], start);
      const segEnd = Math.min(boundaries[i + 1], end);

      if (segEnd > segStart) {
        const speed = segmentSpeeds[String(i)] || 1.0;
        totalDuration += (segEnd - segStart) / speed;
      }
    }
  }

  return totalDuration;
}

/**
 * Sum effective (post-trim, post-speed) durations across a list of clips — the live
 * project output length (T5780), and the basis for T5790's credit estimate.
 *
 * Fail-closed (EPIC.md "No fabricated numbers"): if ANY clip's effective duration is
 * unknown (NaN — e.g. a clip whose duration never made it into the metadata cache),
 * returns null so the caller HIDES the total rather than showing a guess that would be
 * short of the real (backend-authoritative) charge.
 *
 * @param {Array} clips - Clip objects (selected clip carries live `segments`, the rest
 *   carry saved `segments_data`)
 * @returns {number|null} Total effective seconds, or null if unknown/empty
 */
export function sumEffectiveDurations(clips) {
  if (!clips || clips.length === 0) return null;

  let total = 0;
  for (const clip of clips) {
    const eff = calculateEffectiveDuration(clip);
    if (eff == null || Number.isNaN(eff)) return null;
    total += eff;
  }
  return total;
}

/**
 * Build clip metadata for overlay mode auto-highlight region creation
 * @param {Array} clips - Array of clip objects
 * @returns {Object} Metadata object with source_clips array
 */
export function buildClipMetadata(clips) {
  if (!clips || clips.length === 0) return null;

  let currentTime = 0;
  const sourceClips = clips.map(clip => {
    const effectiveDuration = calculateEffectiveDuration(clip);

    const clipMeta = {
      name: clip.fileName || clip.filename,
      start_time: currentTime,
      end_time: currentTime + effectiveDuration
    };

    currentTime += effectiveDuration;
    return clipMeta;
  });

  return {
    version: 1,
    source_clips: sourceClips
  };
}
