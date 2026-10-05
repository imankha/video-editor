import { Coins } from 'lucide-react';
import { CREDIT_COST_ROW } from '../../config/displayNames';

/**
 * T11770: the credit cost/balance row shared by the four credit modals (upload
 * game, attach video, add footage, extend storage). It replaces a
 * `justify-between` row whose two text blocks wrapped and interleaved at 390px
 * ("2 credits - keeps your video for 30 Balance: days 54").
 *
 * Cost and balance are two `whitespace-nowrap` spans in a `flex-wrap` pair, so a
 * narrow width drops the balance to its own line whole, never mid-phrase. The
 * retention note sits on its own line below. Same layout at every width.
 *
 * Props:
 *  - cost    (number)  credits this action charges
 *  - balance (number)  the account's current balance; a non-numeric placeholder
 *                      (e.g. '…' while loading) renders without the short-balance red
 *  - note    (string)  caller-supplied line below the row (wording differs per modal)
 *
 * When `balance < cost` the balance renders red. The caller keeps rendering its
 * own buy-credits action.
 */
export function CreditCostRow({ cost, balance, note }) {
  const short = typeof balance === 'number' && typeof cost === 'number' && balance < cost;
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-gray-700/50 px-3 py-2 text-sm text-gray-300">
      <div className="flex flex-wrap justify-between gap-x-3">
        <span className="flex items-center gap-2 whitespace-nowrap">
          <Coins size={14} className="shrink-0 text-yellow-400" />
          {CREDIT_COST_ROW.COST(cost)}
        </span>
        <span className={`whitespace-nowrap font-medium ${short ? 'text-red-400' : 'text-white'}`}>
          {CREDIT_COST_ROW.BALANCE(balance)}
        </span>
      </div>
      {note && <p className="text-xs text-gray-400">{note}</p>}
    </div>
  );
}
