import { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

/**
 * CreditGrantModal — Grant or set credits for one or many users (T4860).
 *
 * Props:
 * - users: array of { user_id, email, credits }. Single-user callers pass [user].
 * - onClose: called when modal is dismissed
 *
 * Bulk (n>1) only supports grant mode (the `set` toggle is hidden) and hits the
 * bulk endpoint; single-user keeps the original grant/set behavior.
 */
export function CreditGrantModal({ users, onClose }) {
  const isBulk = users.length > 1;
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('grant'); // 'grant' or 'set'
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState(null); // bulk result summary

  const grantCredits = useAdminStore(state => state.grantCredits);
  const setCredits = useAdminStore(state => state.setCredits);
  const bulkGrantCredits = useAdminStore(state => state.bulkGrantCredits);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (isNaN(n) || (mode === 'grant' && n <= 0) || (mode === 'set' && n < 0)) {
      setError(mode === 'grant' ? 'Enter a positive number' : 'Enter 0 or a positive number');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      if (isBulk) {
        const data = await bulkGrantCredits(users.map(u => u.user_id), n);
        const failedIds = data.results.filter(r => !r.ok);
        setSummary({ granted: data.granted, failed: data.failed, failedIds });
        setSuccess(true);
        setAmount('');
      } else {
        const userId = users[0].user_id;
        if (mode === 'set') {
          await setCredits(userId, n);
        } else {
          await grantCredits(userId, n);
        }
        setSuccess(true);
        setAmount('');
        setTimeout(() => onClose(), 1200);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [amount, mode, isBulk, users, grantCredits, setCredits, bulkGrantCredits, onClose]);

  const title = isBulk
    ? `Grant credits to ${users.length} users`
    : (mode === 'grant' ? 'Grant Credits' : 'Set Credits');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {isBulk ? (
          <p className="text-gray-400 text-sm mb-3">
            {users.length} users selected
          </p>
        ) : (
          <p className="text-gray-400 text-sm mb-3">
            {users[0].email || users[0].user_id}
            <span className="ml-2 text-gray-500">
              ({users[0].credits == null ? '—' : users[0].credits} current)
            </span>
          </p>
        )}

        {!isBulk && (
          <div className="flex gap-1 mb-3 bg-gray-700/50 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => { setMode('grant'); setError(null); }}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'grant' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Grant (add)
            </button>
            <button
              type="button"
              onClick={() => { setMode('set'); setError(null); }}
              className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'set' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Set (exact)
            </button>
          </div>
        )}

        {success ? (
          isBulk && summary ? (
            <div className="text-sm py-2">
              <p className="text-green-400 text-center">
                Granted {summary.granted}
                {summary.failed > 0 && `, ${summary.failed} failed`}
              </p>
              {summary.failedIds.length > 0 && (
                <ul className="mt-2 text-red-400 text-xs max-h-24 overflow-auto">
                  {summary.failedIds.map(r => (
                    <li key={r.user_id}>{r.user_id}: {r.error}</li>
                  ))}
                </ul>
              )}
              <button
                onClick={onClose}
                className="mt-3 w-full bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <p className="text-green-400 text-sm text-center py-2">
              {mode === 'grant' ? 'Credits granted!' : 'Credits updated!'}
            </p>
          )
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="number"
              min={mode === 'set' ? '0' : '1'}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder={mode === 'grant' ? 'Amount to add' : 'New balance'}
              className="bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              autoFocus
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              {submitting
                ? (mode === 'grant' ? 'Granting…' : 'Setting…')
                : (isBulk ? `Grant to ${users.length} users` : (mode === 'grant' ? 'Grant' : 'Set'))}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
