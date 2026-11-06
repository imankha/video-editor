# T15170: Outreach list and mass send, sized for thousands of clubs

**Status:** TODO
**Impact:** 8
**Complexity:** 6
**Tier:** L (new Postgres table for contacts and send status, batch sending, unsubscribe and bounce handling; Migration agent)
**Created:** 2026-11-05
**Updated:** 2026-11-05

Epic: [referral-programme/EPIC.md](EPIC.md). Epic task 3 of 5.

## Problem

The owner wants to send the offer first to a bank of existing users and later to thousands of
clubs. The admin bulk email (`POST /api/admin/users/bulk-email`, `BulkEmailRequest`) takes a list of
user ids, so it cannot address a club contact who has no account, and it sends in one request with
no per-recipient status, no unsubscribe for non-users, no bounce record, and no batching against
the Resend rate limits.

## Solution

- **Contacts table** (postgres): `email, name, organisation, kind (user | club | coach), source,
  status (new | sent | opened | claimed | bounced | unsubscribed), last_sent_at, claimed_user_id`.
  Import by CSV upload (owner gesture) with dedupe against `users` and against itself; a user row
  is addressed as a user (their link already exists), a non-user row gets a claim link.
- **Claim flow.** The email's "Claim your link" button opens sign-up with the contact token; after
  sign-up the contact is marked claimed and the user lands on `/referrals` (T15160). Users get the
  share link and the dashboard link directly.
- **Send runner.** A send is a named batch (template, audience filter, scheduled at), executed in
  chunks within the provider's rate limit with retries, idempotent per (batch, contact); progress and
  per-contact outcome visible in the admin. Unsubscribe link for every recipient; bounces and
  complaints from the provider webhook update status and are never re-sent.
- **Admin UI.** Contacts table with filters (kind, status, organisation), CSV import, batch
  creation with a test send to the owner first (the `/email-announce` rule), batch progress.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v0NN_outreach_contacts.py` (new) + `_SCHEMA_DDL`
- `src/backend/app/services/outreach.py` (new: import, dedupe, batch runner)
- `src/backend/app/services/email.py` (template, unsubscribe link, webhook parsing)
- `src/backend/app/routers/admin.py` (contacts, batches) and `routers/auth.py` (claim token at sign-up)
- `src/frontend/src/components/admin/OutreachPanel.jsx` (new) + test
- `src/backend/tests/test_outreach.py` (new)

### Related Tasks
- Depends on: T15160 (destination page), T15190 (terms in the email)
- Related: `email_subscription` (v037) for user unsubscribe state; the subscriber template

### Technical Notes
- Thousands of recipients means the runner is a background job with a durable cursor, not a
  request; a restart resumes from the cursor and never re-sends a (batch, contact) pair.
- Provider limits and the webhook contract are external dependencies: label every assumed limit.
- No codes in the email: the link carries the identity.

## Implementation

### Steps
1. [ ] Design doc: table shape, claim token, runner, webhook, admin screens
2. [ ] Failing tests: import dedupe, idempotent send, unsubscribe honoured, bounce blocks resend, claim marks contact
3. [ ] Migration + services + endpoints + admin panel
4. [ ] Dry run to the owner's own address at 1, 10 and 100 contacts

### Progress Log

**2026-11-05**: Filed.

## Acceptance Criteria

- [ ] A 5,000-row CSV imports with duplicates and existing users reported, not silently dropped
- [ ] A batch sends in chunks, survives a restart without a double send, and shows per-contact status
- [ ] Unsubscribed and bounced contacts are excluded from every later batch
- [ ] A claim from the email creates the account and lands on the referrer page with the contact marked claimed
