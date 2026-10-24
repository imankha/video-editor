# T13320: Reprice to 150 / 340 / 1,000 at $6.99 / $12.99 / $29.99, $12.99 in the middle

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Created:** 2026-10-23
**Updated:** 2026-10-23

Epic: [Pricing Rebalance](EPIC.md). Epic 2/3. Depends on T13310.

## Problem

Since T10220 (prod 2026-09-29) made $12.99 the lowest pack there have been no purchases. On the
previous ladder purchases clustered at $12.99 when it was the top, badged, best-value rung; the
80-credit $3.99 entry did not sell because it could not finish one game. Full evidence and the
statistical caveat are in the epic. User ruling 2026-10-23 (P1 to P3): exactly three packs, the
proven 340 / $12.99 rung kept byte-identical and moved to the middle with the badge and the
default selection, an entry rung sized to finish one game, a season anchor on top.

## Solution

Edit `src/backend/app/pricing.json` (single source since T10210; Stripe amounts are inline, so no
dashboard work; grants read pack metadata off the Stripe object, so in-flight payments are
unaffected):

| Key | Label | Credits | Price | c/credit | Pairwise k |
|---|---|---|---|---|---|
| `starter` | One Game | 150 | $6.99 | 4.66 | - |
| `popular` | Most Popular | 340 | $12.99 | 3.82 | 0.24 |
| `best_value` | Season | 1,000 | $29.99 | 3.00 | 0.22 |

Keep the pack keys (`starter` / `popular` / `best_value`) so `PACK_META`, the e2e specs and the
ledger's `pack` column stay stable; only the presentational labels change. The middle pack is
pre-selected when the buy modal opens and carries the "Most Popular" badge; the top pack keeps
"Best Value" or gets "Season" (ui-designer call, one badge each, nothing on the entry rung).
Entry-rung copy states what it buys: "one game: upload + about 10 highlights".

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/pricing.json` - the only pricing edit
- `src/backend/app/pricing.py` docstring worked number
- `src/frontend/src/components/BuyCreditsModal.jsx` - `PACK_META` labels/badges, default-selected pack (today nothing is pre-selected; add it as plain component state, not persisted)
- `src/landing/src/pages/index.astro` - pricing cards, lowest-rate stat, worked example (all derive from `pricing.json` via the `@editor` alias)
- `.claude/skills/deploy/SKILL.md` smoke-test example mentioning a pack price
- `src/frontend/e2e/t4940-monetization-qa.spec.js` (structural: 3 packs ascending; survives)
- Tests: `src/backend/tests/test_t4940_pack_pricing.py`, `src/frontend/src/config/pricing.test.js`, `BuyCreditsModal.test.jsx` (default selection + badge placement)
- Docs: `docs/plans/tasks/monetization-pass/T4940-...md` (append), `docs/plans/revenue-projection-2000-users.md` (note the new ladder)

### Related Tasks
- Depends on: T13310 (otherwise the derived storage anchor moves 4c to 5c and uploads cost 25% more credits again)
- Ships with: T13330 (same deploy)
- History: T4940, T10210, T10220, T8655 (the retired price map is gone; no analytics ladder to update)

### Technical Notes
- Ladder invariant tests (ascending price, strictly decreasing per-credit rate) hold; the k band
  0.15 to 0.25 is a design guideline, not a test.
- Deploy coordination (same landmine as T10220): a master push touching `pricing.json`
  auto-deploys the landing site. Merge only when the prod app `/deploy` follows immediately, or
  the site advertises a ladder the app does not charge.
- Revenue booking is safe across the switchover: T8620 records what Stripe captured, not the
  constant.
- Copy rules: "highlight" never "reel"; no em dashes; value-forward, not scarcity-forward.

## Implementation

### Steps
1. [ ] `pricing.json` edit; run `test_t4940_pack_pricing.py` + `pricing.test.js`
2. [ ] `PACK_META` labels/badges + default-selected middle pack + entry-rung copy; `BuyCreditsModal.test.jsx`
3. [ ] `npm run build` in `src/landing`; eyeball pricing section, lowest-rate stat, worked example
4. [ ] Update deploy skill example, T4940 doc, revenue projection note
5. [ ] One Stripe test-mode purchase on staging grants 150 / 340 / 1,000 for the respective pack

### Progress Log

**2026-10-23**: Filed from the pricing analysis. Rulings P1 to P3.

## Acceptance Criteria

- [ ] App buy modal and landing show exactly three packs: 150 / $6.99, 340 / $12.99, 1,000 / $29.99
- [ ] Middle pack pre-selected and badged "Most Popular"; entry rung unbadged
- [ ] Per-credit rate strictly decreasing (tests pass with no literal edits)
- [ ] Storage preview and charge unchanged by this task (T13310's pin test still green)
- [ ] Staging test purchase grants the right credit count for each pack
