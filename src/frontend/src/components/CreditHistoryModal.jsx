import { useEffect, useState } from 'react';
import { X, Coins, Loader2 } from 'lucide-react';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useCreditStore } from '../stores/creditStore';
import Guide from './instructions/Guide';
import { resolveGuide } from './instructions/resolveGuide';
import { GuideScope } from './instructions/GuideScope';
import { ERROR_COPY, CREDIT_COPY, CREDIT_HISTORY_LABELS } from '../config/displayNames';
import { userErrorMessage } from '../utils/userError';

/**
 * CreditHistoryModal - Minimal usage history (T4940)
 *
 * Fed by the existing /credits/transactions endpoint. Shows each transaction's
 * source, signed amount, date, and the running balance after it. Running balance
 * derives from the authoritative current balance (creditStore) walked backwards
 * through the newest-first transaction list — no fabricated numbers.
 */

const SOURCE_LABELS = {
  stripe_purchase: CREDIT_HISTORY_LABELS.PURCHASE,
  framing_usage: CREDIT_HISTORY_LABELS.HIGHLIGHT,
  framing_refund: CREDIT_HISTORY_LABELS.HIGHLIGHT_REFUND,
  framing_export: CREDIT_HISTORY_LABELS.HIGHLIGHT,
  multi_clip_export: CREDIT_HISTORY_LABELS.HIGHLIGHT,
  export: CREDIT_HISTORY_LABELS.HIGHLIGHT,
  game_upload: CREDIT_HISTORY_LABELS.GAME_UPLOAD,
  storage_extension: CREDIT_HISTORY_LABELS.STORAGE,
  // T11170: both the historic per-quest reward rows (quest_reward) and the lump
  // upfront grant (quest_upfront) are bonus credits now that the grant is
  // decoupled from quests. Display map only -- no Postgres row is touched.
  quest_reward: CREDIT_HISTORY_LABELS.BONUS,
  quest_upfront: CREDIT_HISTORY_LABELS.BONUS,
  admin_grant: CREDIT_HISTORY_LABELS.BONUS,
  signup: CREDIT_HISTORY_LABELS.BONUS,
  refund: CREDIT_HISTORY_LABELS.REFUND,
  new_account_bonus: CREDIT_HISTORY_LABELS.BONUS,
  game_video_add: CREDIT_HISTORY_LABELS.VIDEO_ADDED,
  clip_upload: CREDIT_HISTORY_LABELS.PLAY_UPLOAD,
  clip_upload_refund: CREDIT_HISTORY_LABELS.PLAY_UPLOAD_REFUND,
  admin_set: CREDIT_HISTORY_LABELS.BONUS,
};

function labelFor(source) {
  if (SOURCE_LABELS[source]) return SOURCE_LABELS[source];
  if (source && source.startsWith('set_to_')) return CREDIT_HISTORY_LABELS.BONUS;
  // Humanize any unmapped source rather than showing a raw enum.
  if (!source) return 'Transaction';
  const words = source.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
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
        if (!res.ok) throw new Error(`credit history returned ${res.status}`);
        const data = await res.json();
        if (!cancelled) setTxns(Array.isArray(data) ? data : []);
      } catch (err) {
        if (!cancelled) setError(userErrorMessage(err, ERROR_COPY.LOAD_CREDIT_HISTORY));
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

  const guide = resolveGuide({ screen: 'modal', local: { modal: 'credit-history' } });

  return (
    <GuideScope guides={[guide]}>
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10 max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins size={20} className="text-yellow-400" />
            {CREDIT_COPY.HISTORY_TITLE}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <Guide guide={guide} inline testId="modal-guide" />

        {!txns && !error && (
          <div className="py-8 flex justify-center">
            <Loader2 size={24} className="text-purple-400 animate-spin" />
          </div>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {txns && txns.length === 0 && (
          <p className="text-gray-400 text-sm py-6 text-center">
            {CREDIT_COPY.NO_HISTORY}
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-y-auto scrollbar-thin -mx-2">
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
                        {tx.pending ? <span className="text-yellow-400 font-medium">Pending</span> : formatDate(tx.created_at)}
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
          {CREDIT_COPY.HISTORY_FOOTER}
        </p>
      </div>
    </div>
    </GuideScope>
  );
}

export default CreditHistoryModal;
