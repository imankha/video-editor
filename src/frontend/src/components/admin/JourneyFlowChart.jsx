import { collapseJourney } from './journeyFold';
import { fmtPct } from './formatNumber';
import { RAG_STYLES, foldedMark, journeyTransitions, transitionChipText, transitionMark } from './journeyTargets';

// T14010: hand-rolled SVG journey map (no chart library), geometry from the approved mock
// (design doc Section 4). ONE horizontal row: each stage is a vertical bar whose height is
// proportional to users reached. Out of each bar, top to bottom: the continued ribbon to the
// next stage (purple), then the drops peeling off below as ribbons -- hatched in window,
// amber stuck, gray gone -- each with a text label, so colour is never the only encoding. Band labels sit above their node groups.
//
// Progressive disclosure: only the five `major` stages show by default. The stages
// between two majors are a collapsed GROUP drawn on the gap (journeyFold.collapseJourney):
// a faint dashed pass-through bar, the summed drops of its hidden stages, and a "+N stages"
// chip. Clicking the chip or the gap expands the group in place; its "- N stages" chip
// collapses it. Which groups are open is the parent's view state (`expanded`).

const X0 = 44;        // left margin
const CW = 122;       // column width per visible item
// Fit mode (T14730) scales the whole SVG, so past this rendered column width the 11px stage
// labels turn unreadable: the map stops shrinking and the wrapper scrolls instead. T14800 grew
// the ladder to 16 stages (file_picked, upload_started), which need 1348px at this width --
// fits a 1440px full-screen view after padding and a scrollbar (T15670; 90 no longer fit 16).
const MIN_FIT_CW = 80;
const TOP = 108;      // top of the bars (band label, chip row, rate row, stage label + count above)
const CHIP_Y = 32;    // chip row, between the band rule (y 22) and the rate row
const RATE_Y = 60;    // rate row: one mark per transition, underlined across its span (T14900)
const RATE_INSET = 8; // gap between two neighbouring underlines
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
  return rate.pct === null ? `${rate.k} / ${rate.n}` : fmtPct(rate.pct);
}

function ribbonPath(x0, y0, x1, y1, w) {
  const m = (x0 + x1) / 2;
  return `M${x0},${y0} C${m},${y0} ${m},${y1} ${x1},${y1} L${x1},${y1 + w} C${m},${y1 + w} ${m},${y0 + w} ${x0},${y0 + w} Z`;
}

// Contiguous runs of items that share a band -> one label + rule per run.
function bandRuns(items, bands) {
  const label = Object.fromEntries((bands || []).map(b => [b.key, b.label]));
  const runs = [];
  items.forEach((n, i) => {
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

function Chip({ testId, x, label, title, onClick }) {
  const w = 8 + label.length * 6;
  const activate = ev => { ev.stopPropagation(); onClick(); };
  return (
    <g
      data-testid={testId}
      role="button"
      tabIndex={0}
      aria-label={title}
      style={{ cursor: 'pointer' }}
      onClick={activate}
      onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); activate(ev); } }}
    >
      <title>{title}</title>
      <rect x={x - w / 2} y={CHIP_Y} width={w} height={16} rx="8" fill="#1d1729" stroke="#8b5cf6" strokeWidth="1" />
      <text x={x} y={CHIP_Y + 11.5} textAnchor="middle" fontSize="10" fill="#ddd3ff">{label}</text>
    </g>
  );
}

// T14900: one mark per target transition. A transition with a hidden end folds into its
// collapsed group, which shows the worst of what it hides; the tooltip names each one.
function rateMarks(nodes, index, groups, expanded) {
  const marks = [];
  const folded = new Map();
  for (const t of journeyTransitions(nodes)) {
    if (index[t.from] !== undefined && index[t.to] !== undefined) {
      marks.push({ testId: `journey-rate-${t.key}`, from: t.from, to: t.to, rag: t.rag, text: transitionMark(t),
        title: `${t.label}: ${transitionChipText(t)}` });
      continue;
    }
    const g = groups.find(x => !expanded.has(x.key) && (x.hidden.includes(t.from) || x.hidden.includes(t.to)));
    folded.set(g, [...(folded.get(g) || []), t]);
  }
  for (const [g, ts] of folded) {
    marks.push({ testId: `journey-rate-group-${g.key}`, from: g.from, to: g.to, ...foldedMark(ts),
      title: ts.map(t => `${t.label}: ${transitionChipText(t)}`).join('\n') });
  }
  return marks;
}

