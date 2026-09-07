/**
 * T8800/T8824 — Footage intake logic (pure functions).
 *
 * Turns an arbitrary pile of dropped files into a placement plan: filter junk,
 * keep .LRF proxies, and infer PLAY ORDER + PLACEMENT MODE from embedded
 * recording time (with a filename fallback). No UI, no network — the pure
 * brain that useFootageIntake and the intake UI (T8810/T8820/T8824) render.
 *
 * Placement rule (EPIC decision 1, amended by T8824 — see
 * docs/plans/tasks/T8824-design.md §2.3): sort by embedded recording time.
 * Files whose spans OVERLAP (beyond OVERLAP_EPSILON_S, the same tolerance
 * Annotate uses) are CLASSIFIED, not discarded wholesale: recording-split
 * slop, a one-recording naming scheme, or a clock outside the backend's 12h
 * placement window means the timestamps are export artifacts -> place
 * sequentially by filename heuristics and send NO recorded_at; a different
 * camera family or a contained short clip means the overlap is REAL -> place
 * by the clock and show the files as angles (lanes 1+, via the shared
 * laneAssignment module Annotate also uses). Anything else asks one plain
 * question with the sequential (safe) answer preselected. Timestamps are
 * sent for ALL files or NONE — never a mix (the backend places timed videos
 * on the wall clock and untimed ones by prefix-sum; see games.py
 * compute_video_offsets). NEVER block submit on ambiguity.
 */
import { intervalsOverlap, assignLanes } from './laneAssignment.js';

// If the next segment starts within this many seconds of where the previous one
// ended AND within SLOP_MAX_FRACTION of the shorter file's duration, the overlap
// is recording-split slop (clock skew / rounding between camera segments), not a
// second camera — A0 in the design doc's disambiguation table.
export const SLOP_MAX_S = 120;
export const SLOP_MAX_FRACTION = 0.5;

// A short file wholly inside a much longer one reads as a second camera (A3): one
// recording cannot contain another segment of itself.
export const CONTAINMENT_RATIO = 3;

// Mirrors games.py's PLACEMENT_WINDOW_H (12h): a clock further than this from the
// set's own zero is treated as garbage/export-time evidence, exactly like the
// backend would place it (prefix-sum, not wall-clock).
export const PLACEMENT_WINDOW_S = 12 * 60 * 60;

// A silent stretch longer than this between two continuous backbone segments is
// surfaced as a labelled gap ("9 min break").
export const GAP_MIN_S = 120;

// Silently excluded, disclosed in the quiet gray line (EPIC decision 2).
const JUNK_EXTENSIONS = ['lrf', 'thm', 'srt', 'jpg', 'jpeg', 'png', 'heic', 'gif'];

// Accepted video containers when the browser reports an empty MIME type.
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

// Containment comparisons on real (float) seconds need a tiny tolerance, distinct
// from the recording-split OVERLAP_EPSILON_S (a UX-scale 1s slop allowance).
const CONTAINMENT_EPS_S = 1e-6;

/** Lowercase extension (no dot), or '' when there is none. */
function _ext(name) {
  const n = (name || '').toLowerCase();
  const dot = n.lastIndexOf('.');
  return dot >= 0 ? n.slice(dot + 1) : '';
}

/** Filename without its extension. */
function _basename(name) {
  const n = name || '';
  const dot = n.lastIndexOf('.');
  return dot >= 0 ? n.slice(0, dot) : n;
}

/**
 * Junk that should never reach the timeline: proxy/subtitle/thumbnail sidecars,
 * images, hidden/AppleDouble files, and zero-byte files. Case-insensitive.
 */
export function isJunkFile(file) {
  const name = file?.name || '';
  // Hidden dotfiles and AppleDouble (._foo) resource forks.
  if (name.startsWith('.')) return true;
  if (file?.size === 0) return true;
  return JUNK_EXTENSIONS.includes(_ext(name));
}

