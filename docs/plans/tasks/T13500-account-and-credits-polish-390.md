# T13500: Account and credits polish from the 390 pass (Escape, truncated email, ledger labels, copy)

**Status:** TODO
**Impact:** 2
**Complexity:** 2
**Tier:** S/M (frontend copy + small backend label map)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, at 390x844 (report bugs 3, 4, 6, 14).

## Problem

Small issues, one sweep:

1. **Escape does not close Account Settings.** Only the X closes it.
2. **Account menu truncates the email** ("imankh+stg-qa-20261025..."). Fine for long addresses, but check a tooltip or wrap.
3. **Usage history shows "game video add"** (lowercase, internal source name `game_video_add`, see `credit_ledger.py:102`). A parent should read something like "Footage added to a game".
4. **Usage history list uses the native white scrollbar** on the dark dialog.
5. **Buy Credits says "Your credits go further now."** (`BuyCreditsModal.jsx:520`): vague, explains nothing.
6. **Report a problem confirmation says "Thanks -- we'll look into it."** (`ReportProblemButton.jsx:328`): double hyphen.

## Context

### Relevant Files
- `src/frontend/src/components/AccountSettings.jsx`
- Account menu component
- `src/backend/app/services/credit_ledger.py` (source label map) and the usage history component
- `src/frontend/src/components/BuyCreditsModal.jsx`
- `src/frontend/src/components/ReportProblemButton.jsx`

## Acceptance Criteria

- [ ] Escape closes Account Settings
- [ ] Every usage-history row has a capitalised, plain-language label
- [ ] Scrollbar matches the dark theme
- [ ] Copy items 5 and 6 rewritten (no em dashes, no double hyphens)
