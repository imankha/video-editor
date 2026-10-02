# T11610: Baseline: second-export rate + credits spent before first export

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-10-02
**Updated:** 2026-10-02

## Epic Context

This is task 1 of 5 in the Free Second Highlight epic. Read [EPIC.md](EPIC.md).

## Problem

We are about to cut the signup grant from 88 to 48 credits (T11650). We also want to show that the
free pass actually raises second exports. Neither is possible without numbers from before launch.
We currently have none: no doc records how many users make 1 export vs 2 or more.

## Solution

Write a read-only script, `scripts/measure_free_pass_baseline.py`, against **Postgres only**. It
must not download any per-user SQLite. Run it on prod and record the output in this file.

Data source: `credit_transactions` (columns user_id, amount, source, reference_id, video_seconds,
created_at).
- An export is a `framing_usage` debit, net of any `framing_refund` with the same reference.
- Signup time is the user's `new_account_bonus` row.
- Exclude test accounts using the same filter the admin user table uses (`user_segments`
  `was_test_account` and similar). Grep `routers/admin.py` for it.

Report, for accounts created in the last 90 days:

1. Signup to first export rate.
2. Of users with 1 or more exports: the share with a 2nd export within 24h of the first, and within
   7 days.
3. The distribution of credits spent before the first export (p50/p90/p99): uploads + game video
   adds + clip uploads + the first export itself.
4. The distribution of the first export's cost (p50/p90). This tells us how often 40 covers a whole
   highlight.

## Gate

**If p90 of item 3 is over 48, stop and tell the user before T11650 merges.** It would mean a
meaningful share of new users can't reach their first highlight on the new signup grant.

## Acceptance

- [ ] The script is read-only (SELECT only), with `--env dev|staging|prod`
- [ ] The prod numbers are pasted into a "Results" section of this file with the run date
- [ ] Gate checked and the outcome stated
