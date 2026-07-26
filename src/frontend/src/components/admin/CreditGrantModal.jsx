import { useState, useCallback, useRef } from 'react';
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
 *
 * T5840: credits now commit durably to Postgres within the request itself (no
 * more async R2 upload step), so there is no more "granted but not saved"
 * state to surface. M3 (review round 2): the request/batch id is minted FRESH
 * per submit attempt, keyed on (mode, amount) -- a retry of the SAME amount
 * (e.g. after a transient error, same form still open) reuses it so the retry
 * is idempotent server-side; changing the amount or submitting again after a
 * genuine success is a NEW attempt and gets a new id. Reusing one id for the
 * whole modal lifetime (the old behavior) meant a later "set 100" after an
 * earlier successful "set 100" would silently no-op under the stale key while
 * still showing a green success message -- `applied === false` is now
 * surfaced explicitly instead.
 */
export function CreditGrantModal({ users, onClose }) {
  const isBulk = users.length > 1;
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('grant'); // 'grant' or 'set'
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState(null); // bulk result summary
  const [notApplied, setNotApplied] = useState(false); // single-user: applied === false
  // { key: "mode:amount", id } -- an attempt is only a "retry" (same id) when
  // both mode and amount match the LAST submit, not just "same modal instance".
  const lastAttemptRef = useRef(null);

  const grantCredits = useAdminStore(state => state.grantCredits);
  const setCredits = useAdminStore(state => state.setCredits);
  const bulkGrantCredits = useAdminStore(state => state.bulkGrantCredits);

  const attemptId = useCallback((key) => {
    if (lastAttemptRef.current && lastAttemptRef.current.key === key) {
      return lastAttemptRef.current.id;
    }
    const id = crypto.randomUUID();
    lastAttemptRef.current = { key, id };
    return id;
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (isNaN(n) || (mode === 'grant' && n <= 0) || (mode === 'set' && n < 0)) {
      setError(mode === 'grant' ? 'Enter a positive number' : 'Enter 0 or a positive number');
      return;
    }
    setError(null);
    setSubmitting(true);
    const id = attemptId(`${mode}:${n}`);
    try {
      if (isBulk) {
        const data = await bulkGrantCredits(users.map(u => u.user_id), n, id);
        const failedIds = data.results.filter(r => !r.ok);
        const notAppliedIds = data.results.filter(r => r.ok && r.applied === false);
        setSummary({ granted: data.granted, failed: data.failed, failedIds, notAppliedIds });
        setSuccess(true);
        setAmount('');
        lastAttemptRef.current = null;
      } else {
        const userId = users[0].user_id;
        const result = mode === 'set'
          ? await setCredits(userId, n, id)
          : await grantCredits(userId, n, id);
        setNotApplied(result?.applied === false);
        setSuccess(true);
        setAmount('');
        if (result?.applied !== false) {
          lastAttemptRef.current = null;
          setTimeout(() => onClose(), 1200);
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }, [amount, mode, isBulk, users, grantCredits, setCredits, bulkGrantCredits, onClose, attemptId]);

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
              {summary.notAppliedIds?.length > 0 && (
                <div className="mt-2 text-amber-400 text-xs">
                  <p>
                    {summary.notAppliedIds.length} already applied (no change --
                    this batch was already run):
                  </p>
                  <ul className="mt-1 max-h-24 overflow-auto">
                    {summary.notAppliedIds.map(r => (
                      <li key={r.user_id}>{r.user_id}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={onClose}
                className="mt-3 w-full bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <div className="text-sm text-center py-2">
              <p className={notApplied ? 'text-amber-400' : 'text-green-400'}>
                {notApplied
                  ? 'No change -- already applied'
                  : (mode === 'grant' ? 'Credits granted!' : 'Credits updated!')}
              </p>
              {notApplied && (
                <>
                  <p className="mt-1 text-amber-400 text-xs">
                    This exact request already ran; the balance was not
                    changed again.
                  </p>
                  <button
                    onClick={onClose}
                    className="mt-3 w-full bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
                  >
                    Close
                  </button>
                </>
              )}
            </div>
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