/**
 * A real video we can upload. Accept anything with a `video/*` MIME, and — when
 * the MIME is empty (folder drops routinely report '') — fall back to a known
 * video extension. The empty-MIME fallback is REQUIRED, not defensive.
 */
export function isVideoFile(file) {
  const type = file?.type || '';
  if (type.startsWith('video/')) return true;
  if (type === '') return VIDEO_EXTENSIONS.includes(_ext(file?.name));
  return false;
}

/**
 * Split files into uploadable videos and their .LRF preview proxies.
 * An .LRF whose basename matches an accepted video is moved into `proxies`,
 * keyed by that video's full name (kept client-side for the shrink crop preview
 * in T8850, never uploaded). Unmatched .LRF files are simply dropped by callers.
 *
 * @returns {{videos: File[], proxies: Object<string, File>}}
 */
export function pairProxies(files) {
  const list = Array.from(files || []);
  const videos = list.filter(isVideoFile);
  const byBase = new Map();
  for (const v of videos) byBase.set(_basename(v.name).toLowerCase(), v);

  const proxies = {};
  for (const f of list) {
    if (_ext(f?.name) !== 'lrf') continue;
    const match = byBase.get(_basename(f.name).toLowerCase());
    if (match) proxies[match.name] = f;
  }
  return { videos, proxies };
}

/** Start of an item on the wall clock, in seconds (assumes creationTime present). */
function _startSeconds(item) {
  return item.creationTime.getTime() / 1000;
}

/** True when every item carries a usable embedded recording time. */
function _allHaveTime(items) {
  return items.every(
    (it) => it.creationTime instanceof Date && !Number.isNaN(it.creationTime.getTime())
  );
}

// --- Filename heuristics (used for 'sequence'-mode ordering and as the A1 signal) --

/** Rank a "1st half / 2nd half" style name; null when it is not a half word. */
function _halfWordRank(name) {
  const l = (name || '').toLowerCase();
  if (!l.includes('half')) return null; // require "half" nearby to avoid false hits
  if (/(^|[^a-z0-9])(1st|first)([^a-z0-9]|$)/.test(l)) return 0;
  if (/(^|[^a-z0-9])(2nd|second)([^a-z0-9]|$)/.test(l)) return 1;
  if (/(^|[^a-z0-9])(3rd|third)([^a-z0-9]|$)/.test(l)) return 2;
  if (/(^|[^a-z0-9])(4th|fourth)([^a-z0-9]|$)/.test(l)) return 3;
  return null;
}

function _orderByHalfWords(items) {
  const ranked = items.map((it) => ({ it, rank: _halfWordRank(it.name) }));
  if (ranked.some((r) => r.rank === null)) return null;
  const ranks = ranked.map((r) => r.rank);
  if (new Set(ranks).size !== ranks.length) return null; // not a strict order -> not decisive
  return ranked.slice().sort((a, b) => a.rank - b.rank).map((r) => r.it);
}

/** Shared prefix + trailing counter, e.g. DJI_0231 < DJI_0232, "clip (2)". */
function _trailingCounter(name) {
  const base = _basename(name);
  const m = base.match(/(\d+)\D*$/); // last run of digits near the end
  if (!m) return null;
  return { prefix: base.slice(0, m.index).toLowerCase(), num: parseInt(m[1], 10) };
}

/**
 * Shared prefix + CONSECUTIVE trailing counters, e.g. DJI_0231/0232/0233. T8824:
 * gained the consecutive requirement — a merely-distinct counter (VID_..._094101 /
 * VID_..._101533, two different phones both auto-naming from their own clocks) is
 * NOT decisive one-recording evidence; camera segmentation actually produces
 * consecutive integers, so only that pattern votes as a naming signal (design doc
 * §2.3's rejected-signals note).
 */
