/**
 * T13330: the paywall modal and the buy modal each beacon exactly once per open
 * (one fire per mount, not per render), through the shared funnel transport.
 * apiFetch is routed by URL: a positional mock would be consumed by the
 * fire-and-forget beacon.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div />,
  ExpressCheckoutElement: () => <div />,
  useStripe: () => null,
  useElements: () => null,
}));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../utils/funnelEvents', async (orig) => ({
  ...(await orig()),
  recordFunnelEvent: vi.fn(),
}));

import apiFetch from '../utils/apiFetch';
import { recordFunnelEvent, FUNNEL_EVENTS } from '../utils/funnelEvents';
import { BuyCreditsModal } from './BuyCreditsModal';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { CREDIT_PACKS } from '../config/pricing';

const CONFIG = {
  publishable_key: 'pk_test_x',
  packs: CREDIT_PACKS.map((p) => ({ key: p.key, credits: p.credits, price_cents: p.price_cents, name: p.name })),
};

beforeEach(() => {
  recordFunnelEvent.mockClear();
  apiFetch.mockReset();
  apiFetch.mockImplementation((url) => Promise.resolve({
    ok: true,
    json: async () => (String(url).includes('/payments/config') ? CONFIG : {}),
  }));
});

describe('funnel event names (T13330)', () => {
  it('exposes the two purchase-funnel events', () => {
    expect(FUNNEL_EVENTS.PAYWALL_SHOWN).toBe('paywall_shown');
    expect(FUNNEL_EVENTS.BUY_MODAL_OPENED).toBe('buy_modal_opened');
  });
});

describe('InsufficientCreditsModal beacon (T13330)', () => {
  it('fires paywall_shown once per open, not per render', () => {
    const props = { required: 5, available: 2, description: 'x', onClose: vi.fn(), onBuyCredits: vi.fn() };
    const { rerender } = render(<InsufficientCreditsModal {...props} />);
    rerender(<InsufficientCreditsModal {...props} available={3} />);
    const calls = recordFunnelEvent.mock.calls.filter(([e]) => e === 'paywall_shown');
    expect(calls).toHaveLength(1);
  });
});

describe('BuyCreditsModal beacon (T13330)', () => {
  it('fires buy_modal_opened once per open, not per render', async () => {
    const props = { onClose: vi.fn(), onPaymentSuccess: vi.fn() };
    const { rerender } = render(<BuyCreditsModal {...props} />);
    await waitFor(() => expect(screen.getAllByText(/credits/).length).toBeGreaterThan(0));
    rerender(<BuyCreditsModal {...props} />);
    const calls = recordFunnelEvent.mock.calls.filter(([e]) => e === 'buy_modal_opened');
    expect(calls).toHaveLength(1);
  });
});
