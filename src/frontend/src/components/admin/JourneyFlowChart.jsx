// T14010: hand-rolled SVG journey map (no chart library), geometry from the approved mock
// (design doc Section 4). ONE horizontal row: each stage is a vertical bar whose height is
// proportional to users reached. Out of each bar, top to bottom: continued ribbons to the
// next stage the user reached (purple; skips fainter and dashed), then the drops peeling
// off below as ribbons -- hatched in window, amber stuck, gray gone -- each with a text
// label, so colour is never the only encoding. Band labels sit above their node groups.

const X0 = 44;        // left margin
const CW = 122;       // column width per stage
const TOP = 70;       // top of the bars (stage label + count + band label sit above)
const NW = 10;        // bar width
const STUB = 54;      // horizontal reach of a drop ribbon
const MAX_H = 240;    // height of the tallest bar
const LABEL_GAP = 12; // minimum vertical gap between drop labels
// Badges live in a footer row below every ribbon and drop label (the lowest drop label of
// the tallest bar lands ~55 px under it), centred on their bar, one short line each.
const BADGE_Y = TOP + MAX_H + 70;
const BADGE_LINE = 12;

const DROP_KINDS = [
  { key: 'in_window', word: 'in window', fill: 'url(#journey-hatch)', opacity: 0.7, labelFill: '#8f85a8' },
  { key: 'stuck', word: 'stuck', fill: '#d97706', opacity: 0.55, labelFill: '#f5b35c' },
  { key: 'gone', word: 'gone', fill: '#6b7280', opacity: 0.55, labelFill: '#8f85a8' },
];

export function formatRate(rate) {
  if (!rate) return '';
  return rate.pct === null ? `${rate.k} / ${rate.n}` : `${rate.pct}%`;
}