function _orderByCounter(items) {
  const parsed = items.map((it) => ({ it, c: _trailingCounter(it.name) }));
  if (parsed.some((x) => !x.c)) return null;
  if (new Set(parsed.map((x) => x.c.prefix)).size !== 1) return null; // prefixes must match
  const nums = parsed.map((x) => x.c.num);
  if (new Set(nums).size !== nums.length) return null; // distinct counters required
  const sortedNums = nums.slice().sort((a, b) => a - b);
  for (let i = 1; i < sortedNums.length; i++) {
    if (sortedNums[i] !== sortedNums[i - 1] + 1) return null; // must be consecutive
  }
  return parsed.slice().sort((a, b) => a.c.num - b.c.num).map((x) => x.it);
}

/** A full date (optionally with a time) embedded in the name, e.g. 20260905_094101. */
function _dateKey(name) {
  const m = (name || '').match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})(?:[-_ ]?(\d{2})(\d{2})(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h = '00', mi = '00', s = '00'] = m;
  return `${y}${mo}${d}${h}${mi}${s}`;
}

function _orderByDate(items) {
  const parsed = items.map((it) => ({ it, key: _dateKey(it.name) }));
  if (parsed.some((x) => x.key === null)) return null;
  if (new Set(parsed.map((x) => x.key)).size !== parsed.length) return null; // distinct dates
  return parsed.slice().sort((a, b) => a.key.localeCompare(b.key)).map((x) => x.it);
}

/** Natural (numeric-aware) name sort — the last-resort "please check" order. */
function _naturalSort(items) {
  return items
    .slice()
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
}

/** Merge key for add-more dedupe: same name + size + duration is the same file. */
export function dedupeKey(item) {
  return `${item.name}|${item.size ?? ''}|${item.duration ?? ''}`;
}

// --- Overlap classification (T8824 §2.3) ------------------------------------

/** Union-find connected components over item intervals, at Annotate's epsilon. */
function _overlapComponents(intervals) {
  const n = intervals.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (intervalsOverlap(intervals[i], intervals[j])) union(i, j);
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(intervals[i]);
  }
  return [...groups.values()];
}

/** A0 — every overlap in the component is small AND a minority of the shorter file. */
function _isSlop(component) {
  for (let i = 0; i < component.length; i++) {
    for (let j = i + 1; j < component.length; j++) {
      const a = component[i];
      const b = component[j];
      if (!intervalsOverlap(a, b)) continue;
      const overlapSec = Math.min(a.end, b.end) - Math.max(a.start, b.start);
      const shorterDuration = Math.min(a.item.duration || 0, b.item.duration || 0);
      if (overlapSec > SLOP_MAX_S) return false;
      if (shorterDuration > 0 && overlapSec > shorterDuration * SLOP_MAX_FRACTION) return false;
    }
  }
  return true;
}

/** A1 — a decisive one-recording naming scheme over the WHOLE component. */
function _hasOneRecordingNames(component) {
  const items = component.map((c) => c.item);
  return !!(_orderByHalfWords(items) || _orderByCounter(items));
}

/** Resolution + container only (T8824 Q6 — no codec/fps probing). */
function _familyKey(item) {
  return `${item.width || 0}x${item.height || 0}|${_ext(item.name)}`;
}

/** A2 — some overlapping pair is a different camera family. */
function _hasDifferentFamily(component) {
  for (let i = 0; i < component.length; i++) {
    for (let j = i + 1; j < component.length; j++) {
      if (!intervalsOverlap(component[i], component[j])) continue;
      if (_familyKey(component[i].item) !== _familyKey(component[j].item)) return true;
    }
  }
  return false;
}

/** A3 — some pair is wholly contained AND the longer is CONTAINMENT_RATIO+ longer. */
function _hasContainment(component) {
  for (let i = 0; i < component.length; i++) {
    for (let j = 0; j < component.length; j++) {
      if (i === j) continue;
      const outer = component[i];
      const inner = component[j];
      if (inner.start >= outer.start - CONTAINMENT_EPS_S && inner.end <= outer.end + CONTAINMENT_EPS_S) {
        const shorter = inner.item.duration || 0;
        const longer = outer.item.duration || 0;
        if (shorter > 0 && longer >= shorter * CONTAINMENT_RATIO) return true;
      }
    }
  }
  return false;
}