// What a drop count stands for: one stage, or every stage a collapsed group sums (T14740).
function dropPick(n, outcome, count) {
  if (n.kind !== 'group') return { stages: [n.key], label: n.label, outcome, count };
  const first = n.hidden[0].label;
  const last = n.hidden[n.hidden.length - 1].label;
  return {
    stages: n.hidden.map(h => h.key),
    label: n.hidden.length === 1 ? first : `${first} to ${last}`,
    outcome,
    count,
  };
}

// onSelectDrop(stageKey, outcome): a click on a stuck / gone / in-window peel-off (T14020).
// onListDropUsers(pick): a click on a drop's number, to list those users (T14740).
// fit: scale to the container's width instead of drawing at fixed pixels (T14730).
export function JourneyFlowChart({ nodes, edges, bands, onSelect, onSelectDrop, onListDropUsers, selected, expanded = new Set(), onToggleGroup, fit = false }) {
  const { items, edges: visibleEdges, groups } = collapseJourney(nodes, edges, expanded);
  const index = Object.fromEntries(items.map((it, i) => [it.key, i]));
  const maxReached = Math.max(1, ...items.map(n => n.reached));
  const S = MAX_H / maxReached;
  const nx = i => X0 + i * CW;
  const width = X0 + items.length * CW + 60;
  const height = BADGE_Y + 4 * BADGE_LINE + 8;
  const toggle = groupKey => onToggleGroup && onToggleGroup(groupKey);

  // Stack offsets: outflow (continued ribbons, then drops) from the top of each source bar;
  // inflow from the top of each target bar. Same order as the mock.
  const sOff = {};
  const tOff = {};
  const ribbons = [];
  for (const e of visibleEdges) {
    const s = index[e.from];
    const t = index[e.to];
    const w = e.users * S;
    const sy = TOP + (sOff[s] || 0); sOff[s] = (sOff[s] || 0) + w;
    const ty = TOP + (tOff[t] || 0); tOff[t] = (tOff[t] || 0) + w;
    ribbons.push({ e, s, t, w, sy, ty });
  }
  const drops = [];
  items.forEach((n, i) => {
    // The last stage has nothing left to lose: it is labelled "reached the end", not
    // drawn as drops (same as the loss ranking, which excludes it).
    if (i === items.length - 1) return;
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
  const dim = i => selected != null && selected !== items[i].key;
  const marks = rateMarks(nodes, index, groups, expanded);

  // "- N stages" chip over each expanded group's first stage.
  const collapseChips = groups
    .filter(g => expanded.has(g.key))
    .map(g => ({ g, i: index[g.hidden[0]], j: index[g.hidden[g.hidden.length - 1]] }));

  return (
    <div className="overflow-x-auto">
      <svg
        data-testid="journey-flow"
        width={fit ? '100%' : width}
        height={fit ? undefined : height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Journey map: users per stage with drop-offs split into in window, stuck and gone"
        style={{ fontVariantNumeric: 'tabular-nums', display: 'block',
          minWidth: fit ? Math.round((width * MIN_FIT_CW) / CW) : undefined }}
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

        {bandRuns(items, bands).map(b => (
          <g key={`band-${b.from}`} data-testid={`journey-band-${b.band}`}>
            <line x1={nx(b.from)} y1={22} x2={nx(b.to) + NW} y2={22} stroke="#3a2f52" strokeWidth="1" />
            <text x={nx(b.from)} y={14} fontSize="10" fontWeight="600" letterSpacing=".06em" fill="#9c92b3">
              {b.label.toUpperCase()}
            </text>
          </g>
        ))}

        {marks.map(m => {
          const x1 = nx(index[m.from]) + NW / 2 + RATE_INSET;
          const x2 = nx(index[m.to]) + NW / 2 - RATE_INSET;
          const { fill } = RAG_STYLES[m.rag];
          return (
            <g key={m.testId} data-testid={m.testId} data-rag={m.rag}>
              <title>{m.title}</title>
              <text x={(x1 + x2) / 2} y={RATE_Y} textAnchor="middle" fontSize="10.5" fontWeight="600" fill={fill}>{m.text}</text>
              <line x1={x1} y1={RATE_Y + 4} x2={x2} y2={RATE_Y + 4} stroke={fill} strokeWidth="2"
                    strokeDasharray={m.rag === 'grey' || m.rag === 'partial' ? '3 2' : undefined} />
            </g>
          );
        })}

        {/* Collapsed groups: the whole gap column is a click target (under the ribbons). */}
        {items.map((it, i) => it.kind === 'group' && (
          <rect
            key={`gap-${it.key}`}
            data-testid={`journey-gap-${it.groupKey}`}
            x={nx(i) - CW / 2 + NW / 2} y={CHIP_Y} width={CW} height={BADGE_Y - CHIP_Y}
            fill="transparent" style={{ cursor: 'pointer' }}
            onClick={() => toggle(it.groupKey)}
          >
            <title>{`Show ${it.hidden.map(h => h.label).join(', ')}`}</title>
          </rect>
        ))}

        {ribbons.map(({ e, s, t, w, sy, ty }) => (
          <path
            key={`${e.from}-${e.to}`}
            data-testid="journey-edge"
            d={ribbonPath(nx(s) + NW, sy, nx(t), ty, w)}
            fill="url(#journey-flow-grad)"
            opacity={0.6 * (dim(s) && dim(t) ? 0.45 : 1)}
            style={{ pointerEvents: 'none' }}
          >
            <title>{`${items[s].label} to ${items[t].label}: ${e.users} ${e.users === 1 ? 'user' : 'users'}`}</title>
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
            style={{ pointerEvents: onSelectDrop && n.kind !== 'group' ? 'auto' : 'none',
              cursor: onSelectDrop && n.kind !== 'group' ? 'pointer' : 'default' }}
            onClick={onSelectDrop && n.kind !== 'group' ? () => onSelectDrop(n.key, kind.key) : undefined}
          >
            <title>{`${n.label}: ${v} ${kind.word}`}</title>
          </path>
        ))}
        {drops.map(({ n, kind, v, lx, ly }) => {
          const list = onListDropUsers && (() => onListDropUsers(dropPick(n, kind.key, v)));
          const text = `${v} ${kind.word}`;
          return (
            <text
              key={`${n.key}-${kind.key}-label`}
              data-testid={`journey-drop-label-${n.key}-${kind.key}`}
              x={lx} y={ly} fontSize="10.5" fill={kind.labelFill}
              className={list ? 'cursor-pointer hover:underline' : undefined}
              role={list ? 'button' : undefined}
              tabIndex={list ? 0 : undefined}
              aria-label={list ? `List ${text} in Users` : undefined}
              onClick={list}
              onKeyDown={list && (ev => {
                if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); list(); }
              })}
            >
              {list && <title>List these users in Users</title>}
              {text}
            </text>
          );
        })}

        {items.map((n, i) => {
          const x = nx(i);
          const h = Math.max(n.reached * S, 4);
          if (n.kind === 'group') {
            return (
              <g key={n.key} data-testid={`journey-node-${n.key}`}>
                <rect x={x} y={TOP} width={NW} height={h} rx="3" fill="#c4b5fd" fillOpacity="0.18"
                      stroke="#a78bfa" strokeOpacity="0.5" strokeDasharray="3 2" style={{ pointerEvents: 'none' }}>
                  <title>{`${n.hidden.map(hd => hd.label).join(', ')}: ${n.reached} reached`}</title>
                </rect>
                <Chip testId={`journey-chip-${n.groupKey}`} x={x + NW / 2} label={n.label}
                      title={`Show ${n.hidden.map(hd => hd.label).join(', ')}`} onClick={() => toggle(n.groupKey)} />
              </g>
            );
          }
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
              {i === items.length - 1 && n.reached > 0 && (
                <text x={x + NW + 6} y={TOP + h / 2 + 4} fontSize="10.5" fill="#c4b5fd">
                  {`${n.reached} reached the end`}
                </text>
              )}
            </g>
          );
        })}

        {collapseChips.map(({ g, i, j }) => (
          <g key={`collapse-${g.key}`}>
            <line x1={nx(i)} y1={CHIP_Y + 8} x2={nx(j) + NW} y2={CHIP_Y + 8} stroke="#8b5cf6" strokeOpacity="0.4" strokeDasharray="2 2" />
            <Chip testId={`journey-chip-${g.key}`} x={(nx(i) + nx(j) + NW) / 2}
                  label={`\u2212 ${g.hidden.length} stage${g.hidden.length === 1 ? '' : 's'}`}
                  title={`Collapse ${g.hidden.length} stage${g.hidden.length === 1 ? '' : 's'}`}
                  onClick={() => toggle(g.key)} />
          </g>
        ))}
      </svg>
    </div>
  );
}
