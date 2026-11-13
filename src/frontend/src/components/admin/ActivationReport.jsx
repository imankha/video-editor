import { RefreshCw } from 'lucide-react';
import { fmtPct } from './formatNumber';
import { activationReportCsv, downloadActivationCsv } from './activationReportCsv';

// T7420: activation report -- per monthly signup cohort, % reaching export_completed
// (primary, scored vs the 40% target) and share_completed (value-moment) within 14
// days of acquired_at, with benchmark annotations. Scope shrunk 2026-10-30
// (owner-approved): stage-conversion and the non-activated stall distribution live in
// the Journey tab's step inspector (T14020) instead of here.

function MetricCell({ metric }) {
  if (!metric) {
    return <span className="text-gray-500 text-xs" title="Not yet measurable">--</span>;
  }
  return (
    <span className="text-gray-200 text-xs">
      {fmtPct(metric.pct)} ({metric.hit} of {metric.aged})
    </span>
  );
}

export function ActivationReport({ data, loading, error, onRefresh }) {
  const benchmark = data?.benchmarks?.export_completed;

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load activation'}
        </button>
        <span className="text-gray-500 text-xs">
          Export (primary, 14d) and share (value-moment, 14d) by monthly signup cohort.
        </span>
        {data && (
          <button
            type="button"
            disabled={!data.cohorts?.length}
            onClick={() => downloadActivationCsv(activationReportCsv(data.cohorts))}
            className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"
          >
            Download CSV
          </button>
        )}
      </div>

      {benchmark && (
        <p className="text-gray-500 text-[11px] mb-3">
          Benchmark: {fmtPct(benchmark.target)} target, {fmtPct(benchmark.median)} industry median, {fmtPct(benchmark.great)}+ is a fundable talking point.
        </p>
      )}

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
                <th className="text-left px-3 py-2.5">Signup month</th>
                <th className="text-right px-3 py-2.5">Signups</th>
                <th className="text-right px-3 py-2.5">Export &lt;=14d</th>
                <th className="text-right px-3 py-2.5">Share &lt;=14d</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((row) => (
                <tr key={row.cohort_month} className="border-b border-white/5" data-testid="activation-cohort-row">
                  <td className="px-3 py-2 text-gray-200 text-xs whitespace-nowrap">
                    {row.cohort_month}
                    {row.maturing && (
                      <span className="ml-2 text-amber-400 text-[10px] uppercase tracking-wider" data-testid="maturing-label">
                        maturing
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-300 text-xs">{row.signups}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <MetricCell metric={row.export_completed} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <MetricCell metric={row.share_completed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
