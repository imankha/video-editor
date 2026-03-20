import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

/**
 * CreditGrantModal — Grant or set credits for a user from the admin panel.
 *
 * Props:
 * - user: { user_id, email, credits }
 * - onClose: called when modal is dismissed
 */
export function CreditGrantModal({ user, onClose }) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('grant'); // 'grant' or 'set'
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const grantCredits = useAdminStore(state => state.grantCredits);
  const setCredits = useAdminStore(state => state.setCredits);
  const grantState = useAdminStore(state => state.grantState[user.user_id]);
  const loading = grantState?.loading;

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (isNaN(n) || (mode === 'grant' && n <= 0) || (mode === 'set' && n < 0)) {
      setError(mode === 'grant' ? 'Enter a positive number' : 'Enter 0 or a positive number');
      return;
    }
    setError(null);
    try {
      if (mode === 'set') {
        await setCredits(user.user_id, n);
      } else {
        await grantCredits(user.user_id, n);
      }
      setSuccess(true);
      setAmount('');
      setTimeout(() => onClose(), 1200);
    } catch (err) {
      setError(err.message);
    }
  }, [amount, mode, grantCredits, setCredits, user.user_id, onClose]);

  const handleBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={handleBackdrop}
    >
      <div className="bg-gray-800 border border-white/10 rounded-xl p-6 w-80 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">
            {mode === 'grant' ? 'Grant Credits' : 'Set Credits'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-3">
          {user.email || user.user_id}
          <span className="ml-2 text-gray-500">({user.credits} current)</span>
        </p>

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

        {success ? (
          <p className="text-green-400 text-sm text-center py-2">
            {mode === 'grant' ? 'Credits granted!' : 'Credits updated!'}
          </p>
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
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              {loading ? (mode === 'grant' ? 'Granting…' : 'Setting…') : (mode === 'grant' ? 'Grant' : 'Set')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
