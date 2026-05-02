import React, { useState, useCallback, useMemo } from 'react';
import { X, Coins, HardDrive, Calendar } from 'lucide-react';
import { Button } from './shared/Button';
import { BuyCreditsModal } from './BuyCreditsModal';
import { toast } from './shared';
import { useCreditStore } from '../stores/creditStore';
import { daysPerCredit, calculateExtensionCost } from '../utils/storageCost';
import { API_BASE } from '../config';

function formatDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatSize(bytes) {
  if (!bytes) return 'Unknown';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MB`;
}

export function StorageExtensionModal({ game, onClose, onExtensionSuccess }) {
  const [credits, setCredits] = useState(1);
  const [isExtending, setIsExtending] = useState(false);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const creditBalance = useCreditStore(state => state.balance);
  const fetchCredits = useCreditStore(state => state.fetchCredits);

  const step = useMemo(() => daysPerCredit(game.video_size || 0), [game.video_size]);

  const maxCredits = useMemo(() => {
    const maxDays = 365;
    return Math.max(1, Math.ceil(maxDays / step));
  }, [step]);

  const extensionDays = credits * step;

  const currentExpiry = useMemo(() => {
    if (game.storage_expires_at) {
      const d = new Date(game.storage_expires_at);
      return d > new Date() ? d : new Date();
    }
    return new Date();
  }, [game.storage_expires_at]);

  const newExpiry = useMemo(() => {
    const d = new Date(currentExpiry);
    d.setDate(d.getDate() + extensionDays);
    return d;
  }, [currentExpiry, extensionDays]);

  const daysLeft = useMemo(() => {
    if (!game.storage_expires_at) return null;
    const now = new Date();
    const expiry = new Date(game.storage_expires_at);
    return Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  }, [game.storage_expires_at]);

  const isExpired = daysLeft !== null && daysLeft <= 0;

  const extendStorage = useCallback(async () => {
    setIsExtending(true);
    try {
      const res = await fetch(`${API_BASE}/api/games/${game.id}/extend-storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ days: extensionDays }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail?.error || 'Extension failed');
      }
      const data = await res.json();
      await fetchCredits();
      toast.success(`Storage extended until ${formatDate(new Date(data.new_expires_at))}`);
      onExtensionSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err.message || 'Failed to extend storage');
    } finally {
      setIsExtending(false);
    }
  }, [game.id, extensionDays, fetchCredits, onExtensionSuccess, onClose]);

  const handleExtend = useCallback(() => {
    if (creditBalance < credits) {
      setShowBuyCredits(true);
      return;
    }
    extendStorage();
  }, [creditBalance, credits, extendStorage]);

  const handlePaymentSuccess = useCallback(async () => {
    setShowBuyCredits(false);
    await fetchCredits();
    toast.success('Credits purchased! Extending storage...');
    await extendStorage();
  }, [fetchCredits, extendStorage]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-600/20 rounded-lg">
              <Calendar size={20} className="text-yellow-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Extend Storage</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Game info */}
          <div className="text-sm">
            <p className="text-white font-medium">{game.name}</p>
            <p className="text-gray-400 mt-0.5">
              {isExpired
                ? 'Expired'
                : daysLeft !== null
                  ? `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${formatDate(new Date(game.storage_expires_at))})`
                  : 'No expiry set'}
            </p>
          </div>

          {/* Credit slider */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Extend by:
            </label>
            <input
              type="range"
              min={1}
              max={maxCredits}
              value={credits}
              onChange={(e) => setCredits(Number(e.target.value))}
              className="w-full accent-yellow-400"
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>1 credit ({step}d)</span>
              <span>{maxCredits} credits ({maxCredits * step}d)</span>
            </div>
          </div>

          {/* Extension details */}
          <div className="bg-gray-900/50 rounded-lg p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Extension</span>
              <span className="text-white">+{extensionDays} days &rarr; {formatDate(newExpiry)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 flex items-center gap-1">
                <HardDrive size={12} /> Game size
              </span>
              <span className="text-white">{formatSize(game.video_size)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400 flex items-center gap-1">
                <Coins size={12} className="text-yellow-400" /> Cost
              </span>
              <span className="text-white font-medium">{credits} credit{credits !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Balance */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg text-sm bg-gray-700/50 text-gray-300">
            <div className="flex items-center gap-2">
              <Coins size={14} className="text-yellow-400" />
              <span>{credits} credit{credits !== 1 ? 's' : ''} for {extensionDays} days</span>
            </div>
            <span className="font-medium text-white">Balance: {creditBalance}</span>
          </div>

          {/* Extend button */}
          <Button
            variant="success"
            size="lg"
            onClick={handleExtend}
            disabled={isExtending}
            className="w-full"
          >
            {isExtending ? 'Extending...' : `Extend Storage — ${credits} credit${credits !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>

      {showBuyCredits && (
        <BuyCreditsModal
          onClose={() => setShowBuyCredits(false)}
          onPaymentSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
