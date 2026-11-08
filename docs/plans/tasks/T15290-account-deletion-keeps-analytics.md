# T15290: Account deletion keeps analytics: hashed email, attribution kept, deletion visible in the admin

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Tier:** L (postgres migration, Migration agent; backend + admin read)
**Created:** 2026-11-07
**Updated:** 2026-11-07

## Ruling

Owner ruling 2026-11-07 on what account deletion means:

1. The user loses all user data.
2. Their email is replaced with a hash, so the record is anonymised.
3. Analytics on them is kept, and analytics knows they deleted their account.

## Problem

The code does not match the ruling (checked 2026-11-07):

- The deletion paths (`routers/privacy.py` `delete_account`, `delete_user.py`,
  `copy_user_between_envs.py`) run `DELETE FROM users`. No hashed email is kept anywhere
  (`account_deletions` has user id, date, actor, path, payments, note; no email hash).
- `analytics.deidentify_user_segments` clears `utm_source`, `utm_medium`, `utm_campaign`,
  `utm_content`, `utm_term`, `click_source`, `current_session_start`, `last_active_at` and
  `total_usage_seconds` (T8630 round 4). Attribution analytics on a deleted user is lost, against
  point 3. The arrival sport (T14930, `utm_content`) would also vanish on deletion.
- The admin infers "deleted" from `last_active_at IS NULL` (`analytics_journey.py`), not from the
  deletion record.

## Solution

- **Hashed email.** Keep a keyed hash of the normalised (trimmed, lower-cased) email on the
  deletion record: `account_deletions.email_hash` (HMAC-SHA256 with a server secret, never a bare
  SHA-256, which a dictionary of emails reverses). Written in the same transaction, before the
  `users` row goes. Use: recognise a returning person at sign-up as `returning_after_deletion`
  (analytics only; never restore data, never block sign-up).
