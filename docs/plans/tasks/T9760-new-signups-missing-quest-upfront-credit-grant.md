# T9760: New signups are not receiving the 80-credit quest_upfront grant on production

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-12
**Updated:** 2026-09-12

## Source

Discovered running T9680's production verification script (`scripts/verify_t9680_credits.py`)
against prod Postgres, 2026-09-12. Not part of the original T9680 questions — a new finding
surfaced while confirming an unrelated one (mirrors how T9740 was discovered during T9710).

## Problem

T9680's code-side research concluded a new account receives **88 credits, no conditions**: 8
(`NEW_ACCOUNT_CREDITS`, `services/storage_credits.py:25`, source `new_account_bonus`) + 80
(`QUEST_CHAIN_CREDIT_TOTAL`, `quest_config.py:24`, source `quest_upfront`), both granted
synchronously during session init (`session_init.py:294` and `:321`), keyed
`signup:{user_id}` / `questbank:{user_id}`.

**Production data contradicts this.** Sampling the 10 most recent real signups
(2026-09-09T10:30Z through 2026-09-12T16:13Z — a 3-day window, ruling out same-day async lag) via:

```sql
SELECT user_id,
       SUM(amount) FILTER (WHERE idempotency_key LIKE 'signup:%') AS signup_amt,
       SUM(amount) FILTER (WHERE idempotency_key LIKE 'questbank:%') AS questbank_amt,
       MIN(created_at) AS first_grant_at
FROM credit_transactions
WHERE source IN ('new_account_bonus', 'quest_upfront')
GROUP BY user_id
ORDER BY first_grant_at DESC
LIMIT 10
```

**Every one of the 10 users has `signup_amt = 8` and `questbank_amt = NULL`** (NULL means zero
matching rows, not a zero-value grant). New users on production today appear to be receiving
**8 credits, not 88** — a 91% shortfall against the documented/advertised grant, and against the
homepage's "88" figure (`landing/src/site.ts:72-73`).

## Why this matters

- This is the free-credit grant every new parent's first impression of the product depends on.
  At 8 credits, uploading even one game (upload cost 1-3+ credits) leaves almost nothing for a
  single Focus render (`ceil`/round-half-up per-second charging, section 2 of T9680).
- T9650 (align work/pricing/retention copy) and T9480 (billing precision copy) both depend on
  T9680's numbers being correct. Shipping copy that says "88 free credits" while production
  grants 8 would be shipping a customer-facing lie, not a rounding nuance.
- The homepage (`index.astro:332-333`) and in-app balance already disagree per T9680's original
  finding; this may be the SAME root cause read from a different angle, or a second independent
  bug. Needs to be established which.

## Investigation needed (root cause not yet established — code review said this path works)

`session_init.py:294`/`:321` calls the quest_upfront grant during session init per the T9680
code-side read, but production data says it isn't landing for real users. Candidates, none yet
confirmed:

1. An exception in the quest_upfront grant call is being caught and swallowed somewhere in
   `session_init.py`'s init sequence, so the request still succeeds (200 OK, session created)
   while the grant silently fails.
2. A feature flag, environment gate, or config value in prod differs from what the code assumes
   (e.g. `credit_migration_state.ready_at` gating — though that gate is confirmed OPEN since
   2026-07-28, so it's unlikely to be this).
3. The `idempotency_key` pattern the grant actually writes in production has drifted from
   `questbank:{user_id}` (e.g. a refactor changed the prefix but this verification query, and the
   original code read, both assumed the old one) — check current production ledger rows for ANY
   grant source resembling a quest/questbank grant with a different key shape before assuming the
   grant is missing entirely rather than just differently keyed.
4. The grant path was recently changed (post-T8120, which "moved to granting the full quest-chain
   total upfront") and the deployed prod build is behind whatever commit made that change land
   correctly in code but not in the version actually running.

**Per CLAUDE.md's model policy, this is a root-cause investigation whose mechanism is not obvious
from a first read — escalate to the Code Expert / expert agent rather than guessing.** Read
`.claude/knowledge/backend-services.md` first.

## Acceptance Criteria

- [ ] Root cause of the missing `questbank:%` grant identified with evidence (not guessed)
- [ ] Confirm whether this is the SAME root cause as T9680's original homepage-vs-in-app
      wording mismatch, or a second independent issue
- [ ] Fix implemented so new signups receive the full 88-credit grant (or whatever the corrected
      intended total is, if investigation reveals the intended number itself is in question)
- [ ] Regression test: a new-account signup flow test asserting both `new_account_bonus` (8) AND
      `quest_upfront` (80) post with the expected idempotency keys
- [ ] A rough estimate of user impact (how many real signups since this likely started received
      only 8 credits) — informs whether affected users need remediation credits, per
      `feedback_post_deploy_user_notification` (bug fixes → ask affected users to retest,
      approval-gated)
- [ ] T9680's Decision Record cross-referenced once this closes

## Related Tasks

- Found during: T9680 (production verification)
- Blocks (transitively, via T9680's finding): T9650 should not ship an "88 free credits" figure
  until this is resolved or the real number is confirmed
