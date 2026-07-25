import React from 'react';
import { RefreshCw, Check, AlertTriangle } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

function fmtMoney(cents) {
  if (cents == null) return '—';
  const neg = cents < 0;
  return `${neg ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

// Cause -> badge styling. Drift causes are the enum values from the backend
// classifier (revenue_reconciliation.DriftCause).
const CAUSE_STYLES = {
  refund: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
  dispute: 'bg-red-500/20 text-red-300 border-red-500/40',
  test_mode_era: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
  unknown: 'bg-gray-500/20 text-gray-300 border-gray-500/40',
  aligned: 'bg-green-500/20 text-green-300 border-green-500/40',
};

const CAUSE_LABELS = {
  refund: 'Refund',
  dispute: 'Dispute',
  test_mode_era: 'Test-mode era',
  unknown: 'Unknown',
  aligned: 'Aligned',
};

export function RevenueReconciliation() {
  const data = useAdminStore(s => s.reconciliationData);
  const loading = useAdminStore(s => s.reconciliationLoading);
  const error = useAdminStore(s => s.reconciliationError);
  const fetchReconciliation = useAdminStore(s => s.fetchReconciliation);
  const healReconciliation = useAdminStore(s => s.healReconciliation);

  const drifted = (data?.rows || []).filter(r => r.drifted);

  async function healOne(row) {
    const pendingWarning = row.has_pending_dispute
      ? '\n\nWarning: this user has an OPEN dispute — its Stripe net will shift again once the dispute resolves.'
      : '';
    if (!window.confirm(
      `Adopt Stripe value for ${row.email || row.user_id}?\n\n` +
      `Local ${fmtMoney(row.local_cents)} -> Stripe net ${fmtMoney(row.stripe_net_cents)}` +
      pendingWarning
    )) return;
    try {
      await healReconciliation({ userIds: [row.user_id] });
    } catch { /* error surfaced via store */ }
  }

  async function healAll() {
    if (!window.confirm(
      `Adopt the Stripe value for ALL ${drifted.length} drifted user(s)? ` +
      `This overwrites their local total_spent_cents.`
    )) return;
    try {
      await healReconciliation({ allDrifted: true });
    } catch { /* error surfaced via store */ }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={fetchReconciliation}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Re-run reconciliation' : 'Run reconciliation'}
        </button>
        <span className="text-gray-500 text-xs">
          On-demand — compares local revenue against Stripe (net of refunds and lost disputes).
        </span>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}

      {loading && !data && <p className="text-gray-500 text-sm">Running reconciliation…</p>}

      {data && (
        <>
          {/* Summary */}
          <div className="flex flex-wrap gap-4 mb-4 text-xs">
            <div className="text-gray-400">
              Drifted: <span className="text-white font-semibold">{data.summary.drifted_users}</span>
              {' / '}{data.summary.total_users}
            </div>
            <div className="text-gray-400">
              Local total: <span className="text-white">{fmtMoney(data.summary.total_local_cents)}</span>
            </div>
            <div className="text-gray-400">
              Stripe net total: <span className="text-green-400">{fmtMoney(data.summary.total_stripe_net_cents)}</span>
            </div>
            <div className="text-gray-400">
              Net drift: <span className="text-yellow-400">{fmtMoney(data.summary.total_delta_cents)}</span>
            </div>
          </div>

          {drifted.length === 0 ? (
            <div className="flex items-center gap-2 text-green-400 text-sm py-3">
              <Check size={16} /> All users reconciled — no drift against Stripe.
            </div>
          ) : (
            <>
              <div className="flex justify-end mb-2">
                <button
                  onClick={healAll}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs rounded-lg bg-green-500/20 text-green-300 border border-green-500/40 hover:bg-green-500/30 disabled:opacity-50 transition-colors"
                >
                  Adopt Stripe value for all ({drifted.length})
                </button>
              </div>

              <div className="rounded-lg border border-white/10 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="text-left px-3 py-2.5">User</th>
                      <th className="text-right px-3 py-2.5">Local</th>
                      <th className="text-right px-3 py-2.5">Stripe net</th>
                      <th className="text-right px-3 py-2.5">Delta</th>
                      <th className="text-left px-3 py-2.5">Cause</th>
                      <th className="text-right px-3 py-2.5">PIs</th>
                      <th className="text-right px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {drifted.map(row => (
                      <tr key={row.user_id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                        <td className="px-3 py-2.5 text-gray-200 text-xs">
                          {row.email || <span className="text-gray-500">{row.user_id}</span>}
                          {row.has_pending_dispute && (
                            <span className="ml-2 inline-flex items-center gap-1 text-orange-400" title="Has an open dispute">
                              <AlertTriangle size={11} /> dispute
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{fmtMoney(row.local_cents)}</td>
                        <td className="px-3 py-2.5 text-right text-green-400 text-xs">{fmtMoney(row.stripe_net_cents)}</td>
                        <td className="px-3 py-2.5 text-right text-yellow-400 text-xs">{fmtMoney(row.delta_cents)}</td>
                        <td className="px-3 py-2.5 text-left text-xs">
                          <span className={`px-2 py-0.5 rounded border text-[10px] ${CAUSE_STYLES[row.cause] || CAUSE_STYLES.unknown}`}>
                            {CAUSE_LABELS[row.cause] || row.cause}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{row.pi_count}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            onClick={() => healOne(row)}
                            disabled={loading}
                            className="px-2 py-1 text-[11px] rounded bg-white/10 text-gray-200 border border-white/10 hover:bg-white/20 disabled:opacity-50 transition-colors"
                          >
                            Adopt Stripe value
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
