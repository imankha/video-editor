# Epic: Pricing Rebalance (3 price points, storage per GB, paywall instrumentation)

**Status:** TODO (ladder, storage rule and instrumentation decided by the user 2026-10-23; see Decisions)
**Started:** 2026-10-23
**Completed:** -
**Impact:** 8 **Complexity:** 4 **Priority:** 2.0

## Goal

Restore purchases. Ship exactly three credit packs with the proven $12.99 / 340 rung in the
middle, make an entry pack that actually finishes one game, add a season anchor on top, price
storage per GB at roughly cost, and record the paywall so the next pricing decision has a
denominator.

## Evidence (2026-10-23, from git history and the prod snapshots recorded in task docs)

Ladder history (prod go-live dates):

| Live on prod | Ladder (credits / price) | c per credit |
|---|---|---|
| 2026-03-19 (test mode) | 120/$4.99, 400/$12.99, 1000/$24.99 | 4.2 / 3.2 / 2.5 |
| 2026-03-31 (test mode) | 40/$3.99, 85/$6.99, 180/$12.99 | 10.0 / 8.2 / 7.2 |
| 2026-07-22 live Stripe, same ladder | | |
| 2026-07-28 (T4940) | 80/$3.99, 160/$6.99, 340/$12.99 | 4.99 / 4.37 / 3.82 |
| 2026-09-29 (T10220) | 340/$12.99, 690/$22.99, 1,120/$32.99 | 3.82 / 3.33 / 2.95 |

What happened:

- On the 80/160/340 ladder the purchases that occurred clustered at $12.99, the TOP rung,
  badged "Best Value" with a +33% bonus. The 80-credit entry pack drew little: it does not cover
  one game (upload plus 6 to 10 highlights at 8 to 15 credits each).
- T10220 made $12.99 the FLOOR and moved the badge off it. Zero purchases in the 3.5 weeks since
  (2026-09-29 to 2026-10-23). At the earlier rate of roughly one purchase every two weeks, a
  3.5-week zero has about a one in six chance of being noise, and the October UI overhaul plus a
  ~1 in 20 export rate confound it. Not significant, but the behavioral reading and the numbers
  point the same way: people bought "the obviously best deal", not "$12.99". At the floor it read
  as "the smallest pack" and the first paid decision tripled in size.
- Unit economics never constrained any ladder: marginal GPU plus storage is ~0.3 to 0.5c per
  credit (85 to 93% gross margin at every rung ever shipped). Pricing is positioning.
- Storage cost basis per uploaded game: R2 storage $0.015 per GB-month; game video bytes move
  browser-to-R2 and R2-to-browser via presigned URLs (zero egress); only clip previews and
  highlight downloads stream through Fly (~$0.02 per GB in NA, a few cents per game); R2
  operations are negligible.

## Decisions (user, 2026-10-23)

| # | Decision | Ruling |
|---|---|---|
| P1 | Number of packs | Exactly three. No top-up rung below, no fourth "season" rung above. |
| P2 | Ladder | 150 / $6.99 (4.66c), 340 / $12.99 (3.82c), 1,000 / $29.99 (3.00c). Per-credit elasticity k = 0.24 (rung 1 to 2) and 0.22 (rung 2 to 3), inside the 0.15 to 0.25 band the ladder tests assume. $32.99 / 1,120 is an acceptable substitute for the top rung if the user prefers it; $29.99 / 1,000 reads cleaner. |
| P3 | Middle rung | 340 / $12.99 stays byte-identical (the only price that has ever sold); it carries the "Most Popular" badge and is pre-selected. |
| P4 | Storage pricing | Per GB, at roughly what we pay R2 plus a cushion for Fly bandwidth: **1 credit per GB per 30 days, GB rounded up, minimum 1**. This replaces the pack-rate-derived `CREDIT_VALUE` anchor, so future repricing never silently changes upload costs. |
| P5 | Auto-export surcharge (+1 credit on upload) | Keep (it pays for the recap render, not storage). Can be revisited separately. |
| P6 | Measurement | Record the paywall (insufficient-credits modal) and buy-modal opens as funnel events; admin shows paywall-hit vs purchased as a pair, and pack mix from the payments ledger. |

## Tasks (dependency order; all three ship in ONE prod deploy so the landing site and the app flip together)

| ID | Task | Status |
|----|------|--------|
| T13310 | [Storage priced per GB-month, decoupled from the pack ladder](T13310-storage-per-gb-month.md) | TODO |
| T13320 | [Reprice to 150 / 340 / 1,000 at $6.99 / $12.99 / $29.99, $12.99 in the middle](T13320-three-pack-ladder-12-99-middle.md) | TODO |
| T13330 | [Paywall + buy-modal funnel events and pack-mix admin view](T13330-paywall-funnel-events-pack-mix.md) | TODO |

T13320 depends on T13310: with the derived anchor still in place, a $6.99 / 150 entry rung would
move `CREDIT_VALUE` from 4c to 5c (ceil of 4.66c) and raise every upload charge by 25% again.

## Completion Criteria

- [ ] App buy modal and landing pricing section show exactly three packs, 150 / 340 / 1,000 at
      $6.99 / $12.99 / $29.99, strictly decreasing per-credit rate, middle pre-selected and badged
- [ ] A 6 GB upload for 30 days costs 6 + 1 credits in the app preview, the backend charge and the
      landing worked example (all three computed from one rule)
- [ ] Changing `pricing.json` no longer changes any storage charge (pinned by test)
- [ ] Admin funnel shows "Hit paywall" and "Purchased" side by side, plus pack mix for the last
      90 days from the `payments` ledger
- [ ] Landing and app deployed together (landing auto-deploys on the `pricing.json` master push;
      merge is coordinated with the prod `/deploy`)
- [ ] Review after 6 weeks of data: first-purchase rate among paywall hitters, pack mix, ARPPU.
      Recorded here, with a go / adjust call on the ladder

## Out of scope

- A fourth pack or any subscription (P1).
- Changing the 88 free credits per signup.
- Activation work. Exports are ~1 in 20 signups; that remains the bigger lever and is tracked in
  the Parent Usability Audit and First Reel Funnel milestones, not here.
