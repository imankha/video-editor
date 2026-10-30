const STAGE_COLS = [
  { key: 'uploaded_pct', label: 'Uploaded' },
  { key: 'clipped_pct', label: 'Clipped' },
  { key: 'exported_pct', label: 'Exported' },
  { key: 'shared_pct', label: 'Shared' },
  { key: 'purchased_pct', label: 'Purchased' },
];

const BUILD_TITLE =
  'The server build when the account signed up. A client still on an older app shell '
  + 'that signs up against a newer server counts under the server build.';

function cellColor(pct) {
  if (pct >= 60) return 'bg-green-500/30 text-green-300';
  if (pct >= 40) return 'bg-green-500/15 text-green-400';
  if (pct >= 20) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/15 text-red-400';
}

// T14000: the CohortGrid layout keyed by signup build (GET /api/admin/analytics/builds).
// "unrecorded" = accounts that signed up before build capture; it has no build to filter by.
export function BuildsGrid({ data, onRowClick, selectedBuild }) {
  if (!data?.builds?.length && !data?.unattributed_revenue_cents) {
    return <p className="text-gray-500 text-sm">No build data available.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5" title={BUILD_TITLE}>Build</th>
            <th className="text-left px-3 py-2.5">First Signup</th>
            <th className="text-right px-3 py-2.5">Signups</th>
            {STAGE_COLS.map(c => (
              <th key={c.key} className="text-center px-3 py-2.5">{c.label}</th>
            ))}
            <th className="text-right px-3 py-2.5">Revenue</th>
            <th className="text-right px-3 py-2.5">Time-to-Export</th>
            <th className="text-right px-3 py-2.5">7d Return</th>
          </tr>
        </thead>
        <tbody>
          {(data.builds || []).map(row => {
            const recorded = row.build !== 'unrecorded';
            return (
              <tr
                key={row.build}
                className={`border-b border-white/5 ${recorded ? 'cursor-pointer hover:bg-white/5' : ''} ${selectedBuild === row.build ? 'bg-purple-500/15 border-l-2 border-l-purple-500' : ''}`}
                onClick={() => recorded && onRowClick && onRowClick(row.build)}
              >
                <td className="px-3 py-2 text-gray-300 text-xs whitespace-nowrap">
                  {recorded
                    ? `#${row.build} (${row.commit_sha ? row.commit_sha.slice(0, 7) : '?'})`
                    : <span className="italic text-gray-400">Unrecorded</span>}
                </td>
                <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                  {row.first_signup_at.slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-right text-gray-400 text-xs">{row.signups}</td>
                {STAGE_COLS.map(c => (
                  <td key={c.key} className="px-1 py-1 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cellColor(row[c.key])}`}>
                      {row[c.key]}%
                    </span>
                  </td>
                ))}
                <td className="px-3 py-2 text-right text-green-400 text-xs">
                  {row.revenue_cents ? `$${(row.revenue_cents / 100).toFixed(0)}` : '$0'}
                </td>
                <td className="px-3 py-2 text-right text-gray-400 text-xs">
                  {row.time_to_export_days != null ? `${row.time_to_export_days}d` : '--'}
                </td>
                <td className="px-3 py-2 text-right text-gray-400 text-xs">
                  {row.return_7d_pct}%
                </td>
              </tr>
            );
          })}
          {data.unattributed_revenue_cents ? (
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 text-gray-400 text-xs italic" colSpan={8}>
                Unattributed <span className="text-gray-500">(deleted or out-of-window payers)</span>
              </td>
              <td className="px-3 py-2 text-right text-green-400 text-xs">
                {`$${(data.unattributed_revenue_cents / 100).toFixed(0)}`}
              </td>
              <td className="px-3 py-2" colSpan={2} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
