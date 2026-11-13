import { RefreshCw } from 'lucide-react';
import { fmtPct } from './formatNumber';

// T16070: day-1/3/7/14/28 return rate, one row per signup week (newest first)
// plus a pooled "All weeks" row. A null cell means the cohort (or, for "All
// weeks", nobody yet) has not aged into that checkpoint -- rendered as a
// blank dash, never a fabricated 0%.
const CHECKPOINTS = [1, 3, 7, 14, 28];

function RetentionCell({ cell }) {
  if (!cell) {
    return <span className="text-gray-500 text-xs" title="Not yet measurable">--</span>;
  }
  return (
    <span className="text-gray-200 text-xs">
      {fmtPct(cell.pct)} ({cell.hit} of {cell.aged})
    </span>
  );
}

export function DayNRetentionTable({ data, loading, error, onRefresh }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load retention'}
        </button>
        <span className="text-gray-500 text-xs">
          Share of each signup week still active on day 1/3/7/14/28. Honors the test-account filter.
        </span>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}

      {data && !data.cohorts?.length ? (
        <p className="text-gray-500 text-sm">No signup cohorts available.</p>
      ) : null}

      {data && data.cohorts?.length ? (
        <div className="rounded-lg border border-white/10 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                <th className="text-left px-3 py-2.5">Signup week</th>
                <th className="text-right px-3 py-2.5">Signups</th>
                {CHECKPOINTS.map((n) => (
                  <th key={n} className="text-right px-3 py-2.5">Day {n}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((row) => (
                <tr key={row.cohort_week} className="border-b border-white/5">
                  <td className="px-3 py-2 text-gray-200 text-xs whitespace-nowrap">{row.cohort_week}</td>
                  <td className="px-3 py-2 text-right text-gray-300 text-xs">{row.signups}</td>
                  {CHECKPOINTS.map((n) => (
                    <td key={n} className="px-3 py-2 text-right whitespace-nowrap">
                      <RetentionCell cell={row.days[String(n)]} />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="border-t border-white/10">
                <td className="px-3 py-2 text-gray-300 text-xs font-medium" colSpan={2}>All weeks</td>
                {CHECKPOINTS.map((n) => (
                  <td key={n} className="px-3 py-2 text-right whitespace-nowrap">
                    <RetentionCell cell={data.all_weeks.days[String(n)]} />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
