import { useState, useEffect, useCallback } from 'react';
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { X, Coins, Star, Gem, Loader2, ArrowLeft, Info, History } from 'lucide-react';
import { Button } from './shared/Button';
import { CreditHistoryModal } from './CreditHistoryModal';
import { API_BASE } from '../config';
import apiFetch from '../utils/apiFetch';
import { useEditorStore, useProjectsStore } from '../stores';

/**
 * BuyCreditsModal - Two-step inline payment flow (T526)
 *
 * Step 1: Pack selection — packs render FROM the backend /payments/config
 *         endpoint (single-sourced, T4940). No duplicate frontend pricing table.
 * Step 2: Stripe Payment Element renders inline — user pays without leaving the page
 *
 * Props:
 *   onClose: () => void
 *   onPaymentSuccess: (credits: number) => void — called after successful payment
 *   insufficientCredits: { required, available, videoSeconds } | null
 */

// Module-level caches: fetch config (publishable key + packs) from backend once.
let stripePromiseCache = null;
let packsCache = null;

async function getStripePromise() {
  if (stripePromiseCache) return stripePromiseCache;

  const { loadStripe } = await import('@stripe/stripe-js');

  // Try VITE env var first (allows override), then fetch from backend
  const envKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
  if (envKey) {
    stripePromiseCache = loadStripe(envKey);
    return stripePromiseCache;
  }

  const res = await apiFetch(`${API_BASE}/api/payments/config`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.publishable_key) return null;

  stripePromiseCache = loadStripe(data.publishable_key);
  return stripePromiseCache;
}

// Fetch the pack ladder from the backend (single source of truth, T4940).
async function getPacks() {
  if (packsCache) return packsCache;
  const res = await apiFetch(`${API_BASE}/api/payments/config`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!Array.isArray(data.packs) || data.packs.length === 0) return null;
  packsCache = data.packs;
  return packsCache;
}

// Presentational metadata (icon/badge/label) keyed by pack — NOT pricing.
// Credits and prices come from the backend config, not from here.
const PACK_META = {
  starter: { label: 'Starter', icon: Coins, badge: null, badgeColor: null },
  popular: { label: 'Popular', icon: Star, badge: 'Most Popular', badgeColor: 'bg-purple-600' },
  best_value: { label: 'Best Value', icon: Gem, badge: 'Best Value', badgeColor: 'bg-green-600' },
};

function formatPrice(priceCents) {
  return `$${(priceCents / 100).toFixed(2)}`;
}

// 1 credit = 1 second of exported video — render an honest conversion.
function secondsToClock(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return m === 1 ? '1 min' : `${m} min`;
  return `${m}m ${s}s`;
}

// Merge backend pack (credits/price/name) with presentational meta.
function toDisplayPack(pack) {
  const meta = PACK_META[pack.key] || { label: pack.name, icon: Coins, badge: null, badgeColor: null };
  return {
    key: pack.key,
    label: meta.label,
    credits: pack.credits,
    price: formatPrice(pack.price_cents),
    exportedVideo: secondsToClock(pack.credits),
    icon: meta.icon,
    badge: meta.badge,
    badgeColor: meta.badgeColor,
  };
}

const STRIPE_APPEARANCE = {
  theme: 'night',
  variables: {
    colorPrimary: '#9333ea',
    colorBackground: '#1f2937',
    colorText: '#ffffff',
    fontFamily: 'Inter, system-ui, sans-serif',
    borderRadius: '8px',
  },
};

// ---------------------------------------------------------------------------
// "How credits work" explainer — states the rule + what's free (T4940)
// ---------------------------------------------------------------------------

