import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fmtPct } from './formatNumber';
import { downloadRetentionCsv, retentionTriangleCsv } from './retentionChartCsv';

// T7430: the investor-grade retention chart. Owner ruling 2026-11-13: it is the only
// retention view and the only thing on screen in its section -- one large curve chart,
// no table; hovering a point shows its exact percent and counts; its curves compare
// whatever the dashboard's Dimension pill selects (campaigns, signup cohorts, builds).
// WAU low-volume shading and the return-after-gap headline ride beneath it as captions.

// What each Dimension pill makes the chart compare (backend `group` values).
const GROUPINGS = {
  cohorts: { noun: 'signup cohorts', header: 'Cohort week', order: 'newest' },
  campaigns: { noun: 'campaigns', header: 'Campaign', order: 'largest' },
  builds: { noun: 'signup builds', header: 'Build', order: 'newest' },
};

const MAX_CURVES = 8;
const COLORS = ['#c084fc', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a3a3a3', '#f472b6', '#2dd4bf'];
const W = 960, H = 420;
const PAD = { left: 48, right: 16, top: 16, bottom: 32 };

function xFor(week, weeks) {
  return PAD.left + (week / Math.max(1, weeks - 1)) * (W - PAD.left - PAD.right);
}

function yFor(pct) {
  return PAD.top + (1 - pct / 100) * (H - PAD.top - PAD.bottom);
}

// Cohort under 5: the raw fraction, never a misleading %.
function cellText(cell, smallN) {
  return smallN ? `${cell.hit}/${cell.aged}` : `${fmtPct(cell.pct)} (${cell.hit} of ${cell.aged})`;
}

// One curve per group (or per action cohort): its measurable points, in week order.
function curvePoints(weeksByIndex, weeks, pick) {
  const points = [];
  for (let i = 0; i < weeks; i++) {
    const cell = pick(weeksByIndex[String(i)]);
    if (cell) points.push({ week: i, cell, x: xFor(i, weeks), y: yFor(cell.pct) });
  }
  return points;
}

// T16070 (ruling 2026-11-13): the hovered group's day 1/3/7/14/28 figures -- the only
// place they appear. A blank cell is "not yet measurable", never 0%.
function DayNFigures({ group, dayN }) {
  const days = dayN?.cohorts?.find((c) => c.group === group)?.days ?? {};
  return (
    <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 mt-1">
      {(dayN?.checkpoints ?? []).map((n) => {
        const cell = days[String(n)];
        return (
          <div key={n} className="contents">
            <dt className="text-gray-400">Day {n}</dt>
            <dd className={cell ? 'text-gray-200 text-right' : 'text-gray-500 text-right'}>
              {cell ? `${fmtPct(cell.pct)} (${cell.hit} of ${cell.aged})` : 'not yet measurable'}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function HoverCard({ hover, dayN }) {
  const left = (hover.x / W) * 100;
  const top = (hover.y / H) * 100;
  return (
    <div
      data-testid="retention-hover"
      className="absolute pointer-events-none z-10 rounded border border-white/10 bg-gray-900/95 px-3 py-2 text-xs shadow-lg"
      style={{
        left: `${left}%`,
        top: `${top}%`,
        transform: `translate(${left > 60 ? 'calc(-100% - 12px)' : '12px'}, ${top > 60 ? '-100%' : '0'})`,
      }}
    >
      <p className="text-gray-200">{hover.label}</p>
      <p className="text-gray-500">{hover.signups} signups</p>
      {hover.cell && <p className="text-gray-100 font-medium mt-1">Week {hover.week}: {cellText(hover.cell, hover.smallN)}</p>}
      {!hover.action && <DayNFigures group={hover.group} dayN={dayN} />}
    </div>
  );
}

function RetentionChart({ curves, weeks, dayN }) {
  const [hover, setHover] = useState(null);
  const gridlines = [0, 25, 50, 75, 100];
  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[28rem]" role="img" aria-label="Retention curves">
        {gridlines.map((pct) => (
          <g key={pct}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yFor(pct)} y2={yFor(pct)} stroke="rgba(255,255,255,0.08)" />
            <text x={PAD.left - 8} y={yFor(pct) + 4} textAnchor="end" fontSize="12" fill="#9ca3af">{pct}%</text>
          </g>
        ))}
        {Array.from({ length: weeks }, (_, i) => (
          <text key={i} x={xFor(i, weeks)} y={H - 8} textAnchor="middle" fontSize="12" fill="#9ca3af">Week {i}</text>
        ))}
        {curves.map((curve) => {
          if (curve.points.length < 2) return null;
          const base = { group: curve.group, label: curve.label, signups: curve.signups, smallN: curve.smallN, action: curve.action };
          const last = curve.points[curve.points.length - 1];
          const isHovered = hover?.group === curve.group && hover?.action === curve.action;
          return (
            <g key={`${curve.action ? 'action' : 'group'}-${curve.group}`}>
              <polyline
                data-testid={curve.action ? 'retention-action-curve' : 'retention-curve'}
                points={curve.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={curve.color}
                strokeDasharray={curve.action ? '6 4' : undefined}
                strokeWidth={isHovered ? 3.5 : 2}
                pointerEvents="stroke"
                onMouseEnter={() => setHover({ ...base, x: last.x, y: last.y })}
                onMouseLeave={() => setHover(null)}
              />
              {curve.points.map((p) => (
                <circle
                  key={p.week}
                  data-testid="retention-point"
                  cx={p.x}
                  cy={p.y}
                  r={isHovered && hover.week === p.week ? 6 : 4}
                  fill={curve.color}
                  stroke="#111827"
                  strokeWidth="1.5"
                  onMouseEnter={() => setHover({ ...base, x: p.x, y: p.y, week: p.week, cell: p.cell })}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
            </g>
          );
        })}
      </svg>
      {hover && <HoverCard hover={hover} dayN={dayN} />}
      <ul data-testid="retention-legend" className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-300">
        {curves.map((curve) => (
          <li key={`${curve.action ? 'action' : 'group'}-${curve.group}`} className="flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-0.5"
              style={{ background: curve.action ? 'transparent' : curve.color, borderTop: curve.action ? `2px dashed ${curve.color}` : undefined }}
            />
            {curve.label} <span className="text-gray-500">({curve.signups})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WauStrip({ wau, lowVolumeRule }) {
  if (!wau?.length) return null;
  return (
    <div>
      <p className="text-gray-500 text-[11px] mb-1">
        WAU below {Math.round(lowVolumeRule.ratio * 100)}% of the trailing {lowVolumeRule.trailing_weeks}-week
        median is shaded as low-volume (measured activity, not a season calendar).
      </p>
      <div className="flex gap-0.5 overflow-x-auto">
        {wau.map((row) => (
          <div
            key={row.week}
            data-testid="wau-bar"
            data-low-volume={row.low_volume}
            title={`${row.week}: WAU ${row.wau}${row.wau_mau_ratio != null ? `, WAU/MAU ${fmtPct(row.wau_mau_ratio * 100)}` : ''}`}
            className={`w-3 shrink-0 rounded-sm ${row.low_volume ? 'bg-amber-600/60' : 'bg-purple-500/50'}`}
            style={{ height: `${Math.max(4, Math.min(40, row.wau / 5))}px` }}
          />
        ))}
      </div>
    </div>
  );
}

// The long-horizon headline as a caption line (not a table, ruling 2026-11-13).
function ReturnAfterGap({ returnAfterGap }) {
  const measurable = (returnAfterGap?.cohorts ?? []).filter((c) => c.pct != null);
  if (!measurable.length) {
    return <p className="text-gray-500 text-xs">No month has matured past the {returnAfterGap?.gap_days}-day gap yet.</p>;
  }
  return (
    <p className="text-xs text-gray-300" data-testid="return-after-gap">
      <span className="text-gray-400">Active again {returnAfterGap.gap_days}+ days later: </span>
      {measurable.map((c, i) => (
        <span key={c.month}>
          {i > 0 && <span className="text-gray-600"> · </span>}
          {c.month.slice(0, 7)} {fmtPct(c.pct)} ({c.hit} of {c.cohort_size})
        </span>
      ))}
    </p>
  );
}

export function RetentionView({ data, loading, error, onRefresh, action, onActionChange, cohortBin, onCohortBinChange }) {
  const [view, setView] = useState('unbounded');
  const grouping = data ? GROUPINGS[data.group] : null;
  const groups = data?.triangle?.cohorts ?? [];
  const weeks = data?.triangle?.weeks_tracked ?? 0;
  const binDisabled = Boolean(data) && data.group !== 'cohorts';
  const csvHeader = data?.group === 'cohorts' && data.cohort_bin === 'month' ? 'Cohort month' : grouping?.header;

  const curves = groups.slice(0, MAX_CURVES).map((row, idx) => ({
    group: row.group,
    label: row.label,
    signups: row.signups,
    smallN: row.small_n,
    action: false,
    color: COLORS[idx % COLORS.length],
    points: curvePoints(row.weeks, weeks, (w) => w?.[view]),
  }));
  // Action-level retention (T7400 rollup) joins the same chart as dashed curves, keyed by signup week.
  const actionCohorts = action && data?.action?.available ? data.action.cohorts : [];
  actionCohorts.slice(0, MAX_CURVES).forEach((c, idx) => {
    curves.push({
      group: c.cohort_week,
      label: `${action} ${c.cohort_week}`,
      signups: c.base,
      smallN: c.base < 5,
      action: true,
      color: COLORS[idx % COLORS.length],
      points: curvePoints(c.weeks, weeks, (w) => w),
    });
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load retention chart'}
        </button>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="radio"
            checked={view === 'classic'}
            onChange={() => setView('classic')}
          /> Classic
        </label>
        <label className="flex items-center gap-2 text-xs text-gray-400">
          <input
            type="radio"
            checked={view === 'unbounded'}
            onChange={() => setView('unbounded')}
          /> Unbounded
        </label>
        {['week', 'month'].map((bin) => (
          <label
            key={bin}
            className="flex items-center gap-2 text-xs text-gray-400"
            title={binDisabled ? 'Weekly/monthly bins apply to the Cohorts grouping' : undefined}
          >
            <input
              type="radio"
              checked={cohortBin === bin}
              disabled={binDisabled}
              onChange={() => onCohortBinChange(bin)}
            /> {bin === 'week' ? 'Weekly' : 'Monthly'}
          </label>
        ))}
        <label className="flex items-center gap-2 text-xs text-gray-400">
          Action (optional)
          <input
            type="text"
            value={action}
            onChange={(e) => onActionChange(e.target.value)}
            placeholder="export_completed"
            className="rounded border border-white/10 bg-gray-900 px-2 py-1 text-xs text-gray-200 w-40"
          />
        </label>
        {data && (
          <button
            type="button"
            disabled={!groups.length}
            onClick={() => downloadRetentionCsv(retentionTriangleCsv(groups, weeks, view, csvHeader), view)}
            className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"
          >
            Download CSV
          </button>
        )}
      </div>

      {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}

      {data && (
        <>
          <p className="text-gray-500 text-[11px]">
            Comparing {grouping.noun} (the Dimension pill above)
            {groups.length > MAX_CURVES && `, ${MAX_CURVES} ${grouping.order} of ${groups.length}`}.
            {data.coverage_start && ` Data begins ${data.coverage_start} -- weeks before that never render as zero retention.`}
          </p>
          {groups.length
            ? <RetentionChart curves={curves} weeks={weeks} dayN={data.day_n} />
            : <p className="text-gray-500 text-sm">No signup cohorts available.</p>}
          {action && data.action?.available === false && (
            <p className="text-gray-500 text-xs">Run the action rollup first (Analytics &gt; Run rollup).</p>
          )}
          {action && data.action?.available && !data.action.cohorts.length && (
            <p className="text-gray-500 text-xs">No cohorts yet for {action}.</p>
          )}
          <WauStrip wau={data.wau} lowVolumeRule={data.low_volume_rule} />
          <ReturnAfterGap returnAfterGap={data.return_after_gap} />
        </>
      )}
    </div>
  );
}
