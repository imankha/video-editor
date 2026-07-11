# T4860: Admin Bulk User Actions (Select Users -> Grant Credits / Send Update Email)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-10
**Updated:** 2026-07-10

## Problem

The admin panel (`AdminScreen` -> `UserTable`) only supports **one-user-at-a-time** actions: grant credits via the per-row `Plus` button, impersonate, view journey. There is no way to:

1. **Select multiple users** and act on all of them at once.
2. **Send an email to users at all.** We have full Resend-based email infrastructure (OTP, share emails, bug alerts) but zero admin-to-user communication. Announcing a new feature or a credit grant currently means doing it by hand outside the app.

The admin (product owner) wants to periodically send a professional "update email" (new features, announcements) from **hello@reelballers.com**, and occasionally pair it with a bulk credit grant ("we gave everyone 30 credits, here's what's new").

## Solution

Add a **selection mode** to the admin user table plus a **bulk action bar** with two actions, each backed by a new admin endpoint:

1. **Grant credits** — reuse the existing `CreditGrantModal` UX against a new bulk endpoint that loops the existing `grant_credits()` service function.
2. **Send email** — new compose modal (subject + body + test-send + confirm) hitting a new bulk endpoint that renders a branded HTML template (cloned from the existing share-email shell in `email.py`) and sends **one email per recipient** via Resend, from `Reel Ballers <hello@reelballers.com>`.

Design decisions (locked):

- **"Credit" = the spendable credit balance** (per-user SQLite `credits` table, same as the existing admin grant) — NOT game storage expiry. Bulk grant is literally the existing single-user grant in a loop.
- **One email per recipient**, never a single email with many recipients in To/CC/BCC (privacy leak of user emails to each other).
- **Selection is ephemeral view state** — lives in component/store memory only, cleared on refresh. NEVER persisted (see memory: no persisted view state).
- **Sender `hello@reelballers.com` is net-new** — code currently only uses `noreply@reelballers.com`. Resend verifies at the *domain* level, so any `@reelballers.com` sender should work, but **verify in the Resend dashboard before relying on it** (step 0 below). Keep `noreply@` for all existing transactional mail; `hello@` is only for admin update emails (it reads human/reply-able).
- **No schema change, no migration.** Both actions write through existing code paths.

## Context

### Relevant Files (REQUIRED)

Backend:
- `src/backend/app/routers/admin.py` — add `POST /admin/users/bulk/grant-credits` and `POST /admin/users/bulk/email`. Follow the existing endpoint shape: `_require_admin()` first line (see lines ~51-55, used by every endpoint), Pydantic request models near the top of the file (see `GrantCreditsRequest`).
- `src/backend/app/services/email.py` — add `ADMIN_FROM_ADDRESS = "Reel Ballers <hello@reelballers.com>"` and `send_admin_update_email(to_email, subject, body_html)`. Clone the branded shell from `_build_share_email()` (lines ~33-119: table-based responsive HTML, purple `#7c3aed` header, logo, footer) into a `_build_update_email(subject, body_html)` — an announcement has no CTA button or sharer name, so a new builder is cleaner than parameterizing the share one. Reuse `_CAN_SPAM_FOOTER`, `_FONT_STACK`, `_html_escape`, and the existing `httpx` + `retry_async_call` dispatch pattern.
- `src/backend/app/services/user_db.py` — READ ONLY reference: `grant_credits(user_id, amount, source, reference_id)` (~line 249) is the function the bulk endpoint loops. Do not modify it.
- `src/backend/app/services/auth_db.py` — READ ONLY reference: `is_admin()`, and `get_user_by_id()` for validating each target user id.