/** Classify one connected overlap component: 'ARTIFACT' | 'ANGLE' | 'ASK'. */
function _classifyComponent(component) {
  if (_isSlop(component)) return 'ARTIFACT'; // A0
  if (_hasOneRecordingNames(component)) return 'ARTIFACT'; // A1
  if (_hasDifferentFamily(component)) return 'ANGLE'; // A2
  if (_hasContainment(component)) return 'ANGLE'; // A3
  return 'ASK'; // A4
}

/** First genuinely-overlapping pair in an ASK component, for the plain question. */
function _questionFor(component) {
  for (let i = 0; i < component.length; i++) {
    for (let j = i + 1; j < component.length; j++) {
      if (intervalsOverlap(component[i], component[j])) {
        return { a: component[i].item, b: component[j].item };
      }
    }
  }
  return null;
}

// --- Placement modes ----------------------------------------------------------

/** Lane-0-only placement: prefix-sum offsets by the given order. */
function _finishSequence(order, confidence, gaps, question = null) {
  let acc = 0;
  const lane0 = order.map((item) => {
    const offsetSeconds = acc;
    acc += item.duration || 0;
    return { item, offsetSeconds, endSeconds: acc, lane: 0 };
  });
  return { order, confidence, gaps, placement: 'sequence', lanes: order.length ? [lane0] : [], spanSeconds: acc, question };
}

/**
 * 'sequence' mode: exactly one lane. `keepTimeOrder` preserves the clock-sorted
 * order + green trust line for a slop-only overlap (Q4 — the clock is true
 * evidence even though placement is sequential); otherwise falls back to the
 * same filename-heuristic cascade the no-clock path always used.
 */
function _sequenceMode(list, { keepTimeOrder = false, question = null } = {}) {
  if (keepTimeOrder) {
    const order = list.slice().sort((a, b) => _startSeconds(a) - _startSeconds(b));
    return _finishSequence(order, 'time', [], question);
  }
  const byName = _orderByHalfWords(list) || _orderByCounter(list) || _orderByDate(list);
  if (byName) return _finishSequence(byName, 'name', [], question);
  return _finishSequence(_naturalSort(list), 'unknown', [], question);
}

/**
 * 'time' mode: lanes via the SAME assignLanes Annotate uses (invariant P — see
 * design doc §2.1), lane 0 = backbone. Real gaps are computed only within lane 0,
 * since only there do offsets reflect genuine wall-clock silence.
 */
function _timeMode(list) {
  const zero = Math.min(...list.map(_startSeconds));
  const intervals = list.map((it) => {
    const offsetSeconds = _startSeconds(it) - zero;
    const duration = it.duration || 0;
    return { key: dedupeKey(it), start: offsetSeconds, end: offsetSeconds + duration, duration, item: it };
  });
  const { laneOf } = assignLanes(intervals.map(({ key, start, end, duration }) => ({ key, start, end, duration })));
  const laneCount = intervals.length
    ? Math.max(...intervals.map((iv) => laneOf.get(iv.key) ?? 0)) + 1
    : 0;
  const lanes = Array.from({ length: laneCount }, () => []);
  for (const iv of intervals) {
    const lane = laneOf.get(iv.key) ?? 0;
    lanes[lane].push({ item: iv.item, offsetSeconds: iv.start, endSeconds: iv.end, lane });
  }
  for (const lane of lanes) {
    lane.sort((a, b) => a.offsetSeconds - b.offsetSeconds || a.item.name.localeCompare(b.item.name));
  }

  const gaps = [];
  const lane0 = lanes[0] || [];
  for (let i = 1; i < lane0.length; i++) {
    const gap = lane0[i].offsetSeconds - lane0[i - 1].endSeconds;
    if (gap > GAP_MIN_S) gaps.push({ afterIndex: i - 1, seconds: gap });
  }

  const spanSeconds = intervals.length ? Math.max(...intervals.map((iv) => iv.end)) : 0;
  const order = lanes
    .flat()
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds || a.lane - b.lane || a.item.name.localeCompare(b.item.name))
    .map((p) => p.item);

  return { order, confidence: 'time', gaps, placement: 'time', lanes, spanSeconds, question: null };
}

