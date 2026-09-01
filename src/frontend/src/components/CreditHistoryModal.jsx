import { useEffect, useState } from 'react';
import { X, Coins, Loader2 } from 'lucide-react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useCreditStore } from '../stores/creditStore';

/**
 * CreditHistoryModal - Minimal usage history (T4940)
 *
 * Fed by the existing /credits/transactions endpoint. Shows each transaction's
 * source, signed amount, date, and the running balance after it. Running balance
 * derives from the authoritative current balance (creditStore) walked backwards
 * through the newest-first transaction list — no fabricated numbers.
 */

const SOURCE_LABELS = {
  stripe_purchase: 'Credit purchase',
  framing_usage: 'Video export',
  framing_refund: 'Export refund',
  framing_export: 'Video export',
  multi_clip_export: 'Video export',
  export: 'Video export',
  game_upload: 'Game upload',
  storage_extension: 'Storage extension',
  quest_reward: 'Quest reward',
  quest_upfront: 'Welcome credits',
  admin_grant: 'Admin grant',
  signup: 'Signup bonus',
  refund: 'Refund',
};

function labelFor(source) {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source && source.startsWith('set_to_')) return 'Balance adjustment';
  // Humanize any unmapped source rather than showing a raw enum.
  return source ? source.replace(/_/g, ' ') : 'Transaction';
}

function formatDate(iso) {
  if (!iso) return '';
  // SQLite timestamps are UTC without a zone marker — normalize to UTC.
  const normalized = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function CreditHistoryModal({ onClose }) {
  const balance = useCreditStore((s) => s.balance);
  const [txns, setTxns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/api/credits/transactions?limit=50`);
        if (!res.ok) throw new Error(`Failed to load history (${res.status})`);
        const data = await res.json();
        if (!cancelled) setTxns(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Newest-first: the first row's post-balance IS the current balance; older
  // rows subtract each newer signed amount to recover their running balance.
  const rows = [];
  if (txns) {
    let running = balance;
    for (const tx of txns) {
      rows.push({ ...tx, balanceAfter: running });
      running -= tx.amount;
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins size={20} className="text-yellow-400" />
            Usage history
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {!txns && !error && (
          <div className="py-8 flex justify-center">
            <Loader2 size={24} className="text-purple-400 animate-spin" />
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {txns && txns.length === 0 && (
          <p className="text-gray-400 text-sm py-6 text-center">
            No credit activity yet.
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-y-auto -mx-2">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 text-xs">
                  <th className="text-left font-medium px-2 pb-2">Activity</th>
                  <th className="text-right font-medium px-2 pb-2">Amount</th>
                  <th className="text-right font-medium px-2 pb-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((tx) => (
                  <tr key={tx.id} className="border-t border-white/5">
                    <td className="px-2 py-2">
                      <div className="text-gray-200">{labelFor(tx.source)}</div>
                      <div className="text-gray-500 text-xs">
                        {formatDate(tx.created_at)}
                        {tx.video_seconds ? ` · ${Math.round(tx.video_seconds)}s` : ''}
                      </div>
                    </td>
                    <td className={`px-2 py-2 text-right font-medium ${tx.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount}
                    </td>
                    <td className="px-2 py-2 text-right text-gray-300">{tx.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-gray-500 text-xs text-center">
          Showing your most recent credit activity.
        </p>
      </div>
    </div>
  );
}

export default CreditHistoryModal;
