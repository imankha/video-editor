import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { fmtPct } from './formatNumber';
import { downloadRetentionCsv, retentionTriangleCsv } from './retentionChartCsv';

// T7430: the investor-grade retention chart -- triangle (classic/unbounded), curve
// overlay, WAU strip with low-volume shading, return-after-gap headline, and the
// action-level toggle (export_completed / clip-library, from T7400's rollup).

function TriangleCell({ cell, smallN }) {
  if (!cell) {
    return <span className="text-gray-500 text-xs" title="Not yet measurable">--</span>;
  }
  if (smallN) {
    return <span className="text-gray-300 text-xs" title="Cohort under 5 -- raw fraction, not a %">{cell.hit}/{cell.aged}</span>;
  }
  return <span className="text-gray-200 text-xs">{fmtPct(cell.pct)}</span>;
}

function Triangle({ triangle, view }) {
  if (!triangle?.cohorts?.length) {
    return <p className="text-gray-500 text-sm">No signup cohorts available.</p>;
  }
  const weekCols = Array.from({ length: triangle.weeks_tracked }, (_, i) => i);
  return (
    <div className="rounded-lg border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5">Signup week</th>
            <th className="text-right px-3 py-2.5">Signups</th>
            {weekCols.map((w) => (
              <th key={w} className="text-right px-3 py-2.5">W{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {triangle.cohorts.map((row) => (
            <tr key={row.cohort_week} className="border-b border-white/5" data-testid="retention-triangle-row">
              <td className="px-3 py-2 text-gray-200 text-xs whitespace-nowrap">{row.cohort_week}</td>
              <td className="px-3 py-2 text-right text-gray-300 text-xs">{row.signups}</td>
              {weekCols.map((w) => (
                <td key={w} className="px-3 py-2 text-right whitespace-nowrap">
                  <TriangleCell cell={row.weeks[String(w)]?.[view]} smallN={row.small_n} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Lightweight inline SVG curve overlay -- no new chart library (FunnelChart.jsx
// precedent uses plain HTML/CSS; this is the smallest step up for a line curve).
function CurveOverlay({ triangle, view }) {
  const cohorts = (triangle?.cohorts ?? []).slice(0, 6);
  if (!cohorts.length) return null;
  const weeks = triangle.weeks_tracked;
  const w = 320, h = 120, pad = 8;
  const colors = ['#c084fc', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a3a3a3'];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-md h-28" role="img" aria-label="Retention curves">
      {cohorts.map((row, idx) => {
        const points = [];
        for (let i = 0; i < weeks; i++) {
          const cell = row.weeks[String(i)]?.[view];
          if (!cell) continue;
          const x = pad + (i / (weeks - 1)) * (w - 2 * pad);
          const y = pad + (1 - cell.pct / 100) * (h - 2 * pad);
          points.push(`${x},${y}`);
        }
        if (points.length < 2) return null;
        return (
          <polyline
            key={row.cohort_week}
            points={points.join(' ')}
            fill="none"
            stroke={colors[idx % colors.length]}
            strokeWidth="1.5"
          />
        );
      })}
    </svg>
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

function ReturnAfterGap({ returnAfterGap }) {
  const cohorts = returnAfterGap?.cohorts ?? [];
  const measurable = cohorts.filter((c) => c.pct != null);
  if (!measurable.length) {
    return <p className="text-gray-500 text-xs">No month has matured past the {returnAfterGap?.gap_days}-day gap yet.</p>;
  }
  return (
    <table className="text-xs">
      <thead>
        <tr className="text-gray-400 uppercase tracking-wider">
          <th className="text-left pr-3 py-1">Month</th>
          <th className="text-right pr-3 py-1">Cohort</th>
          <th className="text-right py-1">Returned {returnAfterGap.gap_days}d+</th>
        </tr>
      </thead>
      <tbody>
        {measurable.map((c) => (
          <tr key={c.month}>
            <td className="pr-3 py-1 text-gray-200">{c.month}</td>
            <td className="pr-3 py-1 text-right text-gray-300">{c.cohort_size}</td>
            <td className="py-1 text-right text-gray-200">{fmtPct(c.pct)} ({c.hit}/{c.aged})</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RetentionView({ data, loading, error, onRefresh, action, onActionChange }) {
  const [view, setView] = useState('unbounded');

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
            disabled={!data.triangle?.cohorts?.length}
            onClick={() => downloadRetentionCsv(retentionTriangleCsv(data.triangle.cohorts, data.triangle.weeks_tracked, view), view)}
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
          {data.coverage_start && (
            <p className="text-gray-500 text-[11px]">Data begins {data.coverage_start} -- weeks before that never render as zero retention.</p>
          )}
          <Triangle triangle={data.triangle} view={view} />
          <CurveOverlay triangle={data.triangle} view={view} />
          <WauStrip wau={data.wau} lowVolumeRule={data.low_volume_rule} />
          <div>
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Return after 120+ day gap</p>
            <ReturnAfterGap returnAfterGap={data.return_after_gap} />
          </div>
          {action && (
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Action: {action}</p>
              {data.action?.available === false ? (
                <p className="text-gray-500 text-xs">Run the action rollup first (Analytics &gt; Run rollup).</p>
              ) : !data.action?.cohorts?.length ? (
                <p className="text-gray-500 text-xs">No cohorts yet for this action.</p>
              ) : (
                <table className="text-xs">
                  <thead>
                    <tr className="text-gray-400 uppercase tracking-wider">
                      <th className="text-left pr-3 py-1">Cohort week</th>
                      <th className="text-right pr-3 py-1">Base</th>
                      <th className="text-right py-1">Week 1</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.action.cohorts.map((c) => (
                      <tr key={c.cohort_week}>
                        <td className="pr-3 py-1 text-gray-200">{c.cohort_week}</td>
                        <td className="pr-3 py-1 text-right text-gray-300">{c.base}</td>
                        <td className="py-1 text-right text-gray-200">
                          {c.weeks['1'] ? `${fmtPct(c.weeks['1'].pct)} (${c.weeks['1'].hit}/${c.weeks['1'].aged})` : '--'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
