# T18040: Tell existing users the privacy policy changed, and let them opt out in the app

## In plain words

On 2026-11-20 the privacy policy and terms changed (T18030): they now say an AI model may analyze a game the parent chooses, and that we may use uploaded videos and the parent's own marks inside ReelBallers to test and improve the product, unless the parent opts out. Two promises in that wording have nothing behind them yet. The policy says we tell users about a material change with a notice in the application, and no such notice exists. And the opt-out is "email privacy@reelballers.com", which means someone keeps a list by hand and every test has to be checked against it. We will show every signed-in user a one-time notice that the policy changed, with what changed in two sentences and a link, and add a setting under "Your privacy rights" that turns the internal-testing use off for their account. Until a user has seen the notice, their footage is not used for testing. Done when an existing user sees the notice once, can switch the testing use off in the app, and the tool that picks test footage refuses any account that has opted out or has not yet seen the notice.

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Tier:** M (one notice, one setting, one small Postgres change; Migration agent)
**Created:** 2026-11-20

Follows T18030. Owner request 2026-11-20.

## Problem

- Section 10 of the privacy policy promises an in-app notice for material changes. Today a user learns of the change only by opening `/privacy` and reading the date.
- The opt-out the policy offers is an email address. Nothing in the app records it, so it cannot be enforced by code.
- New wording does not by itself cover footage uploaded before a user was told. Since 2026-11-20 testing has used only accounts whose owners agreed in person (the owner, and two partners).
- The attorney drafts in `docs/legal/` still carry the old wording, and say "do not publish without legal counsel approval" although the attorney approved the live text on 2026-11-20.

## Solution

1. **A policy version.** One constant names the current policy version (its date). Each account records the version it last acknowledged.
2. **The notice.** A signed-in user whose acknowledged version is older than the current one sees a notice once: what changed, in two sentences, a link to the policy, the switch from step 3, and "Got it". "Got it" records the acknowledgement. It cannot be closed by clicking outside it. New accounts acknowledge the current version by signing up and never see it.
3. **The setting.** Under Account settings, "Your privacy rights": "Use my videos to help test and improve ReelBallers", on by default, with one line saying what it means and that it never publishes anything or shows it to other users. Turning it off is recorded with the time.
4. **Enforcement.** One function answers "may this account's footage be used for internal testing": yes only when the account has acknowledged the current version and has not opted out. The scripts that pull footage for tests call it and refuse otherwise. The three accounts used so far are recorded as agreed in person.
5. **The policy text.** The opt-out sentence in section 2 and section 5 of `/privacy` changes from the email address to the setting (email stays as a second way). The attorney sees that one sentence before it ships.
6. **The drafts.** `docs/legal/privacy-policy.md` and `terms-of-service.md` are brought in line with the live pages and their "draft, do not publish" banner is replaced by the date the attorney approved.

## Why this and not something else

An email to every user was considered as the notice. The policy promises a notice in the application, an email can go unread, and the owner's rule is that user emails are shown as drafts and never resent; it can be added later as a second channel. Keeping the opt-out by email only was ruled out because nothing in code can then stop a test from using an opted-out account.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/PrivacyPolicy.jsx`, `TermsOfService.jsx` (`LAST_UPDATED`; the opt-out sentences)
- `src/frontend/src/components/AccountSettings.jsx` ("Your privacy rights")
- `src/frontend/src/App.jsx` (where a signed-in user's blocking notices are mounted)
- `src/backend/app/services/pg.py` and a postgres migration (two columns on `users`, or a small table; Architect is not needed, Migration agent is)
- `src/backend/app/routers/auth.py` (`/me` returns the acknowledged version and the setting), `routers/privacy.py` (include both in the data export)
- `scripts/` (a shared `may_use_for_testing(user_id)` helper for footage-pulling scripts)
- `docs/legal/privacy-policy.md`, `docs/legal/terms-of-service.md`
- `.claude/references/copy-glossary.md` and `ui-style-guide.md` (copy and the modal pattern; no "Saved" copy, no close on backdrop)

### Technical Notes
- This is account state, not view state: it lives in Postgres with the user, one copy, and each write comes from its own gesture ("Got it", the switch).
- The owner's rule against new Postgres state was scoped to the drip epic; this is a consent record and belongs with the account. Say so in the PR.
- Account deletion removes both values with the account.
- The acknowledgement and the opt-out are separate facts: a user can acknowledge and stay opted in, or opt out from the notice itself.
- The copy must pass the glossary guard (`copyGlossary.guard.test.js`); "moment" is a retired word.

### Related Tasks
- Follows: T18030 (the wording). Related: the AI Coach epic (`mark-plays-with-ai/EPIC.md`), whose prototype tests are what the opt-out governs.

## Ruling

**Attorney approval of the opt-out sentence:** approved by the owner's attorney on 2026-11-20 (owner, 2026-11-20). The approved sentence, in `/privacy` section 2: "You can opt out at any time by turning off “Use my videos to help test and improve ReelBallers” under “Your privacy rights” in Account settings, or by emailing privacy@reelballers.com; opting out does not affect your use of the Service." Section 5: "To opt out, turn off “Use my videos to help test and improve ReelBallers” under “Your privacy rights” in Account settings, or email privacy@reelballers.com."

**Accounts that agreed in person** (owner, 2026-11-20): imankh@gmail.com (owner), sarkarati@gmail.com, arshia.kalentari@gmail.com. Postgres migration v052 records them as having acknowledged the 2026-11-20 policy.

## Acceptance Criteria

- [ ] An existing user who has not acknowledged the current policy version sees the notice once after signing in; after "Got it" it does not return, on any device.
- [ ] A new account never sees the notice.
- [ ] The setting under "Your privacy rights" turns the internal-testing use off and on, each change is one write, and the value survives a reload.
- [ ] `may_use_for_testing` is false for an account that opted out and for one that has not acknowledged the current version, and the footage-pulling scripts refuse such an account.
- [ ] `/privacy` names the setting as the way to opt out; the attorney's approval of that sentence is recorded in this file.
- [ ] `docs/legal/privacy-policy.md` and `terms-of-service.md` match the live pages and carry the approval date.
- [ ] The data export includes the acknowledged version and the setting; deleting the account removes them.
