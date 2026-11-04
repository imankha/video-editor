import { describe, it, expect } from 'vitest';

import { collapseJourney, journeyGroups, groupOfStage } from './journeyFold';

// The 14-stage ladder as the endpoint returns it (key, band, major).
const LADDER = [
  ['signed_up', 'get', true], ['started', 'get'], ['add_footage', 'get'], ['footage_landed', 'get'],
  ['clipped', 'get', true], ['frame_opened', 'make'], ['framed', 'make'], ['export_pressed', 'make'],
  ['exported', 'make', true], ['spotlight_opened', 'make'], ['spotlight_added', 'make'],
  ['finished', 'make', true], ['watched', 'take'], ['took_away', 'take', true],
];
const KEYS = LADDER.map(l => l[0]);

// Build nodes + neighbour edges from explicit per-user paths, the same fold the backend does
// over pattern rows (T14720): a user counts at every stage up to their furthest, the furthest
// stage carries the outcome, and only neighbours are joined.
// paths: [[[stage keys...], outcome, count], ...]; signed_up implicit.
function foldPaths(paths) {
  const nodes = LADDER.map(([key, band, major]) => ({
    key, label: key, band, major: !!major, reached: 0, continued: 0, in_window: 0, stuck: 0, gone: 0,
  }));
  const edges = new Map();
  for (const [stages, outcome, n] of paths) {
    const furthest = Math.max(0, ...stages.map(k => KEYS.indexOf(k)));
    for (let i = 0; i <= furthest; i++) nodes[i].reached += n;
    nodes[furthest][outcome] += n;
    for (let i = 0; i < furthest; i++) {
      const e = edges.get(i) || { from: KEYS[i], to: KEYS[i + 1], users: 0 };
      e.users += n;
      edges.set(i, e);
    }
  }
  for (const nd of nodes) nd.continued = nd.reached - nd.in_window - nd.stuck - nd.gone;
  return { nodes, edges: [...edges.values()] };
}

const FULL = ['started', 'add_footage', 'footage_landed', 'clipped', 'frame_opened', 'framed',
  'export_pressed', 'exported', 'spotlight_opened', 'spotlight_added', 'finished', 'watched', 'took_away'];
const upTo = k => FULL.slice(0, FULL.indexOf(k) + 1);

// Full paths, plus both real paths with missing stages: shared-in (Started to clipped) and
// Finish Now (exported to finished). Those users still count at the stages they skipped.
const NORMAL = [
  [[], 'gone', 14],
  [upTo('started'), 'stuck', 9],
  [upTo('add_footage'), 'gone', 12],
  [upTo('footage_landed'), 'in_window', 2],
  [upTo('clipped'), 'stuck', 5],
  [['started', 'clipped', 'frame_opened'], 'stuck', 2], // shared-in
  [upTo('framed'), 'gone', 3],
  [upTo('export_pressed'), 'stuck', 1],
  [upTo('exported'), 'gone', 2],
  [[...upTo('exported'), 'finished', 'took_away'], 'stuck', 4], // Finish Now
  [upTo('spotlight_added'), 'in_window', 1],
  [upTo('watched'), 'stuck', 1],
  [FULL, 'stuck', 6],
];

const DROPS = ['in_window', 'stuck', 'gone'];
const byKey = (items, k) => items.find(i => i.key === k);
const out = (edges, k) => edges.filter(e => e.from === k).reduce((s, e) => s + e.users, 0);
const into = (edges, k) => edges.filter(e => e.to === k).reduce((s, e) => s + e.users, 0);
const dropsOf = it => DROPS.reduce((s, d) => s + it[d], 0);

