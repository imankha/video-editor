import { useEffect } from 'react';
import { Coins } from 'lucide-react';
import { useCreditStore } from '../stores/creditStore';
import { useIsAuthenticated } from '../stores/authStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';

/**
 * CreditBalance - Small pill showing credit balance in the header (T530)
 *
 * Subscribes to export complete/error events so the balance stays in sync
 * with backend truth after any credit-affecting operation (deduction, refund).
 * Same event-driven pattern as the downloads count badge in useDownloads.js.
 */
export function CreditBalance() {
  const isAuthenticated = useIsAuthenticated();
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);
  const fetchCredits = useCreditStore((s) => s.fetchCredits);

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
    <div
      className="flex items-center gap-1 px-2 py-1.5 bg-white/10 rounded-lg text-sm text-white/80"
      title={`${balance} credits`}
    >
      <Coins size={14} className="text-yellow-400 shrink-0" />
      <span className="font-medium">{balance}</span>
    </div>
  );
}
