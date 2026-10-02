# T11640: Reminder email: Resend scheduled send + cancel + unsubscribe

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-10-02
**Updated:** 2026-10-02

## Epic Context

This is task 4 of 5 in the Free Second Highlight epic. Read [EPIC.md](EPIC.md), decision 6.

Depends on T11620:
- the `free_highlight_passes.reminder_email_id` column
- the email hook point in `free_pass.grant_on_publish`
- `free_pass.redeem`

Mockup: the "B: 5 hours left email" artboard on the
[canvas](https://claude.ai/artifact/6DVHn3V3Y16rzEGJBPKg9x). Re-word it for C, as below.

Classification hint: M-tier, backend only.

## Problem

A user who doesn't come back within 24 hours loses the pass without ever thinking about it. A
reminder with 5 hours left gives the pass a second chance.

We can't use an in-process timer loop:
- Fly machines auto-stop, so an in-process loop doesn't run reliably. The lifecycle-drip epic
  rejected in-process email loops for exactly this reason.
- The planned drip tick runs only once a day, which is too coarse.

## Solution

**Step 0: verify Resend.**
- Confirm that our Resend plan supports `scheduled_at` on `POST /emails` for 19 or more hours ahead,
  and supports cancelling a scheduled email (`POST /emails/{id}/cancel`).
- If either is missing, stop and report to the user. Don't build a scheduler.

1. **Schedule at grant.**
   - Fill the hook in `free_pass.grant_on_publish` with
     `email.schedule_free_pass_reminder(user_email, send_at=granted_at + 19h)`.
   - Store the returned id in `reminder_email_id`.
   - Skip the email when the user's `notification_email_optout` is set (per-user `user.sqlite`
     `user_settings`, `services/user_db.py:626-646`; the publish request already holds that DB).
   - Do it inline with a short timeout. Fire-and-forget background tasks are deferred project-wide.
   - Any failure is logged at WARNING and never fails the publish.
2. **Cancel on redeem.**
   - After `free_pass.redeem` covers an export, if `reminder_email_id` is set, call
     `email.cancel_scheduled(email_id)`.
   - This is best-effort: log the failure and never fail the export.
   - If cancel loses a race with the send, the email arrives, its button lands on Home, and Home
     shows no banner. That is harmless.
3. **Email content.** Add it in `services/email.py`, next to `send_game_ready_email`, following its
   template style.
   - Use relative times only. We don't store user time zones, so never print a clock time.
   - Subject: "Your free highlight expires in 5 hours"
   - Heading: "Your next highlight is still free"
   - Body: "You published a highlight on Reel Ballers yesterday. Make another one in the next 5
     hours and it costs 0 credits (up to 40 seconds)."
   - Button: "Make my free highlight", linking to the app Home, where the banner's Continue button
     picks the next clip.
   - Footer: "You're getting this because you published a highlight on Reel Ballers." plus an
     Unsubscribe link.
4. **Unsubscribe link.** A minimal signed one-click link: an HMAC of `user_id` with an app secret,
   so no new token state. It sets `notification_email_optout`.
   - **Landmine:** this writes a user's `user.sqlite` from a request that is not their session. It
     must go through the shared DB-opening seam that enforces restore-if-newer (T4315; see
     `persistence-sync.md`). Never write a raw local file.
   - If lifecycle-drip T7250 (HMAC unsubscribe) has landed by then, reuse it instead.
   - Show a plain confirmation page: "You won't get these emails anymore."

## Tests

- Granting a pass schedules once, with `send_at = granted_at + 19h`, and stores the id. Mock the
  Resend HTTP call at the HTTP boundary.
- Opted-out users get no schedule.
- Redeem cancels the stored id.
- A Resend error never fails publish or export.
- The unsubscribe signature validates, and a bad signature gives 403.

## Acceptance

- [ ] Step 0 result recorded in this file
- [ ] Scheduled on grant, cancelled on redeem, skipped when opted out
- [ ] Unsubscribe goes through the restore-if-newer seam
- [ ] Verified on staging with a real inbox: the email arrives at +19h when the pass is unused (use
      a test override of the delay, e.g. 2 minutes), and no email arrives when it is redeemed
