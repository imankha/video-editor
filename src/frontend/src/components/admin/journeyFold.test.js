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

// Build nodes + ordered-funnel edges from explicit per-user paths, the same fold the
// backend does over pattern rows: furthest stage carries the outcome, consecutive reached
// stages make an edge. paths: [[[stage keys...], outcome, count], ...]; signed_up implicit.
function foldPaths(paths) {
  const nodes = LADDER.map(([key, band, major]) => ({
    key, label: key, band, major: !!major, reached: 0, continued: 0, in_window: 0, stuck: 0, gone: 0,
  }));
  const at = Object.fromEntries(nodes.map(n => [n.key, n]));
  const edges = new Map();
  for (const [stages, outcome, n] of paths) {
    const reached = ['signed_up', ...stages].sort((a, b) => KEYS.indexOf(a) - KEYS.indexOf(b));
    reached.forEach(k => { at[k].reached += n; });
    at[reached[reached.length - 1]][outcome] += n;
    for (let i = 0; i + 1 < reached.length; i++) {
      const k = `${reached[i]}->${reached[i + 1]}`;
      const e = edges.get(k) || { from: reached[i], to: reached[i + 1], users: 0 };
      e.users += n;
      edges.set(k, e);
    }
  }
  for (const nd of nodes) nd.continued = nd.reached - nd.in_window - nd.stuck - nd.gone;
  return { nodes, edges: [...edges.values()] };
}

const FULL = ['started', 'add_footage', 'footage_landed', 'clipped', 'frame_opened', 'framed',
  'export_pressed', 'exported', 'spotlight_opened', 'spotlight_added', 'finished', 'watched', 'took_away'];
const upTo = k => FULL.slice(0, FULL.indexOf(k) + 1);

// Every user enters each group through the major in front of it (the normal case), plus
// both real skips: shared-in (Started -> Clipped) and Finish Now (Exported -> Finished).
const NORMAL = [
  [[], 'gone', 14],
  [upTo('started'), 'stuck', 9],
  [upTo('add_footage'), 'gone', 12],
  [upTo('footage_landed'), 'in_window', 2],
  [upTo('clipped'), 'stuck', 5],
  [['started', 'clipped', 'frame_opened'], 'stuck', 2], // shared-in skip
  [upTo('framed'), 'gone', 3],
  [upTo('export_pressed'), 'stuck', 1],
  [upTo('exported'), 'gone', 2],
  [[...upTo('exported'), 'finished', 'took_away'], 'stuck', 4], // Finish Now skip
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
      // ribbon_out: users from this major who reached the next major or beyond, whether
      // through the group or skipping it.
      const ribbonOut = out(c.edges, group.key) + c.edges
        .filter(e => e.from === major.key && e.to !== group.key).reduce((s, e) => s + e.users, 0);
      expect(major.reached).toBe(ribbonOut + hiddenDrops + dropsOf(major));
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

  it('fully expanded is the endpoint graph itself (same nodes, edges and skip flags)', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const c = collapseJourney(nodes, edges, new Set(journeyGroups(nodes).map(g => g.key)));
    expect(c.items.map(i => i.key)).toEqual(KEYS);
    const flag = e => `${e.from}->${e.to}:${e.users}:${KEYS.indexOf(e.to) - KEYS.indexOf(e.from) > 1}`;
    expect(c.edges.map(e => `${e.from}->${e.to}:${e.users}:${e.skip}`).sort()).toEqual(edges.map(flag).sort());
  });

  it('skips stay skips: Finish Now bypasses the spotlight group, shared-in bypasses the first', () => {
    const { nodes, edges } = foldPaths(NORMAL);
    const c = collapseJourney(nodes, edges);
    expect(c.edges.find(e => e.from === 'exported' && e.to === 'finished')).toMatchObject({ users: 4, skip: true });
    expect(c.edges.find(e => e.from === 'group:signed_up..clipped' && e.to === 'clipped').skip).toBe(false);
  });

  it('a user who skipped the major lands in the group on their own ribbon, never lost', () => {
    // Reached Opened Spotlight without export_completed: enters exported..finished from
    // Pressed Export's group, not from Exported.
    const { nodes, edges } = foldPaths([...NORMAL, [[...upTo('export_pressed'), 'spotlight_opened'], 'gone', 3]]);
    const c = collapseJourney(nodes, edges);
    const g = byKey(c.items, 'group:exported..finished');
    expect(c.edges.find(e => e.from === 'group:clipped..exported' && e.to === g.key).users).toBe(3);
    expect(g.reached).toBe(g.continued + dropsOf(g));
    const total = c.items.reduce((s, it) => s + dropsOf(it), 0) + c.items[c.items.length - 1].continued;
    expect(total).toBe(byKey(c.items, 'signed_up').reached);
  });
});
