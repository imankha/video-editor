import { describe, it, expect } from 'vitest';
import { formatLength, PRECISION } from './timeFormat';
import { roundCreditsHalfUp } from '../stores/creditStore';

/**
 * T9480 Stage B2 -- pins the bridge between the display rule and the billing
 * rule: a whole-second LENGTH is, by construction, the same number the
 * backend charges (design section 2.2 "Billing parity is asserted, not
 * assumed"). Mirrors the value table in
 * src/backend/tests/test_t9750_round_credits.py so a change to either rule
 * shows up as a failure on both sides.
 *
 * Documented divergence: for 0 < s < 0.5, formatLength shows "0" (nothing
 * rounds up to a whole second yet) while roundCreditsHalfUp charges 1 credit
 * (the 1-credit floor on any positive render). This is intentional -- the
 * floor is a billing policy, not a display fact, and disclosure copy (Stage
 * E4 / displayNames.CREDITS.MIN_CHARGE) states it separately.
 */

// Same value table as test_t9750_round_credits.py's boundary cases, plus the
// walkthrough repro and a handful of >=0.5 spot checks.
const PARITY_VALUES = [0.5, 1, 2.5, 6, 6.027, 6.49, 6.5, 6.51, 10, 30, 100, 3600];

describe('formatLength(s, PRECISION.SECOND, {style: plain}) === roundCreditsHalfUp(s)', () => {
  it.each(PARITY_VALUES)('agrees at %ss', (s) => {
    expect(Number(formatLength(s, PRECISION.SECOND, { style: 'plain' }))).toBe(
      roundCreditsHalfUp(s),
    );
  });

  it('agrees for every 0.01s step from 0.5s to 20s (boundary sweep)', () => {
    for (let cs = 50; cs <= 2000; cs += 1) {
      const s = cs / 100;
      expect(Number(formatLength(s, PRECISION.SECOND, { style: 'plain' }))).toBe(
        roundCreditsHalfUp(s),
      );
    }
  });

  it('DOCUMENTED DIVERGENCE: sub-0.5s displays "0" but bills 1 credit (the floor)', () => {
    expect(Number(formatLength(0.3, PRECISION.SECOND, { style: 'plain' }))).toBe(0);
    expect(roundCreditsHalfUp(0.3)).toBe(1);
  });

  it('the walkthrough repro case: 6.027s reads and bills 6, not 7', () => {
    expect(Number(formatLength(6.027, PRECISION.SECOND, { style: 'plain' }))).toBe(6);
    expect(roundCreditsHalfUp(6.027)).toBe(6);
  });
});
