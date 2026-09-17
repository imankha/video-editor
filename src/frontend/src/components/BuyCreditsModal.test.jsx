/**
 * T4940: BuyCreditsModal renders packs from backend /payments/config
 * (single-sourced — no duplicate frontend pricing table) and states the
 * "1 credit = 1 second of exported video" rule + the free-actions explainer.
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@stripe/react-stripe-js', () => ({
  Elements: ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div />,
  ExpressCheckoutElement: () => <div />,
  useStripe: () => null,
  useElements: () => null,
}));

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { BuyCreditsModal } from './BuyCreditsModal';
import { CREDITS } from '../config/displayNames';

import { CREDIT_PACKS } from '../config/pricing';

// Backend truth is pricing.json (T10210); build the mocked /payments/config from the same
// source so this test never carries its own copy of the ladder.
const CONFIG = {
  publishable_key: 'pk_test_x',
  packs: CREDIT_PACKS.map((p) => ({
    key: p.key,
    credits: p.credits,
    price_cents: p.price_cents,
    name: `${p.name} — ${p.credits} Credits`,
  })),
};
const [FIRST_PACK, ...OTHER_PACKS] = CREDIT_PACKS;
const priceText = (p) => `$${(p.price_cents / 100).toFixed(2)}`;
const creditsText = (p) => `${p.credits} credits`;
// Mirrors the modal's secondsToClock (1 credit = 1 second of exported video).
const clockText = (credits) => {
  const m = Math.floor(credits / 60);
  const sec = credits % 60;
  if (m === 0) return `${sec}s`;
  if (sec === 0) return m === 1 ? '1 min' : `${m} min`;
  return `${m}m ${sec}s`;
};

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockImplementation((url) => {
    if (String(url).includes('/payments/config')) {
      return Promise.resolve({ ok: true, json: async () => CONFIG });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

describe('BuyCreditsModal (T4940)', () => {
  it('renders every pack with credits + prices from config', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(creditsText(FIRST_PACK))).toBeTruthy());
    for (const p of CREDIT_PACKS) {
      expect(screen.getByText(creditsText(p))).toBeTruthy();
      expect(screen.getByText(priceText(p))).toBeTruthy();
    }
  });

  it('does not render the old hardcoded pack sizes', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(creditsText(FIRST_PACK))).toBeTruthy());
    expect(screen.queryByText('40 credits')).toBeNull();
    expect(screen.queryByText('60 credits')).toBeNull();
    expect(screen.queryByText('260 credits')).toBeNull();
  });

  it('states the per-second rule WITH the rounding rule (T9750)', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('80 credits')).toBeTruthy());
    // Was a flat "1 credit = 1 second"; now states rounding explicitly.
    expect(screen.getAllByText(/1 credit per second/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/rounded to the nearest second/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/1 credit = 1 second/)).toBeNull();
  });

  it('insufficient-credits notice shows the actual video length, not the credit count relabeled (T9480)', async () => {
    // T9480: the old copy repeated `required` as a fake "Xs of video" (the
    // SAME number as the credit count) to dodge a contradiction with the old
    // ceil-billing bug. Now that billing is round-half-up (T9750) and this
    // task discloses the TRUE exact seconds, "6 credits" and "6.0s of video"
    // are shown honestly -- no need to fake the seconds to avoid a mismatch.
    render(
      <BuyCreditsModal
        onClose={vi.fn()}
        onPaymentSuccess={vi.fn()}
        insufficientCredits={{ required: 6, available: 2, videoSeconds: 6.027 }}
      />,
    );
    await waitFor(() => expect(screen.getByText('80 credits')).toBeTruthy());
    expect(screen.getByText(/6 credits/)).toBeTruthy();
    expect(screen.getByText(/6\.0s of video/)).toBeTruthy();
    expect(screen.getAllByText(new RegExp(CREDITS.PER_SECOND_RULE)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/7 credits/)).toBeNull();
  });

  it('shows an honest per-pack exported-video conversion', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(creditsText(FIRST_PACK))).toBeTruthy());
    for (const p of [FIRST_PACK, ...OTHER_PACKS]) {
      expect(screen.getByText(new RegExp(`${clockText(p.credits)} of exported video`))).toBeTruthy();
    }
  });

  it('explainer lists what is free', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('80 credits')).toBeTruthy());
    fireEvent.click(screen.getByText('How credits work'));
    expect(screen.getByText(/Always free/)).toBeTruthy();
    expect(screen.getByText(/Spotlight/)).toBeTruthy();
    expect(screen.getByText(/Player detection/)).toBeTruthy();
    expect(screen.getAllByText(/never expire/).length).toBeGreaterThan(0);
  });
});
