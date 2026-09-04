# T8660: Send Stripe receipts (receipt_email on the PaymentIntent)

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-03
**Updated:** 2026-09-03

Epic 5/6. See [EPIC.md](EPIC.md). Independent of the other tasks; can land any time.

## Problem

We never set `receipt_email`, so Stripe sends no receipt. Verified on prod: every live
charge has `receipt_email: null`, and the 2026-08-24 charge also had no billing email and
no name, so once the account was deleted there was no way to identify or contact the
customer at all.

Two costs:

1. **Disputes.** "I do not recognize this charge" is the most common dispute cause, and a
   receipt that carries the statement descriptor is the standard control against it
   (EPIC.md research). We are one $3.99 chargeback away from paying more in dispute fees
   than the charge was worth, on a customer we cannot even reach to resolve it informally.
2. **Trust.** A parent paying on a phone at a game gets no confirmation email from anyone.

## Solution

Set `receipt_email` to the user's account email when creating the PaymentIntent
([payments.py:185](../../../../src/backend/app/routers/payments.py#L185)
`create_payment_intent`, and the Checkout session at
[payments.py:137](../../../../src/backend/app/routers/payments.py#L137) if that legacy path
is still reachable). Stripe sends the receipt automatically on capture.

Details:

- Read the email from Postgres `users` for the current user id. Do not accept an email
  from the client.
- Live mode only sends receipts, which is expected: test-mode purchases on staging will
  not email anyone.
- Also verify the **statement descriptor** in the Stripe dashboard reads as the product
  ("REELBALLERS" rather than a company name a customer will not recognize), and that it
  matches what the receipt shows. This is a dashboard setting, not code, so it belongs in
  this task as an explicit operator step with a screenshot in the progress log.
- Do NOT build our own receipt email. We already have Resend infrastructure, but Stripe's
  receipt is the record of the transaction, it is free, and duplicating it invites two
  sources of truth for what the customer was charged. Revisit only if Stripe's receipt
  proves insufficient.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/payments.py` - 137 (checkout), 185 (create-intent)
- `src/backend/tests/test_payments*.py` - assert receipt_email is passed
- Stripe dashboard (statement descriptor) - operator step, no code

### Related Tasks
- Sibling of the rest of the epic; no dependency either way
- Identity value overlaps T8630: a receipt is one more durable trace outside our DB

## Acceptance Criteria

- [ ] `receipt_email` is set on every PaymentIntent we create, sourced server-side
- [ ] A live test purchase produces a Stripe receipt email
- [ ] The statement descriptor is verified against the receipt and recorded in the task's
      progress log
- [ ] No second receipt email is sent by our own mailer
