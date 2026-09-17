import React from 'react';
import { RefreshCw } from 'lucide-react';

// T10270: pure view -- receives rows+rates as props, does no fetching, does
// no null-guarding of the rate halves (the backend contract ships
// attempts+succeeded+failed together, always -- see design doc §3.6's
// honesty rules / feedback_tries_vs_success_must_both_show).

function RateCard({ label, rate }) {
  const displayPct = rate.rate_pct == null ? '--' : `${rate.rate_pct}%`;
  return (
    <div className="bg-white/5 rounded-lg p-4 border border-white/10">
      <div className="text-gray-400 text-xs uppercase tracking-wider mb-1">{label}</div>
      <div className="text-2xl font-bold text-white">{displayPct}</div>
      <div className="text-xs mt-0.5 text-gray-400">
        {rate.succeeded}/{rate.attempts} succeeded ({rate.failed} failed)
      </div>
      {rate.denominator_note && (
        <div className="text-[10px] mt-1 text-gray-500">{rate.denominator_note}</div>
      )}
    </div>
  );
}

export function UploadFailuresPanel({ data, loading, error, onRefresh }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load upload failures'}
        </button>
        <span className="text-gray-500 text-xs">
          On-demand -- date-scoped, cross-user list of every failed upload since the last deploy.
        </span>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}

      {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}

      {data && data.migrated === false && (
        <p className="text-yellow-400 text-sm">
          Not migrated yet on this environment -- run the postgres migration first.
        </p>
      )}

      {data && data.migrated !== false && (
        <>
          <div className="text-gray-500 text-xs mb-3">
            Since build {data.window.since_build} ({data.window.commit_sha}) --{' '}
            {data.window.since_date} to {data.window.until_date} -- {data.window.rows_at_this_build}{' '}
            row(s) at this build
          </div>

          <div className="grid grid-cols-2 gap-4 mb-4">
            <RateCard label="Game Upload Rate" rate={data.rates.game} />
            <RateCard label="Clip Upload Rate" rate={data.rates.clip} />
          </div>

          {data.rows.length === 0 ? (
            <p className="text-gray-500 text-sm py-3">No failures recorded in this window.</p>
          ) : (
            <div className="rounded-lg border border-white/10 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                    <th className="text-left px-3 py-2.5">When</th>
                    <th className="text-left px-3 py-2.5">Kind</th>
                    <th className="text-left px-3 py-2.5">Stage</th>
                    <th className="text-left px-3 py-2.5">Reason</th>
                    <th className="text-left px-3 py-2.5">User</th>
                    <th className="text-left px-3 py-2.5">Origin</th>
                    <th className="text-left px-3 py-2.5">Terminal</th>
                    <th className="text-left px-3 py-2.5">Filename</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="px-3 py-2.5 text-gray-300 text-xs">{row.occurred_at}</td>
                      <td className="px-3 py-2.5 text-gray-300 text-xs">{row.kind}</td>
                      <td className="px-3 py-2.5 text-gray-300 text-xs">{row.stage}</td>
                      <td className="px-3 py-2.5 text-gray-300 text-xs">{row.reason}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{row.user_id || '--'}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{row.origin}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{row.terminal ? 'yes' : 'no'}</td>
                      <td className="px-3 py-2.5 text-gray-400 text-xs">{row.original_filename || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="text-gray-500 text-xs mt-2">{data.total} total matching row(s)</div>
        </>
      )}
    </div>
  );
}
