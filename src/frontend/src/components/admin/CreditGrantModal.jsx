import React, { useState, useCallback } from 'react';
import { X } from 'lucide-react';
import { useAdminStore } from '../../stores/adminStore';

/**
 * CreditGrantModal — Grant credits to a user from the admin panel.
 *
 * Props:
 * - user: { user_id, email, credits }
 * - onClose: called when modal is dismissed
 */
export function CreditGrantModal({ user, onClose }) {
  const [amount, setAmount] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const grantCredits = useAdminStore(state => state.grantCredits);
  const grantState = useAdminStore(state => state.grantState[user.user_id]);
  const loading = grantState?.loading;

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const n = parseInt(amount, 10);
    if (!n || n <= 0) {
      setError('Enter a positive number');
      return;
    }
    setError(null);
    try {
      const newBalance = await grantCredits(user.user_id, n);
      setSuccess(true);
      setAmount('');
      // Auto-close after brief success state
      setTimeout(() => onClose(), 1200);
      void newBalance;
    } catch (err) {
      setError(err.message);
    }
  }, [amount, grantCredits, user.user_id, onClose]);

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
          <h3 className="text-white font-semibold">Grant Credits</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <p className="text-gray-400 text-sm mb-4">
          {user.email || user.user_id}
          <span className="ml-2 text-gray-500">({user.credits} current)</span>
        </p>

        {success ? (
          <p className="text-green-400 text-sm text-center py-2">Credits granted!</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <input
              type="number"
              min="1"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="Amount"
              className="bg-gray-700 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-purple-500"
              autoFocus
            />
            {error && <p className="text-red-400 text-xs">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors"
            >
              {loading ? 'Granting…' : 'Grant'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