function ribbonPath(x0, y0, x1, y1, w) {
  const m = (x0 + x1) / 2;
  return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1} L${x1},${y1 + w} C${m},${y1 + w} ${m},${y0 + w} ${x0},${y0 + w} Z`;
}

// Contiguous runs of nodes that share a band -> one label + rule per run.
function bandRuns(nodes, bands) {
  const label = Object.fromEntries((bands || []).map(b => [b.key, b.label]));
  const runs = [];
  nodes.forEach((n, i) => {
    const last = runs[runs.length - 1];
    if (last && last.band === n.band) last.to = i;
    else runs.push({ band: n.band, label: label[n.band] || '', from: i, to: i });
  });
  return runs;
}

// One line per badge, each narrower than a column, so badges never overlap each other
// or a neighbour's (the partial date gets its own line).
function nodeBadges(n) {
  const out = [];
  if (n.no_data) out.push({ key: 'no-data', lines: ['no data'], fill: '#9ca3af' });
  if (n.partial_from) out.push({ key: 'partial', lines: ['data from', n.partial_from], fill: '#fbbf24' });
  if (n.client_beacon) out.push({ key: 'beacon', lines: ['client beacon'], fill: '#9c92b3' });
  return out;
}

export function JourneyFlowChart({ nodes, edges, bands, onSelect, selected }) {
  const index = Object.fromEntries(nodes.map((n, i) => [n.key, i]));
  const maxReached = Math.max(1, ...nodes.map(n => n.reached));
  const S = MAX_H / maxReached;
  const nx = i => X0 + i * CW;
  const width = X0 + nodes.length * CW + 60;
  const height = BADGE_Y + 4 * BADGE_LINE + 8;

  // Stack offsets: outflow (continued ribbons, then drops) from the top of each source bar;
  // inflow from the top of each target bar. Same order as the mock.
  const sOff = {};
  const tOff = {};
  const ribbons = [];
  for (const e of edges) {
    const s = index[e.from];
    const t = index[e.to];
    if (s === undefined || t === undefined) continue;
    const w = e.users * S;
    const sy = TOP + (sOff[s] || 0); sOff[s] = (sOff[s] || 0) + w;
    const ty = TOP + (tOff[t] || 0); tOff[t] = (tOff[t] || 0) + w;
    ribbons.push({ e, s, t, w, sy, ty });
  }
  const drops = [];
  nodes.forEach((n, i) => {
    // The last stage has nothing left to lose: it is labelled "reached the end", not
    // drawn as drops (same as the loss ranking, which excludes it).
    if (i === nodes.length - 1) return;
    let lastLabelY = -Infinity;
    for (const kind of DROP_KINDS) {
      const v = n[kind.key];
      if (!v) continue;
      const w = v * S;
      const sy = TOP + (sOff[i] || 0); sOff[i] = (sOff[i] || 0) + w;
      const x0 = nx(i) + NW;
      const x1 = x0 + STUB;
      const y1 = sy + 14 + w * 0.1;
      let ly = y1 + w / 2 + 3.5;
      if (ly < lastLabelY + LABEL_GAP) ly = lastLabelY + LABEL_GAP;
      lastLabelY = ly;
      drops.push({ n, i, kind, v, d: ribbonPath(x0, sy, x1, y1, w), lx: x1 + 4, ly });
    }
  });
  const dim = i => selected != null && selected !== nodes[i].key;

  return (
    <div className="overflow-x-auto">
      <svg
        data-testid="journey-flow"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Journey map: users per stage with drop-offs split into in window, stuck and gone"
        style={{ fontVariantNumeric: 'tabular-nums', display: 'block' }}
      >
        <defs>
          <linearGradient id="journey-flow-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8b5cf6" />
            <stop offset="1" stopColor="#a78bfa" />
          </linearGradient>
          <pattern id="journey-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="#1d1729" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="#6b7280" strokeWidth="2" />
          </pattern>
        </defs>

        {bandRuns(nodes, bands).map(b => (
          <g key={`band-${b.from}`} data-testid={`journey-band-${b.band}`}>
            <line x1={nx(b.from)} y1={22} x2={nx(b.to) + NW} y2={22} stroke="#3a2f52" strokeWidth="1" />
            <text x={nx(b.from)} y={14} fontSize="10" fontWeight="600" letterSpacing=".06em" fill="#9c92b3">
              {b.label.toUpperCase()}
            </text>
          </g>
        ))}

        {ribbons.map(({ e, s, t, w, sy, ty }) => (
          <path
            key={`${e.from}-${e.to}`}
            data-testid={e.skip ? 'journey-edge-skip' : 'journey-edge'}
            d={ribbonPath(nx(s) + NW, sy, nx(t), ty, w)}
            fill="url(#journey-flow-grad)"
            opacity={(e.skip ? 0.32 : 0.6) * (dim(s) && dim(t) ? 0.45 : 1)}
            stroke={e.skip ? '#a78bfa' : 'none'}
            strokeDasharray={e.skip ? '4 3' : undefined}
            strokeWidth={e.skip ? 0.8 : 0}
          >
            <title>{`${nodes[s].label} to ${nodes[t].label}: ${e.users} users${e.skip ? ' (skipped ahead)' : ''}`}</title>
          </path>
        ))}

        {drops.map(({ n, i, kind, v, d }) => (
          <path
            key={`${n.key}-${kind.key}`}
            data-testid={`journey-drop-${n.key}-${kind.key}`}
            d={d}
            fill={kind.fill}
            opacity={kind.opacity * (dim(i) ? 0.4 : 1)}
            stroke={kind.key === 'in_window' ? '#6b7280' : 'none'}
            strokeWidth={kind.key === 'in_window' ? 0.6 : 0}
          >
            <title>{`${n.label}: ${v} ${kind.word}`}</title>
          </path>
        ))}
        {drops.map(({ n, kind, v, lx, ly }) => (
          <text key={`${n.key}-${kind.key}-label`} x={lx} y={ly} fontSize="10.5" fill={kind.labelFill}>
            {`${v} ${kind.word}`}
          </text>
        ))}

        {nodes.map((n, i) => {
          const x = nx(i);
          const h = Math.max(n.reached * S, 4);
          const isSel = selected === n.key;
          return (
            <g key={n.key} data-testid={`journey-node-${n.key}`}>
              <rect
                x={x} y={TOP} width={NW} height={h} rx="3"
                fill={isSel ? '#ede9fe' : '#c4b5fd'}
                stroke={isSel ? '#a78bfa' : 'none'} strokeWidth="2"
                role="button" tabIndex={0}
                aria-label={`${n.label}, ${n.no_data ? 'no data' : `${n.reached} users`}`}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
                onClick={() => onSelect && onSelect(n.key)}
                onKeyDown={ev => {
                  if (onSelect && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onSelect(n.key); }
                }}
              >
                <title>{`${n.label}: ${n.no_data ? 'no data' : `${n.reached} reached, continue ${formatRate(n.continue_rate)}`}`}</title>
              </rect>
              <text x={x + NW / 2} y={TOP - 28} textAnchor="middle" fontSize="11" fill={isSel ? '#ece7f4' : '#9c92b3'}>
                {n.label}
              </text>
              <text x={x + NW / 2} y={TOP - 12} textAnchor="middle" fontSize="12" fontWeight="600" fill="#ece7f4">
                {n.no_data ? '' : n.reached}
              </text>
              {(() => {
                let line = 0;
                return nodeBadges(n).map(b => (
                  <text
                    key={b.key}
                    data-testid={`journey-badge-${n.key}-${b.key}`}
                    textAnchor="middle" fontSize="9" fill={b.fill}
                  >
                    {b.lines.map(t => (
                      <tspan key={t} x={x + NW / 2} y={BADGE_Y + (line++) * BADGE_LINE}>{t}</tspan>
                    ))}
                  </text>
                ));
              })()}
              {i === nodes.length - 1 && n.reached > 0 && (
                <text x={x + NW + 6} y={TOP + h / 2 + 4} fontSize="10.5" fill="#c4b5fd">
                  {`${n.reached} reached the end`}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
