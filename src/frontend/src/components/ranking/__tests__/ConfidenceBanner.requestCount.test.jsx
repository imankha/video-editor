/**
 * T6280 QA — pin the request COUNT for the "rank/confidence x2" HAR finding.
 *
 * The 2026-07-31 HAR showed `GET /api/rank/confidence` twice at the same
 * millisecond when My Reels opened. This is NOT a double-fire of one request:
 * ConfidenceBanner reads BOTH aspect ratios (RATIO_ORDER = portrait + landscape)
 * via Promise.all, so a single mount legitimately issues exactly one request PER
 * RATIO — two distinct URLs with different `?aspect_ratio=` params.
 *
 * These tests render the real ConfidenceBanner ONCE (i.e. production semantics —
 * no React StrictMode wrapper, so effects run a single time, exactly as a prod
 * build does since <StrictMode> is a no-op passthrough there). They assert:
 *   1. exactly TWO network requests fire on one mount, and
 *   2. they carry DIFFERENT aspect_ratio params (not the same URL twice).
 * That is the production-build evidence that this finding is by-design, not a
 * duplicate to remove. The per-ratio in-flight dedup (T4775) is what keeps the
 * dev-StrictMode double at one-per-ratio too; see rankConfidence.test.js.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiFetch BEFORE importing anything that (transitively) binds it, so the
// rankConfidence in-flight guard closes over the mock.
vi.mock('../../../utils/apiFetch', () => ({ default: vi.fn() }));
import apiFetch from '../../../utils/apiFetch';
import { __resetInflightForTests } from '../../../utils/rankConfidence';
import { ConfidenceBanner } from '../ConfidenceBanner';
import { RATIO_ORDER } from '../../../constants/aspectRatios';

const CONF = { confidence_pct: 30, total: 4, total_sec: 120, eligible: true };

function confidenceUrlCalls() {
  return apiFetch.mock.calls
    .map((c) => c[0])
    .filter((u) => typeof u === 'string' && u.includes('/api/rank/confidence'));
}

beforeEach(() => {
  apiFetch.mockReset();
  __resetInflightForTests?.();
  apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => CONF });
});

describe('ConfidenceBanner — rank/confidence request count (T6280)', () => {
  it('fires EXACTLY ONE request per aspect ratio on a single mount (not a duplicate)', async () => {
    render(<ConfidenceBanner onRank={() => {}} />);

    await waitFor(() => {
      expect(confidenceUrlCalls().length).toBe(RATIO_ORDER.length);
    });

    const urls = confidenceUrlCalls();
    // Two requests, and they are DISTINCT (different aspect_ratio) — the HAR "x2"
    // is portrait + landscape, not the same URL twice.
    expect(urls.length).toBe(2);
    expect(new Set(urls).size).toBe(2);
    // Each configured ratio appears exactly once (params are URL-encoded, e.g. 9%3A16).
    for (const ratio of RATIO_ORDER) {
      const enc = encodeURIComponent(ratio);
      expect(urls.filter((u) => u.includes(enc)).length).toBe(1);
    }
  });

  it('does not re-fire on re-render without a refreshKey bump (single owner, no reactive refetch)', async () => {
    const { rerender } = render(<ConfidenceBanner onRank={() => {}} refreshKey={0} />);
    await waitFor(() => expect(confidenceUrlCalls().length).toBe(2));

    rerender(<ConfidenceBanner onRank={() => {}} refreshKey={0} />);
    // Same refreshKey -> the fetch effect must not re-run; still exactly 2.
    await new Promise((r) => setTimeout(r, 0));
    expect(confidenceUrlCalls().length).toBe(2);
  });
});
