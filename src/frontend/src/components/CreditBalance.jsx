import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Coins } from 'lucide-react';
import { useCreditStore } from '../stores/creditStore';
import { useIsAuthenticated } from '../stores/authStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { toast } from './shared';
import { CREDITS, CREDIT_COPY } from '../config/displayNames';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));

/**
 * CreditBalance - Small pill showing credit balance in the header (T530)
 *
 * Subscribes to export complete/error events so the balance stays in sync
 * with backend truth after any credit-affecting operation (deduction, refund).
 * Same event-driven pattern as the downloads count badge in useDownloads.js.
 *
 * T525: Click to open BuyCreditsModal for direct credit purchases.
 *
 * T17200: the T8500 first-run caption under the chip is gone (it sat under the
 * coach's shade); the free-credits sentence is the Home first-run coach line,
 * which cuts this chip (`credit-balance`) out of the shade.
 */
export function CreditBalance() {
  const isAuthenticated = useIsAuthenticated();
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);
  const fetchCredits = useCreditStore((s) => s.fetchCredits);
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  const handlePaymentSuccess = useCallback((credits) => {
    setShowBuyCredits(false);
    fetchCredits();
    toast.success(CREDITS.added(credits));
  }, [fetchCredits]);

  // Subscribe to export events that affect credits
  useEffect(() => {
    if (!isAuthenticated) return;

    const unsubComplete = exportWebSocketManager.addEventListener('*', 'complete', fetchCredits);
    const unsubError = exportWebSocketManager.addEventListener('*', 'error', fetchCredits);

    return () => {
      unsubComplete();
      unsubError();
    };
  }, [isAuthenticated, fetchCredits]);

  if (!isAuthenticated || !loaded) return null;

  return (
    <div className="relative">
      <button
        data-testid="credit-balance"
        onClick={() => {
          console.log('[CreditBalance] Clicked — opening BuyCreditsModal');
          setShowBuyCredits(true);
        }}
        className="flex items-center gap-1 px-2 py-1.5 coarse-pointer:min-h-[44px] coarse-pointer:min-w-[44px] coarse-pointer:justify-center bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white/80 transition-colors cursor-pointer"
        title={CREDIT_COPY.balanceHint(balance)}
      >
        <Coins size={14} className="text-yellow-400 shrink-0" />
        <span className="font-medium">{balance}</span>
      </button>

      {showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            onClose={() => setShowBuyCredits(false)}
            onPaymentSuccess={handlePaymentSuccess}
          />
        </Suspense>
      )}
    </div>
  );
}
