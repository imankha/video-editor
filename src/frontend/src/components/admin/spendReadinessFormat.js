import { fmt2, fmtPct } from './formatNumber';

// T14910: how a gate's unit prints. Admin rule: every non-count number has 2 decimals, so
// the K-factor ratio prints as "per 100 sign-ups" instead of a 3-decimal fraction.
export const money = cents => `$${fmt2(cents / 100)}`;

export function fmtGateValue(unit, value) {
  if (value == null) return 'no data';
  switch (unit) {
    case 'pct': return fmtPct(value);
    case 'per100': return `${fmt2(value)} per 100`;
    case 'cents': return money(value);
    case 'ratio': return `${fmt2(value * 100)} per 100`;
    case 'counts': return `${value.paywall_users} paywall, ${value.buyers} bought`;
    default: return fmt2(value);
  }
}

export const fmtInterval = (unit, interval) =>
  (interval ? `${fmtGateValue(unit, interval[0])} to ${fmtGateValue(unit, interval[1])}` : null);

// The chip's figure: the value when coloured, the count under the floor.
export function gateChipText(gate) {
  if (gate.rag !== 'grey') return fmtGateValue(gate.unit, gate.value);
  if (gate.kind === 'mean' && gate.value != null) return fmtGateValue(gate.unit, gate.value);
  if (gate.kind === 'proportion' && gate.n > 0) return `${gate.k} of ${gate.n}`;
  return 'no data';
}

export const CHANNEL_RAG = { GO: 'green', TEST: 'yellow', NO: 'red', grey: 'grey' };
