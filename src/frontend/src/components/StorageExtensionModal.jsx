import React, { useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { X, Coins, HardDrive, Calendar } from 'lucide-react';
import { Button } from './shared/Button';
import { CreditCostRow } from './shared/CreditCostRow';

const BuyCreditsModal = lazy(() => import('./BuyCreditsModal').then(m => ({ default: m.BuyCreditsModal })));
import { toast } from './shared';
import { useCreditStore } from '../stores/creditStore';
import { daysPerCredit, calculateExtensionCost } from '../utils/storageCost';
import { UPLOAD, ERROR_COPY, STORAGE_COPY, CREDITS } from '../config/displayNames';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import Guide from './instructions/Guide';
import { resolveGuide } from './instructions/resolveGuide';
import { GuideScope } from './instructions/GuideScope';
import { GUIDE_PULSE } from './instructions/guideTargets';
import { UserFacingError, userErrorMessage } from '../utils/userError';

// Mirrors ExtendStorageRequest.days (le=365) in routers/games.py; a larger request 422s.
const MAX_EXTENSION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

// T17750: the server returns naive UTC ISO strings (Python utcnow().isoformat(), no
// offset). `new Date()` reads an offset-less date-time as LOCAL time, which shifted the
// success date a day past the quote wherever the local and UTC dates differ.
function parseServerUtc(iso) {
  return new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);
}

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

  const maxCredits = useMemo(() => Math.max(1, Math.floor(MAX_EXTENSION_DAYS / step)), [step]);

  const extensionDays = Math.min(credits * step, MAX_EXTENSION_DAYS);

  const currentExpiry = useMemo(() => {
    if (game.storage_expires_at) {
      const d = parseServerUtc(game.storage_expires_at);
      return d > new Date() ? d : new Date();
    }
    return new Date();
  }, [game.storage_expires_at]);

  // Whole 24-hour days, like the server's timedelta(days), not local calendar days.
  const newExpiry = useMemo(
    () => new Date(currentExpiry.getTime() + extensionDays * DAY_MS),
    [currentExpiry, extensionDays],
  );

  const daysLeft = useMemo(() => {
    if (!game.storage_expires_at) return null;
    const now = new Date();
    const expiry = parseServerUtc(game.storage_expires_at);
    return Math.ceil((expiry - now) / DAY_MS);
  }, [game.storage_expires_at]);

  const isExpired = daysLeft !== null && daysLeft <= 0;

  const extendStorage = useCallback(async () => {
    setIsExtending(true);
    // T17670: one id per tap; the server charges once per id, so a resend of this
    // request (network or browser retry) can't charge twice.
    const requestId = crypto.randomUUID();
    try {
      const res = await apiFetch(`${API_BASE}/api/games/${game.id}/extend-storage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: extensionDays, request_id: requestId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.error('[StorageExtensionModal] extend failed:', res.status, err);
        // Only video_missing carries a sentence in `error`; the others carry a code.
        throw new UserFacingError(
          err.detail?.code === 'video_missing' ? err.detail.error : ERROR_COPY.EXTEND_STORAGE,
        );
      }
      const data = await res.json();
      await fetchCredits();
      toast.success(`Storage extended until ${formatDate(parseServerUtc(data.new_expires_at))}`);
      onExtensionSuccess?.();
      onClose();
    } catch (err) {
      toast.error(userErrorMessage(err, ERROR_COPY.EXTEND_STORAGE));
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
    toast.success('Extending storage...');
    await extendStorage();
  }, [fetchCredits, extendStorage]);

  const guide = resolveGuide({ screen: 'modal', local: { modal: 'storage-extension' } });

  return (
    <GuideScope guides={[guide]}>
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-600/20 rounded-lg">
              <Calendar size={20} className="text-yellow-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">{STORAGE_COPY.EXTEND}</h2>
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
          <Guide guide={guide} inline testId="modal-guide" />
          {/* Game info */}
          <div className="text-sm">
            <p className="text-white font-medium">{game.name}</p>
            <p className="text-gray-400 mt-0.5">
              {isExpired
                ? 'Expired'
                : daysLeft !== null
                  ? `Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''} (${formatDate(parseServerUtc(game.storage_expires_at))})`
                  : 'No expiry set'}
            </p>
          </div>

          {/* Credit slider */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              {STORAGE_COPY.EXTEND_LABEL}
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
              <span>{maxCredits} credits ({Math.min(maxCredits * step, MAX_EXTENSION_DAYS)}d)</span>
            </div>
          </div>

          {/* Extension details */}
          <div className="bg-gray-900/50 rounded-lg p-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">{STORAGE_COPY.EXTEND_ROW}</span>
              <span className="text-white">{STORAGE_COPY.addedUntil(extensionDays, formatDate(newExpiry))}</span>
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
              <span className="text-white font-medium">{CREDITS.count(credits)}</span>
            </div>
          </div>

          {/* Balance */}
          <CreditCostRow
            cost={credits}
            balance={creditBalance}
            note={UPLOAD.EXTENSION_NOTE(extensionDays)}
          />

          {/* Extend button */}
          <Button
            variant="success"
            size="lg"
            onClick={handleExtend}
            disabled={isExtending}
            className="w-full"
            data-testid={GUIDE_PULSE.STORAGE_EXTEND}
            guideTarget={GUIDE_PULSE.STORAGE_EXTEND}
          >
            {isExtending ? 'Extending...' : STORAGE_COPY.extendFor(credits)}
          </Button>
        </div>
      </div>

      {showBuyCredits && (
        <Suspense fallback={null}>
          <BuyCreditsModal
            paywall
            onClose={() => setShowBuyCredits(false)}
            onPaymentSuccess={handlePaymentSuccess}
          />
        </Suspense>
      )}
    </div>
    </GuideScope>
  );
}
