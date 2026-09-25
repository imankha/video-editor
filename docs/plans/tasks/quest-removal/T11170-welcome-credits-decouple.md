# T11170: Welcome credits no longer depend on quests

**Status:** WIP
**Impact:** 8
**Complexity:** 2
**Created:** 2026-09-24
**Epic:** [Remove the Quest System](EPIC.md)

## Problem

80 of the 88 free credits a new user gets are granted by the quest system
(`session_init.py:314-329` -> `credit_ledger.grant_quest_chain_credits`,
`credit_ledger.py:761-792`, amount `QUEST_CHAIN_CREDIT_TOTAL` in `quest_config.py:24`). Deleting
quests without moving this silently drops new signups to 8 credits and falsifies the landing
page (`landing/src/site.ts:72-73`, `index.astro:354`).

## Solution

- Move the 80 to `storage_credits.py` as `WELCOME_CREDITS` (or the amount ruled in G1); rename
  the function to `grant_welcome_credits`. Everything else unchanged.
- **Freeze the ledger strings**: source `quest_upfront`, key prefix `questbank:`
  (`credit_ledger.py:77-81`), and the "already granted" source set `('quest_reward',
  'quest_upfront')` (`:744-758`). Changing any of them pays every account again. Add a comment
  on the constants saying exactly that.
- `CreditHistoryModal.jsx:25-26`: keep `quest_upfront` labelled "Welcome credits"; relabel the
  historic `quest_reward` rows (e.g. "Welcome credits" too). No Postgres row changes.
- **Delete** the admin backfill endpoint (`admin.py:1400-1419`, `credit_ledger.py:795-861`)
  and its tests (G2): it never ran on prod, and the per-login grant is the just-in-time path
  that reaches every user on their next session. Amount stays 88 total (G1).
- Update the `site.ts` comment that points at `quest_config`.

## Acceptance Criteria

- [ ] Red-then-green: with `quest_config` gone, a fresh signup ends at the advertised total
- [ ] A second login / session init grants 0 more (idempotency test)
- [ ] An account that already received `quest_reward` rows gets only the remainder
- [ ] No Postgres migration; ledger strings byte-identical
