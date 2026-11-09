import { RefreshCw } from 'lucide-react';

// T14950: "Total exports by sport" per month, read from T7400's rollup_action_by_sport
// table (one in-memory read of the newest rollup run -- no per-user DB access). "True"
// exports = credits_consumed: the actual billing debit, one row per paid export, so it
// never double-counts a user who also fired export_completed for the same export.
const EXPORT_ACTION = 'credits_consumed';

// Pure: rollup rows -> [{ month, sports: [{ sport, exports, distinctUsers }] }], sports
// sorted by exports descending within each month, months sorted ascending.
export function groupBySportByMonth(rows) {
  const byMonth = new Map();
  for (const row of rows ?? []) {
    if (row.action !== EXPORT_ACTION) continue;
    if (!byMonth.has(row.month)) byMonth.set(row.month, []);
    byMonth.get(row.month).push({
      sport: row.sport,
      exports: row.events,
      distinctUsers: row.distinct_users,
    });
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, sports]) => ({
      month,
      sports: [...sports].sort((a, b) => b.exports - a.exports),
    }));
}

export function BySportTable({ data, loading, error, onRefresh }) {
  const months = groupBySportByMonth(data?.rows);
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load by sport'}
        </button>
        <span className="text-gray-500 text-xs">
          Total exports by sport, from the analytics.sqlite rollup (Run rollup above to refresh it).
        </span>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}

      {data && (
        <p data-testid="by-sport-overlap-note" className="text-gray-500 text-[11px] mb-3">
          A user who exports under two sports counts under each sport: distinct-user totals
          overlap across sports and will not sum to the all-sport total. &quot;no_sport&quot;
          is a profile explicitly tagged sport-less; &quot;unrecorded&quot; is history from
          before exports carried a sport tag.
        </p>
      )}

      {data && months.length === 0 && <p className="text-gray-500 text-xs">No export data yet.</p>}

      {data && months.length > 0 && (
        <div className="space-y-4">
          {months.map(({ month, sports }) => (
            <div key={month} data-testid={`by-sport-month-${month}`} className="bg-white/5 rounded-lg p-4 border border-white/10">
              <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">{month}</div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 text-left">
                    <th className="font-normal">Sport</th>
                    <th className="font-normal text-right">Exports</th>
                    <th className="font-normal text-right">Distinct users</th>
                  </tr>
                </thead>
                <tbody className="text-gray-200">
                  {sports.map((s) => (
                    <tr key={s.sport}>
                      <td>{s.sport}</td>
                      <td className="text-right">{s.exports}</td>
                      <td className="text-right">{s.distinctUsers}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
