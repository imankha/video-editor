import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { Coins } from 'lucide-react';
import { useCreditStore } from '../stores/creditStore';
import { useIsAuthenticated } from '../stores/authStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { toast } from './shared';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));

// T8500 first-run explainer dismissal - IN-MEMORY ONLY, deliberately never
// persisted (no localStorage, no backend - project no-persisted-view-state
// rule). Module-level so a remount within the session stays dismissed; after
// a reload the hint is still gone for anyone with a game (derived prop), and
// at worst re-shows one passive caption for a zero-game account.
let _firstRunHintDismissed = false;
export function resetFirstRunHintDismissalForTests() { _firstRunHintDismissed = false; }

/**
 * CreditBalance - Small pill showing credit balance in the header (T530)
 *
 * Subscribes to export complete/error events so the balance stays in sync
 * with backend truth after any credit-affecting operation (deduction, refund).
 * Same event-driven pattern as the downloads count badge in useDownloads.js.
 *
 * T525: Click to open BuyCreditsModal for direct credit purchases.
 *
 * T8500: showFirstRunHint (derived by the caller from "games list empty") adds
 * a one-time "You start with N free credits" caption under the chip - the
 * first-run explanation for the bare number. Any click anywhere dismisses it
 * for the session.
 */
export function CreditBalance({ showFirstRunHint = false }) {
  const isAuthenticated = useIsAuthenticated();
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);
  const fetchCredits = useCreditStore((s) => s.fetchCredits);
  const [showBuyCredits, setShowBuyCredits] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(_firstRunHintDismissed);

  const hintVisible = showFirstRunHint && !hintDismissed && loaded && isAuthenticated;

  // Dismiss forever (session memory) on ANY click - capture phase so the
  // dismissing click still performs whatever it was aimed at.
  useEffect(() => {
    if (!hintVisible) return;
    const dismiss = () => {
      _firstRunHintDismissed = true;
      setHintDismissed(true);
    };
    document.addEventListener('click', dismiss, { once: true, capture: true });
    return () => document.removeEventListener('click', dismiss, { capture: true });
  }, [hintVisible]);

  const handlePaymentSuccess = useCallback((credits) => {
    setShowBuyCredits(false);
    fetchCredits();
    toast.success(`${credits} credits added to your balance!`);
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

      {hintVisible && (
        <div
          data-testid="credit-first-run-hint"
          className="absolute left-0 top-full mt-1.5 px-2.5 py-1.5 bg-gray-800 border border-gray-600 rounded-lg shadow-xl text-xs text-gray-200 whitespace-nowrap z-40"
        >
          You start with {balance} free credits
        </div>
      )}

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
