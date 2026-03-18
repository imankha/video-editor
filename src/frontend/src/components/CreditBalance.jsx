import { Coins } from 'lucide-react';
import { useCreditStore } from '../stores/creditStore';
import { useIsAuthenticated } from '../stores/authStore';

/**
 * CreditBalance - Small pill showing credit balance in the header (T530)
 *
 * Only visible when authenticated and credits have been fetched.
 * Placed next to GalleryButton in App.jsx.
 */
export function CreditBalance() {
  const isAuthenticated = useIsAuthenticated();
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);

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