describe('journeyFold (T14010 progressive disclosure)', () => {
  it('groups the stages between the five majors', () => {
    const { nodes } = foldPaths(NORMAL);
    expect(journeyGroups(nodes).map(g => [g.key, g.hidden.length])).toEqual([
      ['signed_up..clipped', 3], ['clipped..exported', 3], ['exported..finished', 2], ['finished..took_away', 1],
    ]);
    expect(groupOfStage(nodes, 'framed').key).toBe('clipped..exported');
    expect(groupOfStage(nodes, 'exported')).toBeNull();
  });

  it('default view: majors plus one collapsed group per gap, with a stage-count label', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const { items } = collapseJourney(nodes, edges);
    expect(items.map(i => (i.kind === 'group' ? i.label : i.key))).toEqual([
      'signed_up', '+3 stages', 'clipped', '+3 stages', 'exported', '+2 stages', 'finished', '+1 stage', 'took_away',
    ]);
  });

  it('for every collapsed group: major.reached = ribbon_out + sum(hidden drops) + own drops', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const c = collapseJourney(nodes, edges);
    for (const g of c.groups) {
      const major = byKey(c.items, g.from);
      const group = byKey(c.items, `group:${g.key}`);
      const hiddenDrops = g.hidden.reduce((s, k) => s + dropsOf(byKey(nodes, k)), 0);
      expect(dropsOf(group)).toBe(hiddenDrops);
      // ribbon_out: users from this major who reached the next major or beyond.
      expect(major.reached).toBe(out(c.edges, group.key) + hiddenDrops + dropsOf(major));
    }
  });

  it('every visible item conserves, and totals equal the expanded view for any expansion', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const groupKeys = journeyGroups(nodes).map(g => g.key);
    const subsets = [[], groupKeys, [groupKeys[1]], [groupKeys[0], groupKeys[2]]];
    const expandedTotal = nodes.reduce((s, n) => s + dropsOf(n), 0) + nodes[nodes.length - 1].continued;
    for (const open of subsets) {
      const c = collapseJourney(nodes, edges, new Set(open));
      c.items.forEach((it, i) => {
        expect(it.reached).toBe(it.continued + dropsOf(it));
        expect(it.continued).toBe(out(c.edges, it.key));
        if (i > 0) expect(it.reached).toBe(into(c.edges, it.key));
      });
      const total = c.items.reduce((s, it) => s + dropsOf(it), 0) + c.items[c.items.length - 1].continued;
      expect(total).toBe(expandedTotal);
      expect(total).toBe(byKey(c.items, 'signed_up').reached);
    }
  });

  it('fully expanded is the endpoint graph itself (same nodes and edges)', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const c = collapseJourney(nodes, edges, new Set(journeyGroups(nodes).map(g => g.key)));
    expect(c.items.map(i => i.key)).toEqual(KEYS);
    const flat = e => `${e.from}->${e.to}:${e.users}`;
    expect(c.edges.map(flat).sort()).toEqual(edges.map(flat).sort());
  });

  it('every visible edge joins neighbours and carries no skip flag, for any expansion', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const groupKeys = journeyGroups(nodes).map(g => g.key);
    for (const open of [[], groupKeys, [groupKeys[1]]]) {
      const c = collapseJourney(nodes, edges, new Set(open));
      const at = Object.fromEntries(c.items.map((it, i) => [it.key, i]));
      for (const e of c.edges) {
        expect(at[e.to] - at[e.from]).toBe(1);
        expect(e).not.toHaveProperty('skip');
      }
    }
  });

  it('counts never go up across the visible items, for any expansion (T14720)', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const groupKeys = journeyGroups(nodes).map(g => g.key);
    for (const open of [[], groupKeys, [groupKeys[0], groupKeys[2]]]) {
      const reached = collapseJourney(nodes, edges, new Set(open)).items.map(it => it.reached);
      expect(reached).toEqual([...reached].sort((p, q) => q - p));
    }
  });

  it('a user who skipped a major still passes through it and is never lost', () => {
    // Reached Opened Spotlight without export_completed: counts at Highlight made as continued.
    const { nodes, edges } = foldPaths([...NORMAL, [[...upTo('export_pressed'), 'spotlight_opened'], 'gone', 3]]);
    const c = collapseJourney(nodes, edges);
    const g = byKey(c.items, 'group:exported..finished');
    expect(c.edges.find(e => e.from === 'exported' && e.to === g.key).users).toBe(g.reached);
    expect(g.reached).toBe(g.continued + dropsOf(g));
    const total = c.items.reduce((s, it) => s + dropsOf(it), 0) + c.items[c.items.length - 1].continued;
    expect(total).toBe(byKey(c.items, 'signed_up').reached);
  });
});