Frontend:
- `src/frontend/src/components/admin/UserTable.jsx` — add selection mode: a "Select" toggle button next to the existing search box; when active, render a leading checkbox column + header select-all (selects the currently filtered/sorted rows); row checkbox toggles membership. Rows are keyed by `user.user_id`; the table already filters to `knownUsers` (users with email), so every selectable row has an email.
- `src/frontend/src/components/admin/BulkActionBar.jsx` — NEW. Sticky bar shown while selection mode is active: "{n} selected", buttons **Grant Credits** and **Send Email**, and **Cancel** (exits selection mode, clears selection). Disable action buttons at n=0.
- `src/frontend/src/components/admin/CreditGrantModal.jsx` — generalize to accept `users` (array) instead of `user`. Single-user callers pass `[user]`. Title shows "Grant credits to {n} users" when n>1. Only `grant` mode makes sense for bulk — hide the `set` mode toggle when n>1.
- `src/frontend/src/components/admin/BulkEmailModal.jsx` — NEW. Subject input, body textarea, recipient count, **Send test to me** button, then a two-step send (Send -> "Really send to {n} users?" confirm state inside the modal). NO backdrop-click close (project rule).
- `src/frontend/src/stores/adminStore.js` — add `bulkGrantCredits(userIds, amount)` and `sendBulkEmail(userIds, subject, body, {test})`. Follow the existing `grantCredits` action shape (lines ~88-117): `apiFetch` POST, loading flag, patch `users[].credits` from the response on success.

Tests:
- `src/backend/tests/test_admin.py` (or the file where existing admin endpoint tests live — locate `grant-credits` tests and sit next to them).

### Related Tasks
- Depends on: none.
- Related: existing single-user grant flow (`CreditGrantModal`, `POST /admin/users/{id}/grant-credits`) — bulk grant must stay behaviorally identical per user.

### Technical Notes

**Existing email infrastructure (you are NOT building email from scratch):** `src/backend/app/services/email.py` sends via the Resend HTTP API (`https://api.resend.com/emails`) using `httpx.AsyncClient`, authed by `RESEND_API_KEY` env var. Eight send functions already exist (OTP, five share variants, problem-report, bug-notification). Copy their structure exactly, including the **dev-mode pattern**: when `RESEND_API_KEY` is unset, log the would-be email and return successfully instead of raising (match the share functions' behavior, not OTP's raise — a missing key must not 500 the admin panel in local dev).

**Per-user SQLite write locks:** each `grant_credits(user_id, ...)` opens that user's own SQLite DB (R2-synced, per-user write lock via the sync middleware). The bulk endpoint must loop **sequentially** (simple `for` loop, not `asyncio.gather`) and collect per-user results. Current prod user count is single digits; a cap of 100 ids per request keeps the endpoint bounded forever. Reject larger payloads with 400.

**Partial failure is a first-class outcome, not an error.** If user 3 of 10 fails (deleted account, R2 sync error), the other 9 must still succeed and the response must say exactly who failed and why. Do not wrap the loop in a transaction-like all-or-nothing, and do not silently swallow failures (No Silent Fallbacks rule).

