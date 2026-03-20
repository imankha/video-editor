import { X, Coins } from 'lucide-react';
import { Button } from './shared/Button';

/**
 * InsufficientCreditsModal - Blocking modal shown when user lacks credits (T530)
 *
 * Props:
 *   required: number - credits needed for the export
 *   available: number - user's current balance
 *   videoSeconds: number - video duration in seconds
 *   onClose: () => void - close handler
 *   onBuyCredits: () => void - open BuyCreditsModal (T525)
 */
export function InsufficientCreditsModal({ required, available, videoSeconds, onClose, onBuyCredits }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Coins size={20} className="text-yellow-400" />
            Insufficient Credits
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3 text-gray-300 text-sm">
          <p>
            This export requires{' '}
            <strong className="text-white">{required} credits</strong>{' '}
            ({Math.round(videoSeconds)}s of video).
          </p>
          <p>
            Your balance:{' '}
            <strong className="text-white">{available} credits</strong>.
          </p>
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              console.log('[InsufficientCreditsModal] Buy Credits clicked');
              onClose();
              onBuyCredits?.();
            }}
            className="flex-1"
            icon={Coins}
          >
            Buy Credits
          </Button>
        </div>
      </div>
    </div>
  );
}
