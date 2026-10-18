# T12900: Staging gate fixture accounts are missing, so gate lanes B and C cannot run

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** S (host-side data seed plus a runner preflight; no app code)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Found by:** T9720 release check, 2026-10-18

## Problem

On 2026-10-18 `POST /api/auth/dev-login` on staging returned 404 "No user with email ... in staging
Postgres" for both `e2e-gate@test.local` and `e2e-gate2@test.local`. The admin user list on staging
shows only four accounts (`hello@reelballers.com`, `imankh@gmail.com`, `drewsoccerati@gmail.com`,
`e2e@test.local`). So:

- `bash scripts/staging-gate.sh` lanes B and C fail at their dev-login probe until someone re-seeds.
- Any host-side staging walk that needs a second account (T9720 needed one, T12590 holds
  `e2e@test.local`, and staging allows one live session per account) has nowhere to run except
  imankh's own data.

Either a staging reset since the last gate run dropped the alias users, or they were never re-seeded
after it. Nothing flagged it; it surfaced only when a walk tried to log in.

## Solution

1. Re-seed both aliases with the documented step-0 sequence in `src/frontend/e2e/STAGING-GATE.md`
   (stop the staging machine, `copy_user_between_envs.py ... --to-email e2e-gate@test.local` and
   `e2e-gate2@test.local` per `FIXTURE-CONTRACT.md` § Seeding, start the machine), at a time no walk is
   using staging.
2. Find what removed them: check `scripts/reset_all_accounts.py` and any staging wipe since the last
   green gate run for whether it deletes `*@test.local` users that are not `e2e@test.local`. If a reset
   path drops them, make that path re-seed them or exclude them, and say which in this file.
3. Make the gap visible earlier: the runner already probes dev-login and fails fast; confirm its
   message names the missing account and the exact re-seed command.

## Context

### Relevant Files
- `src/frontend/e2e/STAGING-GATE.md`, `src/frontend/e2e/FIXTURE-CONTRACT.md` (seeding commands)
- `scripts/staging-gate.sh` (dev-login probe)
- `scripts/copy_user_between_envs.py`, `scripts/reset_all_accounts.py`

### Related Tasks
- Found by T9720 (blocked a separate-account run on 2026-10-18)
- Memory: staging-gate lanes B and C must be imankh `--to-email` clones, never real accounts

## Acceptance Criteria

- [ ] `dev-login` on staging succeeds for `e2e-gate@test.local` and `e2e-gate2@test.local`
- [ ] The cause of their removal is named, and the reset path that removed them now keeps or re-seeds them
- [ ] `bash scripts/staging-gate.sh` gets past its account probe on all three lanes