- **Keep analytics.** Shrink `_DEIDENTIFY_SEGMENT_COLUMNS` to the live-session fields only
  (`current_session_start`). Keep `utm_*`, `click_source`, `last_active_at`, `total_usage_seconds`
  and (when T15010 lands) `landing_path`. Revisit the T8630 round-4 rationale in the task file and
  record why the owner ruling replaces it (no column identifies a person once the email is a
  keyed hash and the user's data is gone).
- **Deletion visible.** Admin reads (Journey users list, user detail, Channels, Landing page table
  when present) take "deleted" from `account_deletions`, not from `last_active_at IS NULL`, and show
  it as a status chip; dimension tables gain a "deleted" count column.
- Privacy policy and terms: reviewed and updated in this PR (section below).

## Privacy policy and terms review (owner request 2026-11-07)

This task changes what survives account deletion, so the privacy policy and terms must be reviewed
and updated in the same PR. Read both in full; the points below are where the current text is
known to touch this change (checked 2026-11-07):

- `src/frontend/src/components/PrivacyPolicy.jsx` Data Retention (line ~142) says de-identified
  usage statistics are kept "(no name, email, or contact details)" keyed to an opaque id. A keyed
  hash of the email that can recognise a returning person is pseudonymised personal data (GDPR
  Art. 4(5)), not anonymous. Say plainly that a one-way keyed hash of the email is kept, why
  (recognising a returning person in analytics only), and that it never restores data.
- Same section: attribution kept after deletion (`utm_*`, click source, landing page, arrival
  sport) must be covered by the retained-statistics wording. If `click_source` can hold a platform
  click id (gclid, fbclid, ...), check whether that is an identifier and either drop it at
  deletion or disclose it.
- Right to Delete bullet (line ~150) lists what survives deletion: add the email hash.
- Analytics claims (lines ~58, ~93, ~123, ~194, ~201: "anonymous", "no PII"): confirm each stays
  true. They describe page-view analytics; make sure none now reads as covering the retained
  per-account statistics.
- Children and parental rights (line ~173): confirm nothing kept after deletion relates to a
  child (intro cards, athlete data); it must not.
- `src/frontend/src/components/TermsOfService.jsx` section 13 Termination ("Upon termination,
  your content is permanently deleted") and the survival list: confirm consistent; add a pointer
  to the privacy policy's retention section if needed.
- Changes notice (PrivacyPolicy line ~220): a material change needs the in-app notice and a new
  `LAST_UPDATED` in both files. Check how the in-app notice is shown today and use it; if no
  mechanism exists, stop and say so rather than building one silently.
- Wording: owner ruling 2026-11-07, the worker chooses the words. Two rules: every statement is
  honest (true of the shipped behaviour, nothing implied that the code does not do), and it
  discloses no more than it needs to (what is kept, why, and that it never restores data; no
  column names, hash algorithms, secrets, vendors or internal mechanics beyond what the law
  requires). Record the before/after text in this task file under "Policy diff" for the record;
  it is not an owner gate. Do not ship a policy change that the code in this PR does not
  implement, or code that the policy does not disclose.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` - `_DEIDENTIFY_SEGMENT_COLUMNS`, `deidentify_user_segments`
- `src/backend/app/routers/privacy.py` - `delete_account`
- `src/backend/app/services/account_deletions.py` - `record_account_deletion` takes the hash
- `src/backend/scripts/delete_user.py`, `copy_user_between_envs.py` - the other deletion paths
- `src/backend/app/migrations/postgres/` (next free version) and `src/backend/app/services/pg.py` `_SCHEMA_DDL`
- `src/backend/app/services/analytics_journey.py`, `src/backend/app/routers/admin.py` - deleted from the record
- `src/frontend/src/components/admin/UserDetailPanel.jsx`, `DimensionTable.jsx`
- `src/frontend/src/components/PrivacyPolicy.jsx`, `TermsOfService.jsx` - retention, deletion and analytics wording, `LAST_UPDATED`
- Tests: deletion keeps attribution columns, writes the hash, hash is keyed; admin reads deleted from the record

### Related Tasks
- Same group as T14930 and T15010 (both add attribution that must survive deletion).
- Revisits: T8630 rounds 4 and 5.

## Policy diff (for the record)

`src/frontend/src/components/PrivacyPolicy.jsx`, `LAST_UPDATED` May 7 2026 -> November 8 2026:

- Data Retention: before, "usage and activity statistics in de-identified form (no name,
  email, or contact details) keyed to an opaque account id". After: separated bug-report
  retention from a new sentence naming the retained usage/attribution statistics (origin,
  campaign, sport, landing page) and disclosing the one-way keyed hash of the deleted email,
  stating plainly it is kept only to recognise a returning sign-up and never restores data.
- Right to Delete bullet: added "a one-way hash of your email so a future sign-up can be
  recognized as returning" to the list of records that survive deletion.
- The existing "anonymous"/"no PII" claims (Information We Collect, How We Use, the
  Cloudflare Web Analytics table row) all describe cookieless page-view analytics, a
  different system from the retained per-account statistics above -- left unchanged because
  they stay true.
- Children's Privacy: unchanged -- nothing kept after deletion is intro-card or player data;
  retained statistics are signup/attribution fields only.

`src/frontend/src/components/TermsOfService.jsx`, `LAST_UPDATED` May 8 2026 -> November 8 2026:

- Section 13 Termination: "your content is permanently deleted" -> "your content and account
  data are permanently deleted", with a pointer to the Privacy Policy's Data Retention
  section for the limited surviving records.

**Change notice gap (found while doing this review, not built here):** Section 10/14
("Changes to This Policy"/"Changes to Terms") says changes are announced "by displaying a
notice in the application." Checked how that fires today: `useAuthStore.needsTermsAcceptance`
(`sessionInit.js`) is set when the backend's `needs_terms_acceptance` flag is true, but the
code immediately and silently POSTs `/api/auth/accept-terms` with no UI shown to the user --
there is no modal, banner, or any visible notice component. Per this task's instruction
("if no mechanism exists, stop and say so rather than building one silently"), this PR does
NOT build one. The wording change above is a genuine update to what the policy discloses,
but today's users will not see an in-app notice of it beyond the updated `LAST_UPDATED` date
rendered on the page itself. Building a real change-notice UI is separate, user-facing scope
and should be its own task.

## Acceptance Criteria

- [ ] After a real deletion: no `users` row, no user data in R2 or local, `account_deletions.email_hash` set, `user_segments` keeps `utm_*`, `click_source` and `landing_path`.
- [ ] The hash is keyed: the same email under a different secret gives a different value (test).
- [ ] A new sign-up whose email hash matches a deletion is marked `returning_after_deletion` in analytics and nothing else changes.
- [ ] Admin user list and detail show "deleted" from `account_deletions`; dimension tables show a deleted count.
- [ ] Migration applies on dev, staging and prod via the admin endpoint; fresh DDL matches.
- [ ] Privacy policy and terms reviewed: every statement about deletion, retention and analytics matches the shipped behaviour; the email hash and the kept attribution are disclosed; `LAST_UPDATED` bumped and the change notice shown; the wording is honest and discloses no more than needed; the before/after text is in the task file.
