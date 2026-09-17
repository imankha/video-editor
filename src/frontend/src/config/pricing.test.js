/**
 * T10210: pricing.js derives everything from src/backend/app/pricing.json with the same
 * rules as app/pricing.py. These assert the invariants, never the current numbers.
 */
import { describe, it, expect } from 'vitest';
import pricing from '../../../backend/app/pricing.json';
import {
  CREDIT_PACKS,
  BEST_VALUE_PACK,
  LOWEST_RATE_CENTS,
  CREDIT_VALUE,
  packRateCents,
  packPriceUsd,
  costAtBestRateUsd,
} from './pricing';

describe('pricing (single source, T10210)', () => {
  it('exposes the ladder exactly as pricing.json lists it', () => {
    expect(CREDIT_PACKS).toEqual(pricing.credit_packs);
    expect(CREDIT_PACKS.length).toBeGreaterThanOrEqual(2);
  });

  it('is a value ladder: ascending price, strictly decreasing per-credit rate', () => {
    for (let i = 1; i < CREDIT_PACKS.length; i++) {
      expect(CREDIT_PACKS[i].price_cents).toBeGreaterThan(CREDIT_PACKS[i - 1].price_cents);
      expect(packRateCents(CREDIT_PACKS[i])).toBeLessThan(packRateCents(CREDIT_PACKS[i - 1]));
    }
  });

  it('best value is the last rung and owns the lowest rate', () => {
    expect(BEST_VALUE_PACK).toBe(CREDIT_PACKS[CREDIT_PACKS.length - 1]);
    expect(LOWEST_RATE_CENTS).toBe(packRateCents(BEST_VALUE_PACK));
  });

  it('CREDIT_VALUE is the worst-case rate rounded up to a whole cent (matches app/pricing.py)', () => {
    const worst = Math.max(...CREDIT_PACKS.map(packRateCents));
    expect(CREDIT_VALUE).toBe(Math.ceil(worst) / 100);
    for (const p of CREDIT_PACKS) expect(packRateCents(p) / 100).toBeLessThanOrEqual(CREDIT_VALUE);
  });

  it('helpers convert cents faithfully', () => {
    const p = CREDIT_PACKS[0];
    expect(packPriceUsd(p)).toBeCloseTo(p.price_cents / 100, 10);
    expect(costAtBestRateUsd(100)).toBeCloseTo(LOWEST_RATE_CENTS, 10);
  });
});
