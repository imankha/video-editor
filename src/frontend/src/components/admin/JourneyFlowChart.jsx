import React from 'react';

// T14010: hand-rolled SVG journey map (no chart library). Nodes flow left to right inside
// their band; ribbons = users who continued from one stage to the next stage they reached;
// skip edges are drawn fainter and dashed. Under each node the peel-offs are labelled:
// amber = stuck (still visiting), gray = gone, hatched = in window (pending, not judged).
// Every drop carries a text label, so colour is never the only encoding.

const NODE_W = 118;
const NODE_H = 58;
const COL_GAP = 40;
const ROW_H = 150;
const PER_ROW = 7;
const LEFT = 16;
const TOP = 34;
const MAX_RIBBON = 16;

export function formatRate(rate) {
  if (!rate) return '';
  return rate.pct === null ? `${rate.k} / ${rate.n}` : `${rate.pct}%`;
}

function layout(nodes) {
  const rows = [];
  let band = null;
  let current = null;
  for (const n of nodes) {
    if (n.band !== band || current.length >= PER_ROW) {
      current = [];
      rows.push(current);
      band = n.band;
    }
    current.push(n);
  }
  const pos = {};
  rows.forEach((row, r) => {
    row.forEach((n, c) => {
      pos[n.key] = { x: LEFT + c * (NODE_W + COL_GAP), y: TOP + r * ROW_H, row: r };
    });
  });
  return { rows, pos };
}

function ribbonPath(a, b, bump) {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  if (b.row !== a.row) {
    // wrap to the next band row: leave right, re-enter left
    const mid = a.y + NODE_H + 28;
    return `M${x1},${y1} C${x1 + 24},${y1} ${x1 + 24},${mid} ${(x1 + x2) / 2},${mid} S${x2 - 24},${y2} ${x2},${y2}`;
  }
  const lift = bump ? -34 : 0;
  const dx = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + dx},${y1 + lift} ${x2 - dx},${y2 + lift} ${x2},${y2}`;
}

function nodeDrops(n) {
  return [
    { kind: 'stuck', n: n.stuck, label: `${n.stuck} stuck`, cls: 'journey-drop-stuck', fill: '#f59e0b' },
    { kind: 'gone', n: n.gone, label: `${n.gone} gone`, cls: 'journey-drop-gone', fill: '#6b7280' },
    { kind: 'in_window', n: n.in_window, label: `${n.in_window} in window`, cls: 'journey-drop-window', fill: 'url(#journey-hatch)' },
  ].filter(d => d.n > 0);
}

export function JourneyFlowChart({ nodes, edges, bands, onSelect, selected }) {
  const { rows, pos } = layout(nodes);
  const maxUsers = Math.max(1, ...edges.map(e => e.users));
  const width = LEFT * 2 + PER_ROW * NODE_W + (PER_ROW - 1) * COL_GAP;
  const height = TOP + rows.length * ROW_H;
  const bandLabel = Object.fromEntries((bands || []).map(b => [b.key, b.label]));

  return (
    <div className="overflow-x-auto">
      <svg
        data-testid="journey-flow"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Journey map"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        <defs>
          <pattern id="journey-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="rgba(255,255,255,0.04)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#9ca3af" strokeWidth="2" />
          </pattern>
          <linearGradient id="journey-flow-grad" x1="0" x2="1">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>

        {rows.map((row, r) => (
          <text key={`band-${r}`} x={LEFT} y={TOP + r * ROW_H - 12} fontSize="11" fill="#9ca3af" className="uppercase">
            {bandLabel[row[0].band] || ''}
          </text>
        ))}

        {edges.map(e => {
          const a = pos[e.from];
          const b = pos[e.to];
          if (!a || !b) return null;
          const w = Math.max(1.5, (e.users / maxUsers) * MAX_RIBBON);
          return (
            <path
              key={`${e.from}-${e.to}`}
              data-testid={e.skip ? 'journey-edge-skip' : 'journey-edge'}
              d={ribbonPath(a, b, e.skip)}
              fill="none"
              stroke="url(#journey-flow-grad)"
              strokeWidth={w}
              strokeOpacity={e.skip ? 0.3 : 0.6}
              strokeDasharray={e.skip ? '5 4' : undefined}
            >
              <title>{`${e.users} users: ${e.from} to ${e.to}${e.skip ? ' (skipped stages)' : ''}`}</title>
            </path>
          );
        })}

        {nodes.map(n => {
          const p = pos[n.key];
          const drops = nodeDrops(n);
          const isSel = selected === n.key;
          return (
            <g key={n.key} data-testid={`journey-node-${n.key}`} onClick={() => onSelect && onSelect(n.key)}
               style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx="8"
                    fill="#1f2937" stroke={isSel ? '#c084fc' : 'rgba(255,255,255,0.15)'} strokeWidth={isSel ? 2 : 1} />
              <text x={p.x + 8} y={p.y + 16} fontSize="11" fill="#e5e7eb">{n.label}</text>
              {n.no_data ? (
                <text x={p.x + 8} y={p.y + 36} fontSize="12" fill="#9ca3af">no data</text>
              ) : (
                <>
                  <text x={p.x + 8} y={p.y + 36} fontSize="15" fontWeight="600" fill="#fff">{n.reached}</text>
                  <text x={p.x + NODE_W - 8} y={p.y + 36} fontSize="11" fill="#c4b5fd" textAnchor="end">
                    {n.judged > 0 ? `${formatRate(n.continue_rate)} go on` : ''}
                  </text>
                </>
              )}
              {n.partial_from && (
                <text x={p.x + 8} y={p.y + 51} fontSize="9" fill="#fbbf24">{`data from ${n.partial_from}`}</text>
              )}
              {!n.partial_from && n.client_beacon && (
                <text x={p.x + 8} y={p.y + 51} fontSize="9" fill="#9ca3af">client beacon</text>
              )}
              {n.partial_from && n.client_beacon && (
                <text x={p.x + NODE_W - 8} y={p.y + 51} fontSize="9" fill="#9ca3af" textAnchor="end">beacon</text>
              )}
              {drops.map((d, i) => (
                <g key={d.kind} data-testid={`journey-drop-${n.key}-${d.kind}`}>
                  <rect x={p.x + 4} y={p.y + NODE_H + 6 + i * 16} width={10} height={10} rx="2"
                        fill={d.fill} stroke="#9ca3af" strokeWidth={d.kind === 'in_window' ? 1 : 0} />
                  <text x={p.x + 19} y={p.y + NODE_H + 15 + i * 16} fontSize="10" fill="#d1d5db">{d.label}</text>
                </g>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
