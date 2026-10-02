# T11650: Signup 88 -> 48 + landing page copy (ships LAST)

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-10-02
**Updated:** 2026-10-02

## Epic Context

This is task 5 of 5 in the Free Second Highlight epic. Read [EPIC.md](EPIC.md), and especially its
**Release order** note.

**Merge only after T11620 + T11630 are on master**, and only after T11610's gate has passed (p90
of credits spent before the first export is 48 or less, or the user has explicitly accepted
otherwise). This task lowers what new users get, and the pass is what makes up for it.

Classification hint: M-tier. Backend constant + landing + tests.

## Solution

### 1. Signup grant

- `services/storage_credits.py`: change `WELCOME_CREDITS = 80` to `40`.
  - Update its comment: the owner superseded ruling G1 on 2026-10-02 (Free Second Highlight epic).
    New total is 8 + 40 = 48 at signup, plus the free pass worth up to 40.
  - `NEW_ACCOUNT_CREDITS` stays 8.
- **Do NOT rename** the frozen `quest_upfront` / `questbank` strings.
- **Existing accounts are unaffected**, by design of the remainder calc in
  `grant_welcome_credits`:
  - An account that already has 80 has a remainder of 40 - 80 < 0, so it is a no-op.
  - A legacy account with partial quest rewards under 40 is topped up to 40. Accepted, and very
    rare.
  - Add a test for the "already has 80, gets nothing, balance unchanged" case.
- Update the tests that assert the fresh-signup balance:
  - `test_delete_reregister_newuser_flow.py` derives it from the constants, so check it still
    passes.
  - `test_t11170_welcome_credits.py`'s `WELCOME_TOTAL`.
  - Grep for `88` and `80` across `src/backend/tests` and `src/frontend/src` tests.
- Update `docs/plans/tasks/quest-removal/EPIC.md`: mark G1 superseded, with a link to this epic.
- `CreditBalance.jsx`'s "You start with {balance} free credits" uses the live balance and needs no
  change.

### 2. Landing page (`src/landing`)

- `src/landing/src/site.ts:73`: change `freeCredits: 88` to `48`.
  - Rewrite the doc comment: 8 + 40 at signup, and the source of truth is still the two constants.
  - Add a new fact for the pass:
    `freePassSeconds: 40, // Source of truth: FREE_PASS_MAX_CREDITS in storage_credits.py`.
- In the pricing card in `src/landing/src/pages/index.astro:357-358`:
  - The number stays `{FACTS.freeCredits}` (now 48).
  - The caption changes from "free credits the moment you sign up, no strings attached" to: "free
    credits when you sign up, and after you publish a highlight, your next one is free for 24
    hours (up to {FACTS.freePassSeconds} seconds)".
- Grep `src/landing` (pages, FAQ, JSON-LD, `llms.txt`, if present) for other free-credit claims
  and make them consistent. The FAQ is a likely spot.
- Build the landing site locally (`npm run build` in `src/landing`) and check the rendered pricing
  card at phone width.

### 3. Release

- Merge to master last in the epic.
- Run `/deploy-landing` right after the prod `/deploy` that contains this task, never before. The gap
  between the two deploys is the only time the site and product disagree, so keep it to minutes.

## Acceptance

- [ ] A fresh signup on staging gets 48. An existing account's balance is unchanged after login.
- [ ] Landing shows 48 + the free next highlight; there are no stale "88" claims anywhere in
      `src/landing`
- [ ] Quest-removal G1 is marked superseded
- [ ] Landing deployed in the same window as the prod deploy
