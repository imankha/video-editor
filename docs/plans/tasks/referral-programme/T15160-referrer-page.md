# T15160: Referrer page: your link, your referrals, what you are owed

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (one new app page + store slice reading T15210's endpoint; no schema)
**Created:** 2026-11-05
**Updated:** 2026-11-05

Epic: [referral-programme/EPIC.md](EPIC.md). Epic task 2 of 5.

## Problem

The outreach email promises a dashboard link. There is no page where a referrer can copy their link
and see what they have earned. The existing invite surfaces (settings, share end card) show the link
but no money.

## Solution

One page, `/referrals`, reachable from Settings and from the email link, with four things and
nothing else: the share link with a Copy button and native share on phones; three numbers (people
who joined through your link, earned so far, paid so far, with "owed" as the difference and the
next payout note); a plain list of referred sign-ups by date (no names, no emails: "Joined 3 Nov,
window ends 2 Jan, earned $6.50"); and a one-line link to the terms (T15190). Copy follows the
glossary. Every amount is from `GET /api/referrals/earnings`; the page never computes money.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/ReferralsScreen.jsx` (new) + test
- `src/frontend/src/stores/referralStore.js` (new; read only)
- `src/frontend/src/components/settings/SettingsRail.jsx` (entry)
- Router / navigation registration where screens are declared

### Related Tasks
- Depends on: T15210
- Blocks: T15170 (the email links here)

### Technical Notes
- Read only; the Copy button is the only gesture and it writes nothing.
- Mobile first (54% of sign-ups are mobile); the page must work in the in-app browser the email opens.
- Numbers under the small-N convention: counts always, no percentages.

## Implementation

### Steps
1. [ ] Failing tests: renders the four parts from a fixture payload; copy gesture; empty state
2. [ ] Page + store + navigation
3. [ ] Screenshot phone and desktop

### Progress Log

**2026-11-05**: Filed.

## Acceptance Criteria

- [ ] A new user with no referrals sees their link and zeros, never an empty page
- [ ] Earned, paid and owed match the endpoint for a seeded referrer
- [ ] Works at 390 px and in the email's in-app browser