/**
 * Decide play order, confidence, placement mode and lanes for a set of probed
 * items. See docs/plans/tasks/T8824-design.md §2.3 for the full disambiguation
 * rule this implements (fixture table in §2.4).
 *
 * @param {Array<{name:string, duration:number, creationTime:Date|null, width?:number, height?:number}>} items
 * @param {{override?: 'time'|'sequence'|null, manualNames?: string[]|null}} [opts]
 * @returns {{
 *   order: Array, confidence: 'time'|'name'|'unknown'|'manual', gaps: Array<{afterIndex:number, seconds:number}>,
 *   placement: 'time'|'sequence', lanes: Array<Array<{item:Object, offsetSeconds:number, endSeconds:number, lane:number}>>,
 *   spanSeconds: number, question: null|{a:Object, b:Object},
 * }}
 */
export function inferPlacement(items, { override = null, manualNames = null } = {}) {
  const list = Array.from(items || []);
  if (list.length === 0) {
    return { order: [], confidence: 'unknown', gaps: [], placement: 'sequence', lanes: [], spanSeconds: 0, question: null };
  }

  // The user's hand-ordering always wins outright — folds everything (backbone
  // AND any angles) into one sequential lane. See useFootageIntake's
  // setManualOrder: it already includes every item's name, angles included.
  if (manualNames) {
    const byName = new Map(list.map((it) => [it.name, it]));
    const order = manualNames.map((n) => byName.get(n)).filter(Boolean);
    return _finishSequence(order, 'manual', []);
  }

  // Rule 0: no clock at all -> today's behaviour, unchanged.
  if (!_allHaveTime(list)) {
    return _sequenceMode(list, {});
  }

  // Rule 1: mirror the backend's placement window (games.py PLACEMENT_WINDOW_H).
  const zero = Math.min(...list.map(_startSeconds));
  const maxOffset = Math.max(...list.map((it) => _startSeconds(it) - zero));
  if (maxOffset > PLACEMENT_WINDOW_S) {
    return _sequenceMode(list, {});
  }

  // Rule 2: overlap graph, at Annotate's epsilon (never the old 120s "chain" check).
  const intervals = list.map((it) => ({
    item: it,
    start: _startSeconds(it),
    end: _startSeconds(it) + (it.duration || 0),
  }));
  const overlapping = _overlapComponents(intervals).filter((c) => c.length > 1);

  if (overlapping.length === 0) {
    return _timeMode(list);
  }

  // Rule 3: classify each connected component of the overlap graph.
  const verdicts = overlapping.map((component) => ({ component, verdict: _classifyComponent(component) }));

  // Rule 4: the SET decides (invariant P — one axis or none).
  const allAngle = verdicts.every((v) => v.verdict === 'ANGLE');
  const askEntry = verdicts.find((v) => v.verdict === 'ASK');
  const auto = allAngle ? 'time' : 'sequence';

  // Rule 5: the user always wins.
  const placement = override ?? auto;

  if (placement === 'time') {
    return _timeMode(list);
  }

  // A resolved override answers the question; only show it while undecided.
  const question = !override && askEntry ? _questionFor(askEntry.component) : null;
  const isSlopOnly = verdicts.every((v) => v.verdict !== 'ASK' && _isSlop(v.component));
  return _sequenceMode(list, { keepTimeOrder: isSlopOnly, question });
}
