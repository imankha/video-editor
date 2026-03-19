import { useState } from 'react';
import { X, Coins, Star, Gem, Loader2 } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';

/**
 * BuyCreditsModal - Credit pack selection for Stripe purchase (T525)
 *
 * Shows three credit packs. Clicking one creates a Stripe Checkout Session
 * and redirects to Stripe's hosted payment page.
 *
 * Props:
 *   onClose: () => void - close handler
 */

const PACKS = [
  {
    key: 'starter',
    name: 'Starter',
    credits: 120,
    price: '$4.99',
    minutes: '~2 min',
    icon: Coins,
    badge: null,
    badgeColor: null,
  },
  {
    key: 'popular',
    name: 'Popular',
    credits: 400,
    price: '$12.99',
    minutes: '~7 min',
    icon: Star,
    badge: 'Most Popular',
    badgeColor: 'bg-purple-600',
  },
  {
    key: 'pro',
    name: 'Pro',
    credits: 1000,
    price: '$24.99',
    minutes: '~17 min',
    icon: Gem,
    badge: 'Best Value',
    badgeColor: 'bg-green-600',
  },
];

export function BuyCreditsModal({ onClose }) {
  const [loadingPack, setLoadingPack] = useState(null);
  const [error, setError] = useState(null);

  async function handleSelectPack(packKey) {
    setLoadingPack(packKey);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pack: packKey }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Checkout failed (${res.status})`);
      }

      const { checkout_url } = await res.json();
      window.location.href = checkout_url;
    } catch (err) {
      setError(err.message);
      setLoadingPack(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins size={20} className="text-yellow-400" />
            Buy Credits
          </h3>
          <button
            onClick={onClose}
            disabled={!!loadingPack}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {PACKS.map((pack) => {
            const Icon = pack.icon;
            const isLoading = loadingPack === pack.key;
            const isDisabled = loadingPack && !isLoading;

            return (
              <button
                key={pack.key}
                onClick={() => handleSelectPack(pack.key)}
                disabled={isDisabled || isLoading}
                className={[
                  'w-full text-left p-4 rounded-lg border transition-all relative',
                  isDisabled
                    ? 'border-white/5 bg-gray-700/30 opacity-50 cursor-not-allowed'
                    : isLoading
                    ? 'border-purple-500 bg-purple-900/20 cursor-wait'
                    : 'border-white/10 bg-gray-700/50 hover:border-purple-500/50 hover:bg-gray-700 cursor-pointer',
                ].join(' ')}
              >
                {pack.badge && (
                  <span
                    className={`absolute -top-2 right-3 px-2 py-0.5 rounded-full text-xs font-medium text-white ${pack.badgeColor}`}
                  >
                    {pack.badge}
                  </span>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isLoading ? (
                      <Loader2 size={20} className="text-purple-400 animate-spin" />
                    ) : (
                      <Icon size={20} className="text-yellow-400" />
                    )}
                    <div>
                      <div className="text-white font-medium">
                        {pack.credits.toLocaleString()} credits
                      </div>
                      <div className="text-gray-400 text-xs">{pack.minutes} of video</div>
                    </div>
                  </div>
                  <div className="text-white font-semibold">{pack.price}</div>
                </div>
              </button>
            );
          })}
        </div>

        {error && (
          <p className="mt-3 text-red-400 text-sm">{error}</p>
        )}

        <p className="mt-4 text-gray-500 text-xs text-center">
          Credits never expire. Secure checkout by Stripe.
        </p>

        <div className="mt-4">
          <Button variant="secondary" onClick={onClose} fullWidth disabled={!!loadingPack}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
