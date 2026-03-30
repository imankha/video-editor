import { useState, useCallback } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, ExpressCheckoutElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { X, Coins, Star, Gem, Loader2, ArrowLeft } from 'lucide-react';
import { Button } from './shared/Button';
import { API_BASE } from '../config';
import { useEditorStore, useProjectsStore } from '../stores';

/**
 * BuyCreditsModal - Two-step inline payment flow (T526)
 *
 * Step 1: Pack selection (same as T525)
 * Step 2: Stripe Payment Element renders inline — user pays without leaving the page
 *
 * Props:
 *   onClose: () => void
 *   onPaymentSuccess: (credits: number) => void — called after successful payment
 *   insufficientCredits: { required, available, videoSeconds } | null
 */

// Module-level cache: fetch publishable key from backend once, then reuse
let stripePromiseCache = null;

async function getStripePromise() {
  if (stripePromiseCache) return stripePromiseCache;

  // Try VITE env var first (allows override), then fetch from backend
  const envKey = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
  if (envKey) {
    stripePromiseCache = loadStripe(envKey);
    return stripePromiseCache;
  }

  const res = await fetch(`${API_BASE}/api/payments/config`, { credentials: 'include' });
  if (!res.ok) return null;
  const { publishable_key } = await res.json();
  if (!publishable_key) return null;

  stripePromiseCache = loadStripe(publishable_key);
  return stripePromiseCache;
}

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
// Step 2: Payment Form (rendered inside <Elements> provider)
// ---------------------------------------------------------------------------

function PaymentForm({ selectedPack, onBack, onClose, onPaymentSuccess }) {
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
      const res = await fetch(`${API_BASE}/api/payments/confirm-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
      const res = await fetch(`${API_BASE}/api/payments/confirm-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
            {selectedPack.name} — {selectedPack.credits.toLocaleString()} credits
          </h3>
          <p className="text-gray-400 text-sm">{selectedPack.price}</p>
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
        options={{ buttonType: { applePay: 'buy', googlePay: 'buy' } }}
      />

      {/* Card form */}
      <div className="mt-4">
        <PaymentElement onReady={() => setPaymentReady(true)} />
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
  const [selectedPack, setSelectedPack] = useState(null);
  const [clientSecret, setClientSecret] = useState(null);
  const [stripePromise, setStripePromise] = useState(null);
  const [loadingPack, setLoadingPack] = useState(null);
  const [error, setError] = useState(null);

  async function handleSelectPack(packKey) {
    const pack = PACKS.find(p => p.key === packKey);
    if (!pack) return;

    setLoadingPack(packKey);
    setError(null);

    try {
      // Fetch Stripe publishable key (cached after first call) + create PaymentIntent in parallel
      const [resolvedStripe, intentRes] = await Promise.all([
        getStripePromise(),
        fetch(`${API_BASE}/api/payments/create-intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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
