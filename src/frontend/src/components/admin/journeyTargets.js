import { fmtPct } from './formatNumber';

// T14900: the one home of the Journey targets, baselines and small-N floor. Keyed by the
// frozen stage keys of JOURNEY_LADDER (analytics.py); journeyTargets.test.js fails if a
// ladder stage has no entry.
//
// `target` is the "after the UI fixes" column of the 2026-11-03 roadmap table, `baseline` the
// measured value of that day: a dated snapshot, never derived from live data. When the
// targets move, change this table in a commit that says why.
//
// The roadmap's nine steps partition the ladder, so a step may span stages (`via`) that have
// no target of their own: they count toward the step they sit inside.

export const SMALL_N_FLOOR = 20; // same value as the backend MIN_JUDGED_FOR_PERCENT
export const BASELINE_DATE = '2026-11-03';
export const TERMINAL_STAGE = 'took_away';
export const END_TO_END_KEY = 'signed_up->took_away';

export const JOURNEY_TARGETS = {
  'signed_up->started': { from: 'signed_up', to: 'started', baseline: 88, target: 92 },
  'started->add_footage': { from: 'started', to: 'add_footage', baseline: 83, target: 88 },
  'add_footage->footage_landed': { from: 'add_footage', via: ['file_picked', 'upload_started'], to: 'footage_landed', baseline: 66, target: 78 },
  'footage_landed->clipped': { from: 'footage_landed', to: 'clipped', baseline: 78, target: 85 },
  'clipped->frame_opened': { from: 'clipped', to: 'frame_opened', baseline: 62, target: 78 },
  'frame_opened->framed': { from: 'frame_opened', to: 'framed', baseline: 87, target: 92 },
  'framed->exported': { from: 'framed', via: ['export_pressed'], to: 'exported', baseline: 45, target: 65 },
  'exported->finished': { from: 'exported', via: ['spotlight_opened', 'spotlight_added'], to: 'finished', baseline: 95, target: 96 },
  'finished->took_away': { from: 'finished', via: ['watched'], to: 'took_away', baseline: 58, target: 80 },
  'signed_up->took_away': { from: 'signed_up', to: 'took_away', baseline: 4, target: 18 },
};

// Hex for the SVG map, classes for chips: the admin palette's green / amber / red / gray 400.
export const RAG_STYLES = {
  green: { fill: '#4ade80', chip: 'text-green-400 border-green-400', word: 'at target' },
  yellow: { fill: '#fbbf24', chip: 'text-amber-400 border-amber-400', word: 'improving' },
  red: { fill: '#f87171', chip: 'text-red-400 border-red-400', word: `below ${BASELINE_DATE} baseline` },
  grey: { fill: '#9ca3af', chip: 'text-gray-400 border-dashed border-gray-400', word: 'too few users' },
  partial: { fill: '#9ca3af', chip: 'text-gray-400 border-dashed border-gray-400', word: 'partial data' },
};

const SEVERITY = ['red', 'yellow', 'green', 'grey', 'partial'];

function targetOf(key) {
  const entry = JOURNEY_TARGETS[key];
  if (!entry) throw new Error(`journeyTargets: no target for transition ${key}`);
  return entry;
}

// n: the users the rate is judged on. Under the floor nothing gets a colour.
export function ragFor(key, rate, n) {
  const { baseline, target } = targetOf(key);
  if (n < SMALL_N_FLOOR) return 'grey';
  if (rate >= target) return 'green';
  return rate >= baseline ? 'yellow' : 'red';
}

// The step a stage belongs to (the one that leaves it, or spans it); null for the last stage.
export function stageTransition(stage) {
  if (stage === TERMINAL_STAGE) return null;
  const hit = Object.entries(JOURNEY_TARGETS).find(([key, t]) => key !== END_TO_END_KEY
    && (t.from === stage || (t.via || []).includes(stage)));
  if (!hit) throw new Error(`journeyTargets: no target for stage ${stage}`);
  return hit[0];
}

// Generalises the backend continue rate to a span: the users who got to `to`, over the users
// who entered `from` minus everyone still in window on the way (pending, not judged). Only
// the two ends decide partial: with implied reach (T14720) inner stages don't move the rate.
function measure(key, nodes) {
  const t = targetOf(key);
  const i = nodes.findIndex(n => n.key === t.from);
  const j = nodes.findIndex(n => n.key === t.to);
  const from = nodes[i];
  const to = nodes[j];
  const pending = nodes.slice(i, j).reduce((sum, n) => sum + n.in_window, 0);
  const n = from.reached - pending;
  const k = to.reached;
  const pct = n >= SMALL_N_FLOOR ? Math.round((10000 * k) / n) / 100 : null;
  const unmeasured = [from, to].filter(s => s.partial_from || s.no_data);
  const rag = unmeasured.length ? 'partial' : ragFor(key, pct, n);
  return { key, from: t.from, to: t.to, label: `${from.label} to ${to.label}`, baseline: t.baseline,
    target: t.target, k, n, pct, rag, partialFrom: unmeasured.map(s => s.partial_from).find(Boolean) || null };
}

// Every step whose two ends are in the payload, in ladder order.
export function journeyTransitions(nodes) {
  for (const n of nodes) stageTransition(n.key);
  const present = new Set(nodes.map(n => n.key));
  return Object.keys(JOURNEY_TARGETS)
    .filter(key => key !== END_TO_END_KEY && present.has(JOURNEY_TARGETS[key].from) && present.has(JOURNEY_TARGETS[key].to))
    .map(key => measure(key, nodes));
}

// Null when the payload lacks either end, like a step in journeyTransitions.
export function endToEndTransition(nodes) {
  const { from, to } = JOURNEY_TARGETS[END_TO_END_KEY];
  const present = new Set(nodes.map(n => n.key));
  return present.has(from) && present.has(to) ? measure(END_TO_END_KEY, nodes) : null;
}

// The one to look at first: worst colour, then the furthest from its target.
export function worstTransition(transitions) {
  const rank = t => SEVERITY.indexOf(t.rag);
  return [...transitions].sort((a, b) => rank(a) - rank(b) || (a.pct - a.target) - (b.pct - b.target))[0];
}

// A collapsed group's mark. A colour claims every folded step was judged, so one partial or
// under-floor step takes the colour away; the worst measured rate stays readable in the text.
export function foldedMark(transitions) {
  const measured = transitions.filter(t => t.rag !== 'partial' && t.rag !== 'grey');
  const worst = measured.length ? worstTransition(measured) : null;
  const unmeasured = transitions.find(t => t.rag === 'partial') || transitions.find(t => t.rag === 'grey');
  if (!unmeasured) return { rag: worst.rag, text: `worst ${transitionMark(worst)}` };
  const mark = transitionMark(unmeasured);
  return { rag: unmeasured.rag, text: worst ? `${mark}, worst ${transitionMark(worst)}` : mark };
}

// The short mark on the map.
export function transitionMark(t) {
  if (t.rag === 'partial') return 'partial';
  return t.rag === 'grey' ? `n < ${SMALL_N_FLOOR}` : fmtPct(t.pct);
}

// The chip sentence: "62.00% of 143, target 78.00%".
export function transitionChipText(t) {
  const goal = `target ${fmtPct(t.target)}`;
  if (t.rag === 'partial') return `partial data${t.partialFrom ? ` from ${t.partialFrom}` : ''}, ${goal}`;
  if (t.rag === 'grey') return `n < ${SMALL_N_FLOOR} (${t.k} of ${t.n}), ${goal}`;
  return `${fmtPct(t.pct)} of ${t.n}, ${goal}`;
}
