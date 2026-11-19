/**
 * T17750: the extension quote ("Added time ... until <date>") and the success toast
 * ("Storage extended until <date>") must name the same day, including when the
 * viewer's local date differs from the UTC date. The server stores and returns
 * naive UTC ISO strings (Python `datetime.utcnow().isoformat()`, no offset), and
 * extends from max(expiry, now) by `timedelta(days)`; the fake server below does the
 * same.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StorageExtensionModal } from './StorageExtensionModal';
import { useCreditStore } from '../stores/creditStore';
import { calculateExtensionCost } from '../utils/storageCost';
import { toast } from './shared';

vi.mock('./shared', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./BuyCreditsModal', () => ({
  BuyCreditsModal: () => <div data-testid="buy-credits-modal" />,
}));

const DAY_MS = 86400000;
// 22:14 on Nov 18 in Los Angeles, already 06:14 on Nov 19 in UTC (the QA repro).
const NOW_UTC = Date.UTC(2026, 10, 19, 6, 14, 0);

// Python's naive isoformat of a UTC datetime: no offset, microseconds.
function naiveUtc(ms) {
  return new Date(ms).toISOString().replace('Z', '') + '456';
}

function serverExtend(game, days) {
  const expiry = game.storage_expires_at ? Date.parse(game.storage_expires_at + 'Z') : null;
  const base = expiry !== null && expiry > Date.now() ? expiry : Date.now();
  return naiveUtc(base + days * DAY_MS);
}

function makeGame(overrides = {}) {
  return {
    id: 7,
    name: 'varB',
    video_size: 0,
    storage_expires_at: naiveUtc(NOW_UTC - 3 * DAY_MS), // expired
    ...overrides,
  };
}

function quotedDate() {
  const text = screen.getByText(/^\+\d+ days, until /).textContent;
  return text.match(/until (.+)$/)[1];
}

function serverCost(game, days) {
  return calculateExtensionCost(game.video_size || 0, days);
}

describe('T17750 storage extension dates', () => {
  const originalTz = process.env.TZ;
  let fetchMock;
  let game;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_UTC);
    useCreditStore.setState({ balance: 1000, loaded: true, fetchCredits: vi.fn() });
    fetchMock = vi.fn(async (_url, init) => {
      const { days } = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          success: true,
          new_expires_at: serverExtend(game, days),
          cost_credits: serverCost(game, days),
        }),
      };
    });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = originalTz;
  });

  async function extendAndReadToast() {
    fireEvent.click(screen.getByRole('button', { name: /Extend storage/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    return toast.success.mock.calls[0][0].match(/until (.+)$/)[1];
  }

  it.each([
    ['America/Los_Angeles', 'expired game', null],
    ['America/Los_Angeles', 'game still in storage', 5],
    ['Asia/Tokyo', 'expired game', null],
    ['Asia/Tokyo', 'game still in storage', 5],
  ])('T17750:C1 quote and success name the same date (%s, %s)', async (tz, _label, daysLeft) => {
    process.env.TZ = tz;
    game = makeGame(daysLeft === null ? {} : { storage_expires_at: naiveUtc(NOW_UTC + daysLeft * DAY_MS + 3 * 3600000) });
    render(<StorageExtensionModal game={game} onClose={vi.fn()} onExtensionSuccess={vi.fn()} />);
    const quote = quotedDate();
    const success = await extendAndReadToast();
    expect(success).toBe(quote);
  });

  it('T17750:C1 the repro: LA on Nov 18 after 4pm, expired game, 30 days', async () => {
    process.env.TZ = 'America/Los_Angeles';
    game = makeGame();
    render(<StorageExtensionModal game={game} onClose={vi.fn()} onExtensionSuccess={vi.fn()} />);
    // Local Nov 18 22:14 + 30 days = Dec 18 local; the server writes Dec 19 06:14 UTC = Dec 18 22:14 LA.
    expect(quotedDate()).toBe('Dec 18, 2026');
    expect(await extendAndReadToast()).toBe('Dec 18, 2026');
  });

  it.each([
    ['30 days: 1 credit, 500 MB game', 500 * 1024 ** 2, 1],
    ['longer: max slider, 500 MB game', 500 * 1024 ** 2, 'max'],
    ['30 days: 5 credits, 5 GB game', 5 * 1024 ** 3, 5],
    ['longer: max slider, 5 GB game', 5 * 1024 ** 3, 'max'],
  ])('T17750:C2 %s: the server charges the displayed amount', async (_label, size, position) => {
    process.env.TZ = 'America/Los_Angeles';
    game = makeGame({ video_size: size });
    render(<StorageExtensionModal game={game} onClose={vi.fn()} onExtensionSuccess={vi.fn()} />);
    const slider = screen.getByRole('slider');
    const credits = position === 'max' ? Number(slider.max) : position;
    fireEvent.change(slider, { target: { value: String(credits) } });

    const quotedDays = Number(screen.getByText(/^\+\d+ days, until /).textContent.match(/^\+(\d+)/)[1]);
    expect(screen.getByText(credits === 1 ? '1 credit' : `${credits} credits`)).toBeTruthy();
    const quote = quotedDate();

    const success = await extendAndReadToast();
    const { days } = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(days).toBe(quotedDays);
    expect(days).toBeGreaterThanOrEqual(30);
    expect(serverCost(game, days)).toBe(credits);
    expect(success).toBe(quote);
  });
});