**Email body format:** admin types plain text in a textarea. Backend converts to HTML: `_html_escape()` the whole body first, then split on blank lines into `<p>` tags, single newlines to `<br>`. Do NOT accept raw HTML from the request (even though it's admin-only — keep the injection surface at zero and the authoring UX simple). Same for subject: escaped, plain text.

**API contracts:**

```
POST /api/admin/users/bulk/grant-credits
Request:  { "user_ids": ["...", ...], "amount": 30 }        # amount: int > 0, len(user_ids) 1..100
Response: { "results": [ { "user_id": "...", "ok": true, "balance": 42 }
                       | { "user_id": "...", "ok": false, "error": "user not found" } ],
            "granted": 9, "failed": 1 }
Behavior: _require_admin(); validate each id via get_user_by_id (skip+record unknown ids);
          grant_credits(uid, amount, source="admin_grant") per user, sequentially.
```

```
POST /api/admin/users/bulk/email
Request:  { "user_ids": [...], "subject": "...", "body": "...", "test": false }
          # subject 1..200 chars, body 1..10000 chars, len(user_ids) 1..100
          # test=true: ignore user_ids, send ONE email to the calling admin's own
          #            email (resolve via get_current_user_id -> get_user_by_id)
Response: { "results": [ { "user_id": "...", "email": "u@x.com", "ok": true }
                       | { ..., "ok": false, "error": "resend 429" } ],
            "sent": 9, "failed": 1 }
Behavior: _require_admin(); look up each user's email from Postgres users table
          (skip+record users without email); render template once; send per
          recipient sequentially via send_admin_update_email; await completion and
          return real results (do NOT use background_tasks here — the admin is
          watching and needs the per-recipient outcome; N<=100 keeps this fast).
```

**Frontend selection state:** keep `selectionMode` (bool) and `selectedIds` (Set) as local `useState` in `UserTable.jsx` — this is view state and no other component tree needs it, so it does NOT belong in the Zustand store (no-redundant-state rule). The bulk action bar renders inside `UserTable` below the header. After a successful bulk action, show the result summary (e.g. "Sent 9, 1 failed: user@x.com (resend 429)") in the modal before closing, then clear selection and exit selection mode.

**Professional email look:** copy the visual shell of `_build_share_email` — logo header on `#7c3aed`, white content card, footer with Privacy/Terms links + `_CAN_SPAM_FOOTER`. The content card is just the subject as an `<h2>` and the paragraph-converted body. Keep it table-based (email clients) and inline-styled, exactly like the existing template.

## Implementation

### Steps

0. [ ] **Resend sender check (do first, 5 min):** confirm in the Resend dashboard that `reelballers.com` is domain-verified (it is — `noreply@` sends work in prod), and send one manual test from `hello@reelballers.com` via the Resend dashboard/API to confirm no per-address restriction. If this fails, stop and report — everything else in the email half depends on it.
1. [ ] Backend: `_build_update_email` + `send_admin_update_email` + `ADMIN_FROM_ADDRESS` in `email.py`, with dev-mode logging when `RESEND_API_KEY` is unset.
2. [ ] Backend: the two bulk endpoints in `admin.py` with Pydantic request models, `_require_admin()`, sequential loops, per-user result collection, 100-id cap.
3. [ ] Backend tests: admin-gate (403 for non-admin), bulk grant happy path + unknown-id partial failure, bulk email happy path (mock the Resend call / rely on dev-mode) + `test=true` sends only to the caller. Note: backend tests truncate the real dev Postgres — warn the user before running (project rule).
4. [ ] Frontend: selection mode in `UserTable.jsx` (toggle, checkbox column, select-all-filtered) + `BulkActionBar.jsx`.
5. [ ] Frontend: generalize `CreditGrantModal` to `users[]`; wire `bulkGrantCredits` store action; refresh visible balances from the response.
6. [ ] Frontend: `BulkEmailModal.jsx` (subject/body/test-send/confirm/result summary) + `sendBulkEmail` store action. No backdrop close.
7. [ ] Verify live on dev: select 2+ users, bulk-grant, confirm balances update; test-send to own email, then bulk-send, confirm receipt and rendering in a real mail client (Gmail).

### Progress Log

**2026-07-10**: Task created. Codebase scouted: Resend infra + branded template exist in `email.py`; single-user grant flow exists end-to-end; no selection UI, no bulk endpoints, `hello@` sender net-new.

## Acceptance Criteria

- [ ] Admin can toggle selection mode, select users individually or select-all (filtered set), see a live count, and cancel out.
- [ ] Bulk grant credits: selected users each receive the grant via the existing `grant_credits` path (`source="admin_grant"`, visible in `credit_transactions`); table balances update without a page reload; partial failures reported per user.
- [ ] Bulk email: each selected user receives an individual, professionally branded HTML email from `Reel Ballers <hello@reelballers.com>` with the admin's subject/body; no recipient can see other recipients.
- [ ] "Send test to me" delivers the exact email to the admin's own address before any bulk send is possible to confirm rendering.
- [ ] Confirm step shows the recipient count before sending; result summary shows sent/failed per user.
- [ ] Non-admin requests to both endpoints get 403; >100 ids gets 400.
- [ ] With `RESEND_API_KEY` unset (local dev), bulk email logs instead of failing.
- [ ] No persisted view state, no reactive persistence, no schema change.
- [ ] Backend tests pass (admin gate, partial failure, test-send); frontend build clean.
