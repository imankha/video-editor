import { RefreshCw } from 'lucide-react';
import { CREDIT_PACKS } from '../../config/pricing';

// T13330: pure view of purchases by pack (payments ledger). Counts and gross
// cents per pack only; nothing per user.

const WINDOWS = [
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'all', label: 'All time' },
];

// Display name + credits of the CURRENT ladder per pack key (payments.pack stores the key).
const PACK_BY_KEY = Object.fromEntries(CREDIT_PACKS.map((p) => [p.key, p]));

function packLabel(key) {
  const p = PACK_BY_KEY[key];
  return p ? `${p.name} (${p.credits.toLocaleString()} credits)` : key;
}

const fmtMoney = (cents) => `$${(cents / 100).toFixed(2)}`;

export function PackMixTable({ data, loading, error, onRefresh }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {data ? 'Refresh' : 'Load pack mix'}
        </button>
        <span className="text-gray-500 text-xs">
          Purchases by pack from the payments ledger (refunds excluded). Honors the test-account filter.
        </span>
      </div>

      {error && <p className="text-red-400 text-sm mb-3">Error: {error}</p>}
      {loading && !data && <p className="text-gray-500 text-sm">Loading...</p>}

      {data && (
        <p data-testid="pack-mix-note" className="text-gray-500 text-[11px] mb-3">
          Pack names and credits show the current ladder. Rows for the key &quot;starter&quot; dated before
          2026-10-23 were the old 340-credit $12.99 pack, not the current 150-credit one.
        </p>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {WINDOWS.map(({ key, label }) => {
            const rows = data.windows?.[key] || [];
            return (
              <div key={key} data-testid={`pack-mix-${key}`} className="bg-white/5 rounded-lg p-4 border border-white/10">
                <div className="text-gray-400 text-xs uppercase tracking-wider mb-2">{label}</div>
                {rows.length === 0 ? (
                  <p className="text-gray-500 text-xs">No purchases.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-500 text-left">
                        <th className="font-normal">Pack</th>
                        <th className="font-normal text-right">Sold</th>
                        <th className="font-normal text-right">Gross</th>
                      </tr>
                    </thead>
                    <tbody className="text-gray-200">
                      {rows.map((r) => (
                        <tr key={r.pack}>
                          <td>{packLabel(r.pack)}</td>
                          <td className="text-right">{r.purchases}</td>
                          <td className="text-right">{fmtMoney(r.gross_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
