# T16160: AI analysis price and charge

## In plain words

Today credits (the app's prepaid currency) pay for two things: storing a game, priced by file size, and making a highlight, priced by the second. An AI analysis of a 90-minute game costs us about $2.84 in model fees, so it needs its own price. We will charge 1.5 credits for each minute of video, which is 135 credits for a 90-minute game: a little above cost on our cheapest pack and comfortably above on the others, as the owner asked. Credits are set aside when the analysis starts, taken only when the result is ready, and given back in full if it fails. A parent whose game was already analysed for someone else pays the same and gets the result at once. An analysis that finishes is always charged, even if it found few plays (owner, 2026-11-12). Done when the price shown before purchase equals the amount charged, a failed analysis leaves the balance unchanged, and the admin can see credits earned against model cost for every analysis.

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Tier:** L (money path, shared-database table; Migration agent)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 3 of 7. The margin table is in EPIC.md, section "Price".

## Problem

There is no price, no charge and no record of who bought an analysis. Without a purchase record the stored result of T16150 cannot be sold to a second parent, and without a cost read-out nobody can tell whether the feature makes or loses money.

## Solution

1. **Price in the pricing file.** `ai_analysis.credits_per_minute: 1.5` in `pricing.json`. Price = minutes of video, summed over the game's videos, times the rate, rounded up, minimum 1. The frontend reads the same file, so the upload dialog and the server always agree.
2. **Quote.** `GET /api/games/analysis-quote?duration_seconds=..&sport=..` (before the game exists, for the upload dialog) and `GET /api/games/{id}/analysis-quote`. Returns credits, minutes, balance, shortfall, whether a stored result already exists for this video, whether one is running, and whether the option is available (with the reason if not: kill switch, cap, sport not supported, video too long, storage expired).
3. **Buy.** `POST /api/games/{id}/analysis` reserves the credits, records the purchase and asks T16150 for the analysis. On ready, the reservation is confirmed, whatever the number of plays found. On failure, it is released. The parent can cancel free of charge until the upload finishes; once the analysis has started there is no cancel. A stored result confirms immediately. Short balance returns the existing 402 with required and balance.
4. **Once per parent per game.** A second buy of the same game by the same profile returns the existing purchase and charges nothing. Changing team later (T16190) is free.
5. **Read-out for the owner.** An admin table: per analysis, model cost in dollars, number of buyers, credits charged, and the credits valued at the Season pack rate after card fees (the most cautious figure). Totals for the last 30 days, with the share paid from free credits shown separately.
6. **Measure.** `ai_analysis_purchased` and `ai_analysis_ready` as Journey milestones with the sport in context.

## Why this and not something else

A flat price per game was ruled out because a 25-minute small-sided game would pay for a 90-minute one, and the owner asked for cost to follow length. Charging up front and refunding on failure was ruled out in favour of reserve-then-take, which is what exports already do and which never shows a charge for work that did not happen. Giving the second parent a discount on a stored result was ruled out: the owner's rule is only that we do not compute twice.

## For the implementer

### Proposed table (Postgres; Architect confirms)

`game_analysis_purchases`: id, user_id, profile_id, game_id (the buyer's own game id), analysis_id (FK `game_analyses`), credits, reservation_id, status (reserved, charged, released), created_at, settled_at. Unique on (user_id, profile_id, game_id). One purchase covers every video of the game; a multi-video game links to several analyses through a child table or one row per video with a shared purchase key (Architect decides; the unique rule above must hold either way).

### Relevant Files (REQUIRED)
- `src/backend/app/pricing.json`, `app/pricing.py`, `src/frontend/src/config/pricing.js`
- `src/backend/app/services/credit_ledger.py`: add sources `ai_analysis` and `ai_analysis_refund` to `KEY_PREFIX` and to the refund enumeration; use `reserve_credits`, `confirm_reservation`, `release_reservation`; idempotency key `credit_key("ai_analysis", f"{profile_id}:{game_id}")`
- `src/backend/app/routers/analysis.py` (quote, buy), `services/game_analysis.py` (settle hook on ready and failed)
- `src/backend/app/services/pg.py` and a postgres migration
- `src/backend/app/analytics.py`, admin router and admin screen for the read-out
- `src/frontend/src/utils/analysisCost.js` (new, mirror of the price formula, next to `storageCost.js`)

### Technical Notes
- `recover_orphaned_reservations` must know about analysis reservations so a job lost for good releases its credits.
- The credit migration gate (`credit_migration_state`) returns 503 on mutations while closed; the buy endpoint follows the same rule.
- T13310 removed the dollar value of a credit from the code. The read-out computes its cautious rate from the Season pack in `pricing.json` and a card-fee constant; it is an admin estimate, never shown to parents.
- Free-credit share: `credit_transactions` already records grants; the read-out estimates the share from the buyer's lifetime granted against purchased credits.
- Storage keeps its own charge at activation; this task does not touch it.

### Related Tasks
- Depends on: T16150 (`game_analyses`, the ensure call). Blocks: T16170, T16180.

## Acceptance Criteria

- [ ] A 90-minute game quotes 135 credits; a 25-minute game quotes 38; the server and the frontend helper agree on ten sample durations.
- [ ] Buying reserves the quoted credits; when the analysis is ready the balance is lower by exactly that amount, once.
- [ ] A failed analysis leaves the balance exactly as before the purchase.
- [ ] An analysis that finishes with very few plays is charged in full.
- [ ] Cancelling before the upload finishes charges nothing; no cancel is offered after the analysis starts.
- [ ] Buying the same game twice from the same profile charges once.
- [ ] A second account buying a video with a stored result is charged the full price and no model call is made.
- [ ] A short balance returns 402 with the amount required and the balance.
- [ ] The admin read-out lists each analysis with model cost, buyers and credits, and its 30-day total matches the ledger in a seeded test.
- [ ] `ai_analysis_purchased` and `ai_analysis_ready` appear in the admin Journey inspector.