function CreditsExplainer() {
  return (
    <div className="mt-3 p-3 rounded-lg bg-gray-900/60 border border-white/10 text-xs text-gray-300 space-y-2">
      <p className="text-white font-medium">How credits work</p>
      <p><span className="text-yellow-400 font-medium">1 credit = 1 second</span> of exported video.</p>
      <div>
        <p className="text-gray-400">Credits are spent on:</p>
        <ul className="list-disc list-inside text-gray-300">
          <li>Exporting video (1 credit per second)</li>
          <li>Uploading a game (storage for 30 days)</li>
        </ul>
      </div>
      <div>
        <p className="text-gray-400">Always free:</p>
        <ul className="list-disc list-inside text-gray-300">
          <li>Spotlight &amp; highlight render</li>
          <li>Player detection</li>
          <li>Downloads &amp; sharing</li>
          <li>Storing your exported reels</li>
        </ul>
      </div>
      <p className="text-gray-400">Credits never expire.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Payment Form (rendered inside <Elements> provider)
// ---------------------------------------------------------------------------

function PaymentForm({ selectedPack, onBack, onClose, onPaymentSuccess = () => {} }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState(null);
  const [paymentReady, setPaymentReady] = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setPaying(true);
    setError(null);

    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message);
      setPaying(false);
      return;
    }

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setPaying(false);
      return;
    }

    // Payment succeeded — verify with backend and grant credits
    try {
      const res = await apiFetch(`${API_BASE}/api/payments/confirm-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntent.id }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Verification failed (${res.status})`);
      }

      const data = await res.json();
      onPaymentSuccess(data.credits || selectedPack.credits);
    } catch (err) {
      // Payment went through but verification failed — credits will arrive via webhook
      console.warn('[BuyCreditsModal] confirm-intent failed, webhook will handle:', err.message);
      onPaymentSuccess(selectedPack.credits);
    }
  }, [stripe, elements, selectedPack, onPaymentSuccess]);

  const handleExpressCheckout = useCallback(async ({ expressPaymentType }) => {
    if (!stripe || !elements) return;

    setPaying(true);
    setError(null);

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (confirmError) {
      setError(confirmError.message);
      setPaying(false);
      return;
    }

    try {
      const res = await apiFetch(`${API_BASE}/api/payments/confirm-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntent.id }),
      });
      if (!res.ok) throw new Error('Verification failed');
      const data = await res.json();
      onPaymentSuccess(data.credits || selectedPack.credits);
    } catch (err) {
      console.warn('[BuyCreditsModal] Express checkout confirm failed, webhook will handle:', err.message);
      onPaymentSuccess(selectedPack.credits);
    }
  }, [stripe, elements, selectedPack, onPaymentSuccess]);

  return (
    <form onSubmit={handleSubmit}>
      {/* Header with back button */}
      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={onBack}
          disabled={paying}
          className="text-gray-400 hover:text-white transition-colors p-1"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h3 className="text-lg font-semibold text-white">
            {selectedPack.label} — {selectedPack.credits.toLocaleString()} credits
          </h3>
          <p className="text-gray-400 text-sm">
            {selectedPack.price} · ≈ {selectedPack.exportedVideo} of exported video
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={paying}
          className="ml-auto text-gray-400 hover:text-white transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* Express Checkout (Apple Pay / Google Pay) */}
      <ExpressCheckoutElement
        onConfirm={handleExpressCheckout}
        onLoadError={(e) => {
          console.error('[Stripe] ExpressCheckout loaderror:', e.error);
          // Express checkout failing is non-fatal — card form is primary
        }}
        options={{ buttonType: { applePay: 'buy', googlePay: 'buy' } }}
      />

      {/* Card form */}
      <div className="mt-4">
        <PaymentElement
          onReady={() => setPaymentReady(true)}
          onLoadError={(e) => {
            console.error('[Stripe] PaymentElement loaderror:', e.error);
            setError('Payment failed, please send bug report.');
          }}
        />
      </div>

      {error && (
        <p className="mt-3 text-red-400 text-sm">{error}</p>
      )}

      <button
        type="submit"
        disabled={!stripe || !paymentReady || paying}
        className={[
          'mt-4 w-full py-3 rounded-lg font-medium text-white transition-all',
          !stripe || !paymentReady || paying
            ? 'bg-purple-800/50 cursor-not-allowed'
            : 'bg-purple-600 hover:bg-purple-500 cursor-pointer',
        ].join(' ')}
      >
        {paying ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            Processing...
          </span>
        ) : (
          `Pay ${selectedPack.price}`
        )}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Main Modal
// ---------------------------------------------------------------------------

export function BuyCreditsModal({ onClose, onPaymentSuccess, insufficientCredits }) {
  const [packs, setPacks] = useState(null);
  const [selectedPack, setSelectedPack] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [loadingPack, setLoadingPack] = useState(null);
  const [error, setError] = useState(null);
  const [showExplainer, setShowExplainer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Load the pack ladder from backend config once when the modal opens.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fetched = await getPacks();
      if (cancelled) return;
      if (!fetched) {
        setError('Could not load credit packs. Please try again.');
        return;
      }
      setPacks(fetched.map(toDisplayPack));
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSelectPack(packKey) {
    const pack = (packs || []).find(p => p.key === packKey);
    if (!pack) return;

    setLoadingPack(packKey);
    setError(null);

    try {
      // Fetch Stripe publishable key (cached after first call) + create PaymentIntent in parallel
      const [resolvedStripe, intentRes] = await Promise.all([
        getStripePromise(),
        apiFetch(`${API_BASE}/api/payments/create-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pack: packKey }),
        }),
      ]);

      // If Stripe isn't configured, fall back to redirect checkout
      if (!resolvedStripe) {
        setLoadingPack(null);
        return handleFallbackCheckout(packKey);
      }

      if (!intentRes.ok) {
        const data = await intentRes.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to create payment (${intentRes.status})`);
      }

      const { client_secret } = await intentRes.json();
      setStripePromise(resolvedStripe);
      setClientSecret(client_secret);
      setSelectedPack(pack);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPack(null);
    }
  }

  // Fallback: redirect to Stripe Checkout (when VITE_STRIPE_PUBLIC_KEY not set)
  async function handleFallbackCheckout(packKey) {
    setLoadingPack(packKey);
    setError(null);

    try {
      const res = await apiFetch(`${API_BASE}/api/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pack: packKey }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Checkout failed (${res.status})`);
      }

      const { checkout_url } = await res.json();

      // Save navigation state so App.jsx can restore context after Stripe redirect
      const editorMode = useEditorStore.getState().editorMode;
      const projectId = useProjectsStore.getState().selectedProjectId;
      sessionStorage.setItem('paymentReturnMode', editorMode);
      if (projectId) sessionStorage.setItem('paymentReturnProjectId', String(projectId));
      sessionStorage.setItem('paymentAutoExport', 'true');

      window.location.href = checkout_url;
    } catch (err) {
      setError(err.message);
      setLoadingPack(null);
    }
  }

  function handleBack() {
    setSelectedPack(null);
    setClientSecret(null);
    setError(null);
  }

  // Step 2: Payment Element form
  if (selectedPack && clientSecret && stripePromise) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10">
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
          >
            <PaymentForm
              selectedPack={selectedPack}
              onBack={handleBack}
              onClose={onClose}
              onPaymentSuccess={onPaymentSuccess}
            />
          </Elements>
          <p className="mt-4 text-gray-500 text-xs text-center">
            Secure payment by Stripe.
          </p>
        </div>
      </div>
    );
  }

  // Step 1: Pack selection
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-800 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl border border-white/10 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
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

        {/* The rule, stated up front — value-forward (T4940) */}
        <div className="mb-3 p-3 rounded-lg bg-purple-900/20 border border-purple-500/20 text-sm">
          <p className="text-white">
            <span className="text-yellow-400 font-semibold">1 credit = 1 second</span> of exported video.
          </p>
          <p className="text-gray-400 text-xs mt-0.5">Your credits go further now.</p>
        </div>

        {insufficientCredits && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/20 text-sm text-gray-300">
            <p>
              This export requires{' '}
              <strong className="text-white">{insufficientCredits.required} credits</strong>{' '}
              ({Math.round(insufficientCredits.videoSeconds)}s of video).
            </p>
            <p className="mt-1">
              Your balance:{' '}
              <strong className="text-white">{insufficientCredits.available} credits</strong>.
              You need <strong className="text-white">{insufficientCredits.required - insufficientCredits.available}</strong> more.
            </p>
          </div>
        )}

        {!packs && !error && (
          <div className="py-8 flex justify-center">
            <Loader2 size={24} className="text-purple-400 animate-spin" />
          </div>
        )}

        {packs && (
          <div className="space-y-3">
            {packs.map((pack) => {
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
                        <div className="text-gray-400 text-xs">≈ {pack.exportedVideo} of exported video</div>
                      </div>
                    </div>
                    <div className="text-white font-semibold">{pack.price}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <p className="mt-3 text-red-400 text-sm">{error}</p>
        )}

        {/* Transparency links: explainer + usage history */}
        <div className="mt-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setShowExplainer((v) => !v)}
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
          >
            <Info size={13} /> How credits work
          </button>
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="flex items-center gap-1 text-gray-400 hover:text-white transition-colors"
          >
            <History size={13} /> Usage history
          </button>
        </div>

        {showExplainer && <CreditsExplainer />}

        <p className="mt-4 text-gray-500 text-xs text-center">
          Credits never expire. Secure checkout by Stripe.
        </p>

        <div className="mt-4">
          <Button variant="secondary" onClick={onClose} fullWidth disabled={!!loadingPack}>
            Cancel
          </Button>
        </div>
      </div>

      {showHistory && <CreditHistoryModal onClose={() => setShowHistory(false)} />}
    </div>
  );
}
