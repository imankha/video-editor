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
  const sorted = [...clips].sort((a, b) => {
    const seqA = a.videoSequence ?? 1;
    const seqB = b.videoSequence ?? 1;
    if (seqA !== seqB) return seqA - seqB;
    return a.startTime - b.startTime;
  });

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

/**
 * Build a virtual timeline from full video durations (not clips).
 * Maps N video files into one continuous virtual timeline.
 *
 * @param {Array<{sequence: number, duration: number}>} gameVideos
 * @returns {FullVideoTimeline|null}
 */
export function buildFullVideoTimeline(gameVideos) {
  if (!gameVideos || gameVideos.length === 0) return null;

  const sorted = [...gameVideos].sort((a, b) => a.sequence - b.sequence);

  let offset = 0;
  const segments = sorted.map((video, index) => {
    const seg = {
      videoIndex: index,
      videoSequence: video.sequence,
      virtualStart: offset,
      virtualEnd: offset + video.duration,
      duration: video.duration,
    };
    offset += video.duration;
    return seg;
  });

  const totalDuration = offset;

  function virtualToActual(vt) {
    const clamped = Math.max(0, Math.min(vt, totalDuration));

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      if (clamped >= seg.virtualStart && (isLast ? clamped <= seg.virtualEnd : clamped < seg.virtualEnd)) {
        return {
          videoIndex: seg.videoIndex,
          videoSequence: seg.videoSequence,
          actualTime: clamped - seg.virtualStart,
        };
      }
    }

    const last = segments[segments.length - 1];
    return {
      videoIndex: last.videoIndex,
      videoSequence: last.videoSequence,
      actualTime: last.duration,
    };
  }

  function actualToVirtual(videoIndex, actualTime) {
    if (videoIndex < 0 || videoIndex >= segments.length) return 0;
    const seg = segments[videoIndex];
    const clamped = Math.max(0, Math.min(actualTime, seg.duration));
    return seg.virtualStart + clamped;
  }

  function getVideoOffset(videoSequence) {
    if (videoSequence == null) return 0;
    const seg = segments.find(s => s.videoSequence === videoSequence);
    return seg?.virtualStart ?? 0;
  }

  function getVideoBoundaries() {
    return segments.slice(1).map(s => s.virtualStart);
  }

  function clampToVideo(virtualStart, virtualEnd) {
    const startResult = virtualToActual(virtualStart);
    const seg = segments[startResult.videoIndex];
    const clampedVirtualEnd = Math.min(virtualEnd, seg.virtualEnd);
    const actualEnd = clampedVirtualEnd - seg.virtualStart;
    return {
      startTime: startResult.actualTime,
      endTime: actualEnd,
      videoSequence: startResult.videoSequence,
    };
  }

  return {
    segments,
    totalDuration,
    virtualToActual,
    actualToVirtual,
    getVideoOffset,
    getVideoBoundaries,
    clampToVideo,
  };
}

// ---------------------------------------------------------------------------
// T8880: Game timeline v2 -- lanes, backbone, coverage extensions.
//
// buildGameTimeline is the overlap-aware successor to buildFullVideoTimeline.
// It is used ONLY when footage genuinely overlaps (see
// hasOverlappingAngles); an angle-free game keeps hitting the byte-identical
// buildFullVideoTimeline path. See EPIC.md decisions 7 (overlap model) + 9
// (coverage extensions) and docs/plans/tasks/universal-upload/T8880-*.md.
// ---------------------------------------------------------------------------

// 1-2s of recording-split slop must not manufacture a phantom lane, so two
// intervals whose overlap is within this tolerance are treated as adjacent.
export const OVERLAP_EPSILON_S = 1.0;

const EPS_TINY = 1e-9;

/** Interval overlap with the recording-split tolerance baked in. */
function intervalsOverlap(a, b) {
  return a.start < b.end - OVERLAP_EPSILON_S && b.start < a.end - OVERLAP_EPSILON_S;
}

/**
 * Resolve every video's canonical wall-clock interval.
 * offset = offset_seconds when present, else the prefix-sum-of-durations by
 * sequence (the exact placement buildFullVideoTimeline's concatenation produces,
 * and the same rule T8870's backfill used). prefixSum is retained so callers can
 * detect real (non-prefix-sum) placement.
 */
