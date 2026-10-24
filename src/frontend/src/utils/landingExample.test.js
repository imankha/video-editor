/**
 * T13310/T13320 review: the landing page worked example is computed in index.astro
 * from the shared modules. Recompute it here independently, by hand, so a drift in
 * either the storage rule or the ladder breaks a test instead of the marketing copy.
 */
import { describe, it, expect } from 'vitest';
import { calculateUploadCost } from './storageCost';
import { costAtBestRateUsd, LOWEST_RATE_CENTS } from '../config/pricing';

describe('landing worked example (6 GB game + three 15 s highlights)', () => {
  it('upload = 6 GB x 1 month + 1 auto-export credit = 7', () => {
    expect(calculateUploadCost(6 * 1024 ** 3)).toBe(7);
  });

  it('three 15 s highlights at 1 credit/s = 45, total 52', () => {
    const exportCredits = 3 * 15 * 1;
    expect(exportCredits).toBe(45);
    expect(calculateUploadCost(6 * 1024 ** 3) + exportCredits).toBe(52);
  });

  it('52 credits cost about $1.56 at the best rate (~3.0c per credit)', () => {
    expect(LOWEST_RATE_CENTS).toBeCloseTo(3.0, 1);
    expect(costAtBestRateUsd(52).toFixed(2)).toBe('1.56');
    // by hand: 52 * 2999/1000 = 155.948 cents
    expect((52 * 2999) / 1000 / 100).toBeCloseTo(1.56, 2);
  });
});
