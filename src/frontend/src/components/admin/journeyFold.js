// T14010: progressive disclosure for the Journey map. Pure functions over the endpoint's
// 14-stage nodes and neighbour edges; no state, no fetching.
//
// The five `major` stages are always shown. The stages between two majors form a GROUP;
// a collapsed group is drawn as one pass-through point on the gap. Collapsing CONTRACTS
// the expanded graph: every hidden stage maps to its group, edges are summed by their
// mapped endpoints, and edges inside the group disappear. This is exact per user (T14720:
// a user counts at every stage up to their furthest, so every path runs through neighbours
// and a group's stages are consecutive in it), hence every visible node and group conserves:
//   reached = continued + in_window + stuck + gone
// a group's drops are exactly the summed drops of its hidden stages, counts never go up
// from one visible item to the next, and
//   major.reached = own drops + group drops + users who reached the next major or beyond.

const DROP_KEYS = ['in_window', 'stuck', 'gone'];

// Runs of non-major stages between two majors, in ladder order.
export function journeyGroups(nodes) {
  const groups = [];
  let prevMajor = null;
  let hidden = [];
  for (const n of nodes) {
    if (n.major) {
      if (hidden.length) {
        groups.push({ key: `${prevMajor}..${n.key}`, from: prevMajor, to: n.key, hidden });
      }
      prevMajor = n.key;
      hidden = [];
    } else {
      if (prevMajor === null) throw new Error(`journeyGroups: stage ${n.key} precedes every major stage`);
      hidden.push(n.key);
    }
  }
  if (hidden.length) throw new Error(`journeyGroups: stages ${hidden.join(', ')} follow the last major stage`);
  return groups;
}

// The group that hides `stageKey`, or null for a major stage.
export function groupOfStage(nodes, stageKey) {
  return journeyGroups(nodes).find(g => g.hidden.includes(stageKey)) || null;
}

// Visible items (stages and collapsed groups) and the contracted edges between them.
// `expanded` is a Set of group keys shown stage by stage.
export function collapseJourney(nodes, edges, expanded = new Set()) {
  const groups = journeyGroups(nodes);
  const groupOf = {};
  for (const g of groups) for (const k of g.hidden) groupOf[k] = g;

  const items = [];
  const rep = {};
  for (const n of nodes) {
    const g = groupOf[n.key];
    if (!g || expanded.has(g.key)) {
      items.push({ ...n, kind: 'stage', groupKey: g ? g.key : null });
      rep[n.key] = n.key;
      continue;
    }
    const itemKey = `group:${g.key}`;
    rep[n.key] = itemKey;
    if (g.hidden[0] !== n.key) continue;
    const hiddenNodes = g.hidden.map(k => nodes.find(x => x.key === k));
    const item = {
      key: itemKey, kind: 'group', groupKey: g.key, band: n.band,
      label: `+${g.hidden.length} stage${g.hidden.length === 1 ? '' : 's'}`,
      hidden: hiddenNodes.map(h => ({ key: h.key, label: h.label })),
      reached: 0, continued: 0,
    };
    for (const k of DROP_KEYS) item[k] = hiddenNodes.reduce((sum, h) => sum + h[k], 0);
    items.push(item);
  }

  const index = Object.fromEntries(items.map((it, i) => [it.key, i]));
  const summed = new Map();
  for (const e of edges) {
    const from = rep[e.from];
    const to = rep[e.to];
    if (from === undefined || to === undefined) throw new Error(`collapseJourney: edge ${e.from}->${e.to} names an unknown stage`);
    if (from === to) continue; // inside a collapsed group
    const k = `${from}->${to}`;
    summed.set(k, { from, to, users: (summed.get(k)?.users || 0) + e.users });
  }
  const visibleEdges = [...summed.values()]
    .sort((a, b) => index[a.from] - index[b.from] || index[a.to] - index[b.to]);

  for (const it of items) {
    if (it.kind !== 'group') continue;
    it.reached = visibleEdges.filter(e => e.to === it.key).reduce((s, e) => s + e.users, 0);
    it.continued = visibleEdges.filter(e => e.from === it.key).reduce((s, e) => s + e.users, 0);
  }
  return { items, edges: visibleEdges, groups };
}
