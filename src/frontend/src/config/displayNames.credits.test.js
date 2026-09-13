import { describe, it, expect } from 'vitest';
import { CREDITS } from './displayNames';

/**
 * T9480 Stage E3 -- single-sourced credit rule copy, verbatim from
 * BuyCreditsModal's shipped T9750 wording. Round-HALF-UP, NOT ceil.
 */
describe('CREDITS (T9480 Stage E3)', () => {
  it('states the T9750 rule verbatim (round-half-up, not ceil)', () => {
    expect(CREDITS.PER_SECOND_RULE).toBe('1 credit per second, rounded to the nearest second');
    expect(CREDITS.PER_SECOND_RULE).not.toMatch(/rounded up/);
  });

  it('states the 1-credit floor', () => {
    expect(CREDITS.MIN_CHARGE).toBe('Any render costs at least 1 credit.');
  });

  it('billableLine composes the exact seconds, the credit count (pluralized) and the rule', () => {
    expect(CREDITS.billableLine(6.027, 6)).toBe(
      '6.0s of video · 6 credits · 1 credit per second, rounded to the nearest second.',
    );
    expect(CREDITS.billableLine(0.9, 1)).toBe(
      '0.9s of video · 1 credit · 1 credit per second, rounded to the nearest second.',
    );
  });
});