function resolveVideoOffsets(gameVideos) {
  const bySequence = [...gameVideos].sort((a, b) => a.sequence - b.sequence);
  let acc = 0;
  const prefixBySeq = new Map();
  for (const v of bySequence) {
    prefixBySeq.set(v.sequence, acc);
    acc += v.duration;
  }
  return gameVideos.map((v) => {
    const prefixSum = prefixBySeq.get(v.sequence);
    const offset = v.offset_seconds != null ? v.offset_seconds : prefixSum;
    return { ...v, prefixSum, offset, start: offset, end: offset + v.duration };
  });
}

/**
 * True ONLY when some pair of videos genuinely OVERLAPS (beyond the epsilon slop),
 * i.e. angles/extensions exist and buildFullVideoTimeline literally cannot
 * represent the game -- the lane-aware builder is required.
 *
 * This is AnnotateContainer's fast-path selector. It deliberately does NOT trip on
 * a real GAP (halftime): a gap-only game is still angle-free -- every video is on
 * lane 0 -- so buildFullVideoTimeline concatenates it byte-identically to today
 * (offsets ignored, gaps compress exactly as before). Routing a gap game to
 * buildGameTimeline would hand the render path a different-shaped object and crash
 * (T8890 adapts those consumers). So the rail keeps EVERY angle-free game (prefix-
 * sum, backfilled, or gapped multi-segment) on the old path, and reserves the new
 * builder for real overlap -- which no current intake produces (EPIC decision 1
 * discards overlapping timestamps) and which only T8900/T8910 will create.
 *
 * A null offset (pre-migration edge) falls back to prefix-sum. Sub-epsilon overlap
 * (recording-split slop) does not count -- same tolerance the lane builder uses.
 */
export function hasOverlappingAngles(gameVideos) {
  if (!gameVideos || gameVideos.length < 2) return false;
  const resolved = resolveVideoOffsets(gameVideos).sort((a, b) => a.start - b.start);
  let maxEnd = -Infinity;
  for (const v of resolved) {
    // v starts before some earlier video's end (beyond slop) => a real overlap.
    if (v.start < maxEnd - OVERLAP_EPSILON_S) return true;
    maxEnd = Math.max(maxEnd, v.end);
  }
  return false;
}

/** Merge a list of {start,end} into sorted, disjoint runs. */
function mergeIntervals(intervals) {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }
  return merged;
}

/** Classic interval subtraction: cover minus holes, as disjoint {start,end}. */
function subtractIntervals(cover, holes) {
  const result = [];
  for (const c of cover) {
    let pieces = [{ start: c.start, end: c.end }];
    for (const h of holes) {
      const next = [];
      for (const s of pieces) {
        if (h.end <= s.start || h.start >= s.end) {
          next.push(s);
        } else {
          if (h.start > s.start) next.push({ start: s.start, end: h.start });
          if (h.end < s.end) next.push({ start: h.end, end: s.end });
        }
      }
      pieces = next;
    }
    result.push(...pieces);
  }
  return result.filter((s) => s.end - s.start > EPS_TINY);
}

