/**
 * Credit-pack pricing, derived from the single source of truth
 * `src/backend/app/pricing.json` (T10210). Mirrors `app/pricing.py` rule for rule:
 *
 * - CREDIT_PACKS: the ladder in file order (ascending price, decreasing per-credit rate).
 * - CREDIT_VALUE: storage-cost anchor ($/credit) = the WORST-CASE (highest) per-credit
 *   rate, rounded UP to a whole cent. Must equal the backend's or the upload cost
 *   preview disagrees with the charge.
 *
 * Store-free on purpose: the landing site imports this through its `@editor` alias.
 * The app's purchase UI still renders packs from `GET /api/payments/config` at runtime;
 * this module is for build-time derived copy (landing pricing cards, worked examples)
 * and the storage-cost formula.
 */
import pricing from '../../../backend/app/pricing.json';

/** @type {{ key: string, name: string, credits: number, price_cents: number }[]} */
export const CREDIT_PACKS = pricing.credit_packs;

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

/** Cheapest per-credit rate on the ladder, in cents. */
export const LOWEST_RATE_CENTS = packRateCents(BEST_VALUE_PACK);

/** Worst-case $/credit, rounded up to a whole cent (see header). */
export const CREDIT_VALUE = Math.ceil(Math.max(...CREDIT_PACKS.map(packRateCents))) / 100;

/** Dollars for `credits` at the cheapest rate, e.g. costAtBestRateUsd(48) -> 1.83. */
export function costAtBestRateUsd(credits) {
  return (credits * LOWEST_RATE_CENTS) / 100;
}
