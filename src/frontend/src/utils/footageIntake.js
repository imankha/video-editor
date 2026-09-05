/**
 * T8800 — Footage intake logic (pure functions).
 *
 * Turns an arbitrary pile of dropped files into an ordered, trustworthy timeline
 * plan: filter junk, keep .LRF proxies, and infer play order from embedded
 * recording time (with a filename fallback). No UI, no network — the pure brain
 * that useFootageIntake and the intake UI (T8810/T8820) render.
 *
 * Ordering rule (EPIC decision 1): sort by embedded recording time and sanity-
 * check the chain; a chain that overlaps means the timestamps are export times,
 * so they are discarded WHOLESALE in favour of filename heuristics; if those are
 * inconclusive, natural name order with a "please check" (unknown) confidence.
 */

// If the next segment starts within this many seconds of where the previous one
// ended, the timeline chain is still considered continuous (small clock skew /
// rounding between camera segments).
export const CHAIN_TOLERANCE_S = 120;

// A silent stretch longer than this between two continuous segments is surfaced
// as a labelled gap ("9 min break").
export const GAP_MIN_S = 120;

// Silently excluded, disclosed in the quiet gray line (EPIC decision 2).
const JUNK_EXTENSIONS = ['lrf', 'thm', 'srt', 'jpg', 'jpeg', 'png', 'heic', 'gif'];

// Accepted video containers when the browser reports an empty MIME type.
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];

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

// --- Filename heuristics (used only after timestamps are discarded) ---------

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

function _orderByCounter(items) {
  const parsed = items.map((it) => ({ it, c: _trailingCounter(it.name) }));
  if (parsed.some((x) => !x.c)) return null;
  if (new Set(parsed.map((x) => x.c.prefix)).size !== 1) return null; // prefixes must match
  const nums = parsed.map((x) => x.c.num);
  if (new Set(nums).size !== nums.length) return null; // distinct counters required
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

/**
 * Decide play order and confidence for a set of probed items.
 *
 * @param {Array<{name:string, duration:number, creationTime:Date|null}>} items
 * @returns {{order: Array, confidence: 'time'|'name'|'unknown', gaps: Array<{afterIndex:number, seconds:number}>}}
 */
export function inferOrder(items) {
  const list = Array.from(items || []);
  if (list.length === 0) return { order: [], confidence: 'unknown', gaps: [] };

  // Tier 1: embedded recording time, if every item has one and the chain holds.
  if (_allHaveTime(list)) {
    const sorted = list.slice().sort((a, b) => _startSeconds(a) - _startSeconds(b));
    let chainValid = true;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = _startSeconds(sorted[i - 1]) + sorted[i - 1].duration;
      if (_startSeconds(sorted[i]) < prevEnd - CHAIN_TOLERANCE_S) {
        chainValid = false; // overlap beyond tolerance -> these are export times
        break;
      }
    }
    if (chainValid) {
      const gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const prevEnd = _startSeconds(sorted[i - 1]) + sorted[i - 1].duration;
        const gap = _startSeconds(sorted[i]) - prevEnd;
        if (gap > GAP_MIN_S) gaps.push({ afterIndex: i - 1, seconds: gap });
      }
      return { order: sorted, confidence: 'time', gaps };
    }
    // Chain overlaps -> discard timestamps WHOLESALE, fall through to names.
  }

  // Tier 2: filename heuristics, in order of trustworthiness.
  const byName = _orderByHalfWords(list) || _orderByCounter(list) || _orderByDate(list);
  if (byName) return { order: byName, confidence: 'name', gaps: [] };

  // Tier 3: nothing decisive -> natural name order, ask the user to check.
  return { order: _naturalSort(list), confidence: 'unknown', gaps: [] };
}

/** Merge key for add-more dedupe: same name + size + duration is the same file. */
export function dedupeKey(item) {
  return `${item.name}|${item.size ?? ''}|${item.duration ?? ''}`;
}
