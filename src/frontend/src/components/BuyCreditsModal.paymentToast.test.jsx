/**
 * T17250:C2 -- a successful in-window card payment shows "N credits added. Your
 * balance is B." from whichever screen opened the buy window. Before, the toast
 * lived in some openers' onPaymentSuccess (the header chip, export) and others
 * (Add footage, Attach video) only closed the window, so the parent saw no message.
 */
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';

const confirmPayment = vi.fn(async () => ({ paymentIntent: { id: 'pi_t17250' } }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
  PaymentElement: ({ onReady }) => {
    useEffect(() => { onReady?.(); }, [onReady]);
    return <div />;
  },
  ExpressCheckoutElement: () => <div />,
  useStripe: () => ({ confirmPayment }),
  useElements: () => ({ submit: async () => ({}) }),
}));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { BuyCreditsModal } from './BuyCreditsModal';
import { ToastContainer, useToastStore } from './shared/Toast';
import { useCreditStore } from '../stores/creditStore';
import { CREDIT_PACKS } from '../config/pricing';

const CONFIG = {
  publishable_key: 'pk_test_x',
  packs: CREDIT_PACKS.map((p) => ({ key: p.key, credits: p.credits, price_cents: p.price_cents, name: p.name })),
};
const [FIRST_PACK] = CREDIT_PACKS;

beforeEach(() => {
  useToastStore.getState().clearAll();
  useCreditStore.setState({ balance: 78, loaded: true });
  apiFetch.mockReset();
  apiFetch.mockImplementation((url) => {
    const u = String(url);
    if (u.includes('/payments/config')) return Promise.resolve({ ok: true, json: async () => CONFIG });
    if (u.includes('/payments/create-intent')) return Promise.resolve({ ok: true, json: async () => ({ client_secret: 'cs_x' }) });
    if (u.includes('/payments/confirm-intent')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'credits_granted', credits: 150, balance: 228 }) });
    }
    if (u.includes('/api/credits')) return Promise.resolve({ ok: true, json: async () => ({ balance: 228 }) });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

describe('BuyCreditsModal payment confirmation (T17250:C2)', () => {
  it('T17250:C2 an opener that only closes the window still gets the credits-added message with the new balance', async () => {
    // AddFootageButton / AttachVideoModal pass exactly this: close, nothing else.
    const onPaymentSuccess = vi.fn();
    render(<><BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={onPaymentSuccess} /><ToastContainer /></>);
    await waitFor(() => expect(screen.getByText(`${FIRST_PACK.credits.toLocaleString()} credits`)).toBeTruthy());
    fireEvent.click(screen.getByText(`${FIRST_PACK.credits.toLocaleString()} credits`));
    const pay = await screen.findByText(/^Pay \$/);
    await waitFor(() => expect(pay.closest('button').disabled).toBe(false));
    await act(async () => { fireEvent.click(pay); });
    await waitFor(() => expect(onPaymentSuccess).toHaveBeenCalledWith(150));
    expect(await screen.findByText('150 credits added. Your balance is 228.')).toBeTruthy();
    expect(useCreditStore.getState().balance).toBe(228);
  });
});
