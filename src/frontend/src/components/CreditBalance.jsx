import { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { useCreditStore } from '../stores/creditStore';
import { useIsAuthenticated } from '../stores/authStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { BuyCreditsModal } from './BuyCreditsModal';

/**
 * CreditBalance - Small pill showing credit balance in the header (T530)
 *
 * Subscribes to export complete/error events so the balance stays in sync
 * with backend truth after any credit-affecting operation (deduction, refund).
 * Same event-driven pattern as the downloads count badge in useDownloads.js.
 *
 * T525: Click to open BuyCreditsModal for direct credit purchases.
 */
export function CreditBalance() {
  const isAuthenticated = useIsAuthenticated();
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);
  const fetchCredits = useCreditStore((s) => s.fetchCredits);
  const [showBuyCredits, setShowBuyCredits] = useState(false);

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
    <>
      <button
        onClick={() => {
          console.log('[CreditBalance] Clicked — opening BuyCreditsModal');
          setShowBuyCredits(true);
        }}
        className="flex items-center gap-1 px-2 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-sm text-white/80 transition-colors cursor-pointer"
        title={`${balance} credits — click to buy more`}
      >
        <Coins size={14} className="text-yellow-400 shrink-0" />
        <span className="font-medium">{balance}</span>
      </button>

      {showBuyCredits && (
        <BuyCreditsModal onClose={() => setShowBuyCredits(false)} />
      )}
    </>
  );
}
