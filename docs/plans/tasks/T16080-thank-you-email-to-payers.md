# T16080: Thank-you email to payers

## In plain words

Today a parent who buys credits sees Stripe's receipt and nothing from us. Of the 56 parents who paid for a highlight, only 11 downloaded or shared it, so most paying parents hit a problem or lose interest right after paying, and we usually never hear why. We will send every paying parent a short personal email from Iman, right after the payment goes through: thank you, I will personally help with any problem, just reply to this email, here is our Discord, and here is the short tutorial. A paying parent who is stuck is the person most worth helping, and a reply to a person gets answered far more often than a support form. Done when a test purchase on staging delivers exactly one email with working Discord and tutorial links, and a reply to it reaches the owner's inbox.

**Status:** STAGING
**Impact:** 7
**Complexity:** 2
**Created:** 2026-11-11

## The email

- From: "Iman at ReelBallers" at hello@reelballers.com, the same sender as the welcome email, so replies go to the owner.
- Subject: "Thank you for your purchase"
- Body, in the welcome email's voice (plain ASCII, no em dashes, say "highlight" not "reel", no claims of automatic framing):
  - Thank you for buying credits, and what they are for.
  - "If anything goes wrong or confuses you, I will help you personally. Just reply to this email."
  - A link to join our Discord for hands-on help.
  - A link to the short tutorial.
  - Signed by Iman Khabazian, ReelBallers.
- Sent once per completed payment. A parent who buys twice gets two emails; each one thanks them for that purchase.
- This is a transactional email tied to a purchase, so it does not need the marketing unsubscribe footer (T7250) and does not wait for the email drip.

## Why

The welcome email (T12610) already proves the pattern: a personal note from the founder with the tutorial and Discord links. Payers are the smallest and most valuable group, and the drop between paying and taking the highlight away is the biggest fixable leak on the roadmap (section 1).

## How we will know it worked

Beyond the staging test above: replies from payers start arriving, and the share of payers who download or share their highlight on the admin Journey moves up against the 11 of 56 baseline.

## Implementer notes

- Pattern to copy: `welcome_email_body` and `send_welcome_email` in `src/backend/app/services/email.py`; reuse `TUTORIAL_URL`, `SOCIAL_LINKS` (Discord entry), `body_markdown_to_html`, `_build_update_email`, `ADMIN_FROM_EMAIL`.
- Trigger: credits are granted from two places in `src/backend/app/routers/payments.py`, the return-page `verify_session` and the Stripe `stripe_webhook` (`checkout.session.completed`). Send from the single point where the grant is first recorded, so the two paths can never both send. Use the Stripe session id as the Resend `Idempotency-Key` as a second guard.
- Never block or fail the payment on the email: send in the background, one attempt, log a warning on failure.
- Dev mode (no `RESEND_API_KEY`) logs only, like the other lifecycle emails.
- Tests: one email per session even when both paths fire; payment still succeeds when Resend returns an error; body contains the Discord and tutorial links.
- Knowledge doc: `.claude/knowledge/backend-services.md`.
