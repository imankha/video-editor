# T7250: Unsubscribe Endpoint + Compliance Footer

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-19
**Updated:** 2026-08-19

Epic task 3/5 — see [EPIC.md](EPIC.md) §7 (compliance) and §6 (suppression). Depends on
T7230's `email_unsubscribes` table. MUST land before T7260 enables any real send — marketing
mail without a working opt-out is a legal problem, not a polish item.

## Problem

Drip emails are marketing mail (CAN-SPAM): each needs a one-click, no-login unsubscribe
link and a compliant footer. Nothing like this exists — the current admin-email shell
(`_build_update_email`) has Privacy/Terms links only, and no physical mailing address
anywhere.

## Solution

### Token
`make_unsubscribe_token(user_id) -> str`: HMAC-SHA256 over `f"{user_id}:lifecycle"` keyed
by an existing app secret — at implementation, locate the secret used for session/cookie
signing and reuse it; introduce `EMAIL_UNSUB_SECRET` env only if none exists. Token format
`{user_id}.{hex_digest}` — stateless verification, no DB lookup to validate, constant-time
compare (`hmac.compare_digest`).

### Endpoint — both verbs on `/api/email/unsubscribe?token=...`, **public, no auth**
(clicked from an email, often logged out). Valid token → PUT the R2 marker object
`drip/unsubscribed/{user_id}` (key layout from T7230's `drip_store`; body `{"at": iso}` for
audit). **No database write at all** (EPIC §3, zero-new-PG directive): a PUT to a
per-user key is naturally idempotent and race-free across any number of app servers — no
read-modify-write, nothing to clobber. Idempotent both verbs. Invalid token → 400, WARNING
log, no detail leak. New router file `routers/email_prefs.py` (admin.py is already flagged
oversized — T5940 — don't grow it).

- **GET** — a human's click: minimal branded HTML confirmation ("You're unsubscribed from
  Reel Ballers tips. Transactional emails — login codes, shares — are unaffected.").
- **POST** — RFC 8058 one-click: mail clients (Gmail/Yahoo's native "Unsubscribe" button)
  POST `List-Unsubscribe=One-Click` form data to the header URL with NO user confirmation
  step. Same write, plain 200, no HTML needed. Gmail/Yahoo's 2024 bulk-sender rules mandate
  this above ~5k/day — we're far under the threshold, but it's ~10 lines now vs a
  compliance scramble later, and their native button improves spam-score signals at any
  volume.

The suppression read side is T7230's `drip_store` prefix-list helper (the tick lists
`drip/unsubscribed/` into a set once per run — one R2 LIST, not a per-user HEAD); this task
only implements the writer.

### Drip email shell
New `_build_drip_email(subject, body_html, unsubscribe_url)` in `services/email.py` —
CLONES `_build_update_email`'s branded shell (logo header, white card, Privacy/Terms) and
adds a footer block: physical mailing address line + `Unsubscribe from these tips` link.
Do NOT modify `_build_update_email` itself (the admin bulk-email flow keeps its current
shell; extending it to take an optional unsubscribe URL is a fine refactor IF trivially
safe, but never a silent behavior change to existing sends).

New `send_drip_email(to_email, subject, body_html, unsubscribe_url) -> bool` following
`send_admin_update_email`'s exact conventions: `RESEND_API_KEY` unset → log + return True
(dev mode); `retry_async_call(..., **TIER_1)`; same from-address `ADMIN_FROM_ADDRESS`.
Headers (Resend `headers` field on the send API):
`List-Unsubscribe: <{unsubscribe_url}>` AND
`List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058 pair — both required for
mail clients to render/use their native unsubscribe affordance).

### OPEN ITEM (blocks completion, not start)
The physical mailing address string — **WAITING ON USER**. Wire it as
`COMPANY_MAILING_ADDRESS` env (Fly secret) so it's not hardcoded; the footer renders it
verbatim. Task is code-complete with the env read + a loud startup WARNING when
`DRIP_EMAILS_ENABLED` is set but the address is missing.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/email_prefs.py` — NEW (unsubscribe endpoint)
- `src/backend/app/services/email.py` — `_build_drip_email`, `send_drip_email`, token helpers
- `src/backend/app/main.py` — register the new router
- `src/backend/tests/test_email_unsubscribe.py` — NEW

### Related Tasks
- Depends on: T7230 (`drip_store` marker key layout)
- Blocks: T7260 (pipeline lists the marker prefix + uses `send_drip_email`)

### Technical Notes
- The endpoint is public and unauthenticated by design — confirm it's excluded from any
  auth middleware allowlist the same way `/api/health` and share-view routes are.
- A future `marketing` vs `lifecycle` scope split is a key-prefix change
  (`drip/unsubscribed/{scope}/{user_id}`), not a schema change; only `lifecycle` exists now.
- Do not offer resubscribe UI — out of scope; deleting the R2 marker is the admin path.

## Implementation

### Steps
1. [ ] Token make/verify helpers + constant-time compare tests (tampered, truncated, wrong user)
2. [ ] Public GET (confirmation page) + POST (RFC 8058 one-click, bare 200) + idempotency tests for both
3. [ ] `_build_drip_email` + `send_drip_email` (+ `List-Unsubscribe` header) + dev-mode test
4. [ ] `COMPANY_MAILING_ADDRESS` env read + missing-address startup warning
5. [ ] Router registration + auth-middleware exclusion verified by test

### Progress Log

## Acceptance Criteria

- [ ] Clicking the link logged-out unsubscribes and shows confirmation; second click identical
- [ ] Tampered token → 400, nothing written
- [ ] R2 marker exists after click; the prefix-list helper reports the user suppressed
      (consumed by T7260's suppression test)
- [ ] Drip shell renders address + unsubscribe link; admin bulk-email shell unchanged
- [ ] Tests pass (relevant set)
