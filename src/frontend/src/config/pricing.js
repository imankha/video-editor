/**
 * Credit-pack pricing, derived from the single source of truth
 * `src/backend/app/pricing.json` (T10210). Mirrors `app/pricing.py` rule for rule:
 *
 * - CREDIT_PACKS: the ladder in file order (ascending price, decreasing per-credit rate).
 *
 * Store-free on purpose: the landing site imports this through its `@editor` alias.
 * The app's purchase UI still renders packs from `GET /api/payments/config` at runtime;
 * this module is for build-time derived copy (landing pricing cards, worked examples).
 * Storage is NOT priced from this ladder (T13310; see utils/storageCost.js).
 */
import pricing from '../../../backend/app/pricing.json';

/** @type {{ key: string, name: string, credits: number, price_cents: number }[]} */
export const CREDIT_PACKS = Object.freeze(pricing.credit_packs.map((p) => Object.freeze({ ...p })));

/** Price per credit, in cents. */
export function packRateCents(pack) {
  return pack.price_cents / pack.credits;
}

/** Price in dollars, e.g. 3.99. */
export function packPriceUsd(pack) {
  return pack.price_cents / 100;
}

/** The pack with the cheapest per-credit rate (the "best value" tier). */
export const BEST_VALUE_PACK = CREDIT_PACKS.reduce((best, p) =>
  packRateCents(p) < packRateCents(best) ? p : best
);

/** The pack both pricing surfaces feature ("Most Popular"; the buy modal pre-selects it). */
export const FEATURED_PACK_KEY = 'popular';

/** Cheapest per-credit rate on the ladder, in cents. */
export const LOWEST_RATE_CENTS = packRateCents(BEST_VALUE_PACK);

/** Dollars for `credits` at the cheapest rate, e.g. costAtBestRateUsd(48) -> 1.83. */
export function costAtBestRateUsd(credits) {
  return (credits * LOWEST_RATE_CENTS) / 100;
}

/** Measured all-in credits per exported play (pricing.json `credits_per_play`). Copy only, never billing. */
export const CREDITS_PER_PLAY = pricing.credits_per_play;

/**
 * Approximate plays a credit amount covers, rounded to the nearest 5 so it never reads as
 * a promise. Render it with a leading "~": real cost depends on play length.
 */
export function approxPlays(credits) {
  return Math.round(credits / CREDITS_PER_PLAY / 5) * 5;
}
