import { Coins, CheckCircle, XCircle } from 'lucide-react';
import { Button } from './shared/Button';

/**
 * PaymentResultModal - Shown after returning from Stripe checkout (T525)
 *
 * Success: shows credits granted + OK / Export buttons
 * Failure: shows error message + OK button
 */
export function PaymentResultModal({ result, onClose, onExport }) {
  const isSuccess = result.status === 'success';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10">
        <div className="flex items-center gap-3 mb-4">
          {isSuccess ? (
            <CheckCircle size={24} className="text-green-400 shrink-0" />
          ) : (
            <XCircle size={24} className="text-red-400 shrink-0" />
          )}
          <h3 className="text-lg font-semibold text-white">
            {isSuccess ? 'Credits Added!' : 'Payment Issue'}
          </h3>
        </div>

        <div className="space-y-2 text-gray-300 text-sm">
          {isSuccess ? (
            <>
              <p>
                <strong className="text-white">{result.credits}</strong> credits
                have been added to your balance.
              </p>
              <p className="flex items-center gap-1.5">
                <Coins size={14} className="text-yellow-400" />
                New balance: <strong className="text-white">{result.balance}</strong> credits
              </p>
            </>
          ) : (
            <p>{result.message || 'Something went wrong verifying your payment. Your credits may still be added shortly.'}</p>
          )}
        </div>

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            OK
          </Button>
          {isSuccess && onExport && (
            <Button variant="primary" onClick={() => { onClose(); onExport(); }} className="flex-1">
              Frame Video
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
