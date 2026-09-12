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

const CONFIG = {
  publishable_key: 'pk_test_x',
  packs: [
    { key: 'starter', credits: 80, price_cents: 399, name: 'Starter — 80 Credits' },
    { key: 'popular', credits: 160, price_cents: 699, name: 'Popular — 160 Credits' },
    { key: 'best_value', credits: 340, price_cents: 1299, name: 'Best Value — 340 Credits' },
  ],
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
  it('renders the three packs with credits + prices from config', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('80 credits')).toBeTruthy());
    expect(screen.getByText('160 credits')).toBeTruthy();
    expect(screen.getByText('340 credits')).toBeTruthy();
    expect(screen.getByText('$3.99')).toBeTruthy();
    expect(screen.getByText('$6.99')).toBeTruthy();
    expect(screen.getByText('$12.99')).toBeTruthy();
  });

  it('does not render the old hardcoded pack sizes', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('80 credits')).toBeTruthy());
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

  it('insufficient-credits notice shows the SAME number for credits and seconds (T9750)', async () => {
    // required IS the round-half-up credit count from the backend; since
    // 1 credit = 1 second by policy, the seconds display must be that same
    // number -- no separately-rounded raw seconds that could contradict it.
    render(
      <BuyCreditsModal
        onClose={vi.fn()}
        onPaymentSuccess={vi.fn()}
        insufficientCredits={{ required: 6, available: 2, videoSeconds: 6.027 }}
      />,
    );
    await waitFor(() => expect(screen.getByText('80 credits')).toBeTruthy());
    // "6 credits (6s of video)" -- both 6, never the old "6 credits (6s)" vs a 7 charge.
    expect(screen.getByText(/6 credits/)).toBeTruthy();
    expect(screen.getByText(/\(6s of video\)/)).toBeTruthy();
    // The old contradiction (a 7 credit charge shown next to "6s") must not appear.
    expect(screen.queryByText(/7 credits/)).toBeNull();
  });

  it('shows an honest per-pack exported-video conversion', async () => {
    render(<BuyCreditsModal onClose={vi.fn()} onPaymentSuccess={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('340 credits')).toBeTruthy());
    // 340 credits = 340 seconds = 5m 40s; 80 = 1m 20s; 160 = 2m 40s
    expect(screen.getByText(/5m 40s of exported video/)).toBeTruthy();
    expect(screen.getByText(/1m 20s of exported video/)).toBeTruthy();
    expect(screen.getByText(/2m 40s of exported video/)).toBeTruthy();
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
