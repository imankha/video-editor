# Monetization Pass (pricing redo + cost transparency + revenue truth)

**Status:** STAGING (all 4 tasks merged to master 2026-07-25)
**Impact:** 8
**Complexity:** 5
**Priority:** 1.6
**Created:** 2026-07-24

## Goal

Make paying feel fair and predictable, and make our revenue numbers true. Three strands,
one theme — the user should never be surprised by a credit charge, and we should never be
surprised by our own books:

1. **See the cost before you commit** (T5780 + T5790) — driven by 2026-07-24 feedback from
   our biggest user: slow-mo makes a 6s clip cost 9 credits while the UI still says 6s —
   "a bit of a guessing game." Show the effective output length live in Framing, and the
   estimated credit cost right on the Export button.
2. **Redo pricing + explain credits everywhere** (T4940) — reprice packs toward ~5c/credit
   (economics validated: ~90% gross margin at 5c; ladder proposal in the task), state the
   "1 credit = 1 second of exported video" rule on every credit surface, single-source pack
   definitions, add usage history. Workstream C (prod live-Stripe go-live) already executed
   2026-07-22 — only verification remnants remain.
3. **Revenue reconciliation** (T5760) — treat Stripe as the source of truth for revenue;
   drift report + admin heal gesture for `total_spent_cents`.

## Why now

Prod went live-Stripe on 2026-07-22 — money is real as of this week. Every day of opaque
pricing now costs trust with exactly the most engaged payers (the T5780/T5790 feedback came
from our biggest user unprompted), and every purchase recorded twice inflates the books
T5760 exists to fix. The pricing redo (T4940 Workstream A) was user-directed on 2026-07-12
and has been parked behind the go-live gate, which is now cleared.

## Tasks

Within-epic order = dependency order (T5780's extracted util feeds T5790; T5790 delivers
T4940's pre-flight-export-cost item; T5760 is independent and lands last).

| ID | Task | Status |
|----|------|--------|
| T5780 | [Framing shows effective (slow-mo-adjusted) clip length](T5780-framing-effective-duration-display.md) | STAGING |
| T5790 | [Show estimated credit cost on the Framing Export button](T5790-export-credit-cost-estimate.md) | STAGING |
| T4940 | [Monetization pass: credit transparency + ~5c repricing](T4940-monetization-pass-credit-transparency-pricing.md) | STAGING |
| T5760 | [Stripe revenue reconciliation](T5760-stripe-revenue-reconciliation.md) | STAGING |

## Shared design decisions

- **One cost calculator.** All user-facing cost numbers derive from the same code path the
  charge uses: `calculateEffectiveDuration` (extracted to `utils/effectiveDuration.js` in
  T5780) + `creditStore.getRequiredCredits` (`Math.ceil` of output seconds). The number on
  the button, in the insufficient-credits modal, and in the backend charge must never
  disagree.
- **Estimates are optimistic, backend is authoritative.** UI estimates inform; they never
  gate. The click-time 402 flow stays the enforcement point.
- **No fabricated numbers.** Unknown/NaN duration hides the estimate (logged), it never
  shows a guess — same rule as the poster/no-silent-fallback standard.
- **Overlap guard:** T4940 Workstream B item 2 (pre-flight export cost display) is DELIVERED
  BY T5790 — the T4940 implementor must not rebuild it; T4940 keeps the remaining B scope
  (pack-card rule copy, explainer, upload cost preview, usage history).
- **Value-forward copy** (user intent, 2026-07-12): "your credits go further now", never
  scarcity-forward.

## Out of scope / related

- **T780** (quest redesign + credit pack pricing, 2026-03-31): its pricing half
  ($3.99/$6.99/$12.99 price points) is superseded by T4940's ladder; the quest 3/4 redesign
  half is not monetization and stays a standalone backlog task.
- **T520** (pricing exploration): superseded by T4940 (already noted there); close when
  T4940 lands.
- **T5490** (upload opt-in + paid add-on gating): stays last in the movement-tracking epic
  by design (dogfood free first); it consumes the same credits rails this epic polishes.
- **T1702** (monetization analytics + intelligence): stays in the Analytics epic; T5760
  supplies the trustworthy revenue substrate it will read.

## Completion Criteria

- [ ] All four tasks DONE (user gesture per task-status rule)
- [ ] A slow-mo edit shows its output length and credit cost before export, matching the actual charge
- [ ] New pack pricing live at ~5c/credit top tier, user-approved ladder
- [ ] "1 credit = 1 second of exported video" stated on every credit surface; usage history visible
- [ ] Admin revenue view reconciles against Stripe with an explicit heal gesture
- [ ] Remaining T4940 Workstream C verification items closed (test card declined on prod, real charge in live dashboard, staging workflow pk_test moved to a GitHub secret, decision recorded on prior test-mode grants)