/** filename stem (no path, no extension) from a url, or '' if none usable. */
function filenameStem(url) {
  if (!url || typeof url !== 'string') return '';
  const noQuery = url.split(/[?#]/)[0];
  const base = noQuery.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Truncate to maxLen with a middle ellipsis (T8890/T8910 angle chip label). */
function middleEllipsis(s, maxLen) {
  if (s.length <= maxLen) return s;
  const keep = maxLen - 1; // room for the ellipsis glyph
  const head = Math.ceil(keep / 2);
  const tail = Math.floor(keep / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/**
 * Build the overlap-aware game timeline: lane model, backbone virtual domain,
 * coverage extensions, and the wall<->virtual<->source mapping functions
 * consumed by T8890 (angle strip / source switching) and T8900 (fix timing).
 *
 * LANE ALGORITHM (do not "improve" -- the count is provably minimal):
 *   - Backbone (lane 0) = the "main camera" = the LONGEST video (tie: earliest
 *     offset, then sequence), grown forward/backward by admitting every video, in
 *     offset order, that overlaps NO current backbone member. This anchors the
 *     spine to the main camera so an earlier-but-shorter overlapping angle (incl.
 *     a negative-offset attach) can never steal lane 0 (the inversion a naive
 *     "earliest interval wins lane 0" greedy produces).
 *   - Angles (lanes 1+) = every remaining video, colored by the standard
 *     minimal-lane greedy: in offset order, take the lowest lane >= 1 whose last
 *     interval ends <= this start (+OVERLAP_EPSILON_S). Greedy coloring on
 *     offset-sorted intervals uses exactly max-concurrency lanes, which is
 *     optimal; pre-seeding lane 0 with the backbone changes WHICH video is on
 *     lane 0, never HOW MANY lanes exist.
 *
 * COVERAGE EXTENSIONS (EPIC decision 9): union(lane1+) minus union(lane0) becomes
 * extension segments inserted into the virtual domain at their wall position
 * (prepended when before the first backbone video, e.g. negative offsets).
 *
 * @param {Array<{sequence:number, duration:number, offset_seconds?:number|null, recorded_at?:string|null, url?:string}>} gameVideos
 * @returns {GameTimeline|null}
 */
export function buildGameTimeline(gameVideos) {
  if (!gameVideos || gameVideos.length === 0) return null;

  const videos = resolveVideoOffsets(gameVideos);
  const byOffset = [...videos].sort((a, b) => a.start - b.start || a.sequence - b.sequence);
  const videoBySeq = new Map(videos.map((v) => [v.sequence, v]));

  // ---- Backbone (lane 0): longest video spine, grown by non-overlap ----
  const seed = [...videos].sort(
    (a, b) => b.duration - a.duration || a.start - b.start || a.sequence - b.sequence,
  )[0];
  const backbone = [seed];
  const backboneSeqs = new Set([seed.sequence]);
  for (const v of byOffset) {
    if (backboneSeqs.has(v.sequence)) continue;
    if (backbone.every((b) => !intervalsOverlap(b, v))) {
      backbone.push(v);
      backboneSeqs.add(v.sequence);
    }
  }
  backbone.sort((a, b) => a.start - b.start || a.sequence - b.sequence);

  // ---- Angles (lanes 1+): minimal-lane greedy over the rest ----
  const angleVideos = byOffset.filter((v) => !backboneSeqs.has(v.sequence));
  const laneEnds = []; // laneEnds[k] = last end on angle-lane (k+1)
  const laneOf = new Map(backbone.map((v) => [v.sequence, 0]));
  for (const v of angleVideos) {
    let lane = -1;
    for (let k = 0; k < laneEnds.length; k++) {
      if (laneEnds[k] <= v.start + OVERLAP_EPSILON_S) {
        laneEnds[k] = v.end;
        lane = k + 1;
        break;
      }
    }
    if (lane === -1) {
      laneEnds.push(v.end);
      lane = laneEnds.length;
    }
    laneOf.set(v.sequence, lane);
  }

  // ---- Coverage extensions: union(angles) minus union(backbone) ----
  const backboneCover = mergeIntervals(backbone.map((v) => ({ start: v.start, end: v.end })));
  const angleCover = mergeIntervals(angleVideos.map((v) => ({ start: v.start, end: v.end })));
  const extensionRanges = subtractIntervals(angleCover, backboneCover);
  const extensions = extensionRanges.map((piece) => {
    // Owning angle = earliest-offset lane-1+ video covering the piece's start
    // (tie: lowest lane, then sequence). sourcesAt reports the full truth.
    const owner = angleVideos
      .filter((v) => v.start <= piece.start + EPS_TINY && v.end > piece.start + EPS_TINY)
      .sort(
        (a, b) =>
          a.start - b.start || laneOf.get(a.sequence) - laneOf.get(b.sequence) || a.sequence - b.sequence,
      )[0];
    return {
      type: 'extension',
      sourceSequence: owner ? owner.sequence : null,
      wallStart: piece.start,
      wallEnd: piece.end,
      length: piece.end - piece.start,
    };
  });

  // ---- Virtual domain: backbone videos concatenated (real gaps compress to
  // zero-width boundary markers, exactly buildFullVideoTimeline), extensions
  // interleaved by wall position. All entries are disjoint in wall space, so a
  // plain wallStart sort yields prepend/in-gap/append order for free. ----
  const rawEntries = [
    ...backbone.map((v) => ({
      type: 'video',
      sequence: v.sequence,
      wallStart: v.start,
      wallEnd: v.end,
      length: v.duration,
    })),
    ...extensions,
  ].sort(
    (a, b) => a.wallStart - b.wallStart || (a.type === b.type ? 0 : a.type === 'video' ? -1 : 1),
  );

  let cursor = 0;
  const domain = rawEntries.map((e) => {
    const entry = {
      ...e,
      virtualStart: cursor,
      virtualEnd: cursor + e.length,
    };
    cursor += e.length;
    return entry;
  });
  const totalDuration = cursor;

  // ---- Mapping functions over the domain ----
  function virtualToWall(t) {
    if (domain.length === 0) return 0;
    const clamped = Math.max(0, Math.min(t, totalDuration));
    for (let i = 0; i < domain.length; i++) {
      const e = domain[i];
      const isLast = i === domain.length - 1;
      if (clamped >= e.virtualStart && (isLast ? clamped <= e.virtualEnd : clamped < e.virtualEnd)) {
        return e.wallStart + (clamped - e.virtualStart);
      }
    }
    return domain[domain.length - 1].wallEnd;
  }

  function wallToVirtual(w) {
    if (domain.length === 0) return 0;
    for (const e of domain) {
      if (w >= e.wallStart && w < e.wallEnd) return e.virtualStart + (w - e.wallStart);
    }
    for (const e of domain) {
      if (Math.abs(w - e.wallEnd) < EPS_TINY) return e.virtualEnd;
    }
    if (w <= domain[0].wallStart) return 0;
    if (w >= domain[domain.length - 1].wallEnd) return totalDuration;
    // In a compressed backbone gap (no extension): snap to the boundary point.
    for (let i = 0; i < domain.length - 1; i++) {
      if (w > domain[i].wallEnd && w < domain[i + 1].wallStart) return domain[i + 1].virtualStart;
    }
    return 0;
  }

  const laneRank = (seq) => laneOf.get(seq) ?? Infinity;

  function ownerSequenceAtVirtual(t) {
    const clamped = Math.max(0, Math.min(t, totalDuration));
    for (let i = 0; i < domain.length; i++) {
      const e = domain[i];
      const isLast = i === domain.length - 1;
      if (clamped >= e.virtualStart && (isLast ? clamped <= e.virtualEnd : clamped < e.virtualEnd)) {
        return e.type === 'video' ? e.sequence : e.sourceSequence;
      }
    }
    return domain.length ? (domain[0].type === 'video' ? domain[0].sequence : domain[0].sourceSequence) : null;
  }

  function sourcesAt(t) {
    const w = virtualToWall(t);
    return videos
      .filter((v) => w >= v.start - OVERLAP_EPSILON_S && w < v.end)
      .sort((a, b) => laneRank(a.sequence) - laneRank(b.sequence) || a.sequence - b.sequence)
      .map((v) => v.sequence);
  }

  function virtualToSource(t, activeSequence) {
    const w = virtualToWall(t);
    let seq = activeSequence;
    const av = seq != null ? videoBySeq.get(seq) : null;
    const activeCovers = av && w >= av.start - OVERLAP_EPSILON_S && w < av.end;
    if (!activeCovers) seq = ownerSequenceAtVirtual(t);
    const v = videoBySeq.get(seq);
    if (!v) return { sequence: seq ?? null, fileTime: 0 };
    const fileTime = Math.max(0, Math.min(w - v.offset, v.duration));
    return { sequence: seq, fileTime };
  }

  function clampToSource(t, sequence) {
    const v = videoBySeq.get(sequence);
    if (!v) return t;
    const w = Math.max(v.start, Math.min(virtualToWall(t), v.end - EPS_TINY));
    return wallToVirtual(w);
  }

  // ---- lanes / angles views ----
  const domainVideoBySeq = new Map(
    domain.filter((e) => e.type === 'video').map((e) => [e.sequence, e]),
  );
  const lanes = [
    backbone.map((v) => {
      const e = domainVideoBySeq.get(v.sequence);
      return { sequence: v.sequence, virtualStart: e.virtualStart, virtualEnd: e.virtualEnd };
    }),
  ];
  const maxAngleLane = angleVideos.reduce((m, v) => Math.max(m, laneOf.get(v.sequence)), 0);
  for (let k = 1; k <= maxAngleLane; k++) {
    lanes[k] = angleVideos
      .filter((v) => laneOf.get(v.sequence) === k)
      .map((v) => ({
        sequence: v.sequence,
        virtualStart: wallToVirtual(v.start),
        virtualEnd: wallToVirtual(v.end),
      }))
      .sort((a, b) => a.virtualStart - b.virtualStart);
  }

  const angles = angleVideos.map((v, idx) => {
    const stem = filenameStem(v.url);
    return {
      sequence: v.sequence,
      lane: laneOf.get(v.sequence),
      virtualStart: wallToVirtual(v.start),
      virtualEnd: wallToVirtual(v.end),
      name: stem ? middleEllipsis(stem, 14) : `Extra clip ${idx + 1}`,
    };
  });

  return {
    domain,
    lanes,
    angles,
    virtualToWall,
    wallToVirtual,
    virtualToSource,
    sourcesAt,
    clampToSource,
    totalDuration,
  };
}

export default useVirtualTimeline;
