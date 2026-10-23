import { describe, it, expect } from 'vitest';
import * as pricing from '../config/pricing';
import {
  calculateStorageCost,
  calculateUploadCost,
  calculateExtensionCost,
  daysPerCredit,
} from './storageCost';

const GB = 1024 ** 3;

// Mirrored verbatim from src/backend/tests/test_t13310_storage_per_gb.py PARITY_CASES.
// [size_gb, days, storage_credits]
const PARITY_CASES = [
  [0.5, 30, 1], [0.5, 7, 1], [0.5, 60, 2],
  [1, 30, 1], [1, 7, 1], [1, 60, 2],
  [2.5, 30, 3], [2.5, 7, 1], [2.5, 60, 6],
  [6, 30, 6], [6, 7, 2], [6, 60, 12],
  [6.4, 30, 7], [6.4, 7, 2], [6.4, 60, 14],
  [20, 30, 20], [20, 7, 5], [20, 60, 40],
];

describe('storageCost (T13310: 1 credit per GB per 30 days)', () => {
  it.each(PARITY_CASES)('%s GB, %s days -> %s credits (backend parity)', (gb, days, expected) => {
    expect(calculateStorageCost(Math.floor(gb * GB), days)).toBe(expected);
    expect(calculateExtensionCost(Math.floor(gb * GB), days)).toBe(expected);
  });

  it('acceptance examples', () => {
    expect(calculateUploadCost(6 * GB, 30)).toBe(7);
    expect(calculateExtensionCost(6 * GB, 30)).toBe(6);
    expect(calculateUploadCost(2.5 * GB, 30)).toBe(4);
    expect(calculateUploadCost(0.5 * GB, 30)).toBe(2);
  });

  it('minimum 1 credit for a tiny file', () => {
    expect(calculateStorageCost(1, 1)).toBe(1);
  });

  it('daysPerCredit is the largest day count one credit buys', () => {
    for (const gb of [0.5, 2.5, 5, 6, 10]) {
      const bytes = Math.floor(gb * GB);
      const d = daysPerCredit(bytes);
      expect(calculateExtensionCost(bytes, d)).toBe(1);
      expect(calculateExtensionCost(bytes, d + 1)).toBe(2);
    }
  });

  it('CREDIT_VALUE no longer exists', () => {
    expect(pricing.CREDIT_VALUE).toBeUndefined();
  });
});
