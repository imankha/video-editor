# Subscriber emails

Every email sent to all subscribed users lives here as one Markdown file. The
file is both the draft and, once committed with its `sent_at` stamp, the record
of what went out. Sent by [scripts/email_subscribers.py](../../scripts/email_subscribers.py)
(T13910). Commands: `/email-release` (after a prod deploy) and `/email-announce`
(anything else).

## Who gets it

Every row in Postgres `users` with `email_opted_out_at IS NULL` and
`is_test_account = false`. A user opts out by clicking the unsubscribe link in
any subscriber email (`GET /api/email/unsubscribe?token=...`, served by the API,
no sign-in needed); the page offers a one-click "subscribe again". Mail clients
that support one-click unsubscribe (Gmail, Yahoo) use the `List-Unsubscribe`
header, which hits the same endpoint by POST. Opting out stops these emails
only: sign-in codes and share notifications still arrive.

## File format

`docs/emails/YYYY-MM-DD-<slug>.md`:

```markdown
---
subject: What's new in ReelBallers
kind: release
---
Short intro paragraph.

- **Feature name**: one sentence on what it does for you.
- Fixed: the thing that was broken.

Reply to this email if anything gets in your way. We read every one.
```

- `kind`: `release` (deploy notes) or `adhoc` (anything else).
- Body: paragraphs separated by a blank line; a block of `- ` lines is a bullet
  list; `**bold**`, `[label](https://...)` and bare `https://` URLs work. Raw
  HTML is escaped, never rendered.
- The template adds the subject as the heading, the logo, a "Watch the
  tutorial" button, links to Instagram, YouTube, TikTok, Reddit and Discord,
  and the per-user unsubscribe link. Do not repeat those in the body.
- Replies go to hello@reelballers.com (the sender).

## Sending (always in this order)

Remote envs need the Postgres proxy running first:
`fly proxy 15433:5432 -a reel-ballers-db-prod` (staging: `15432`, `reel-ballers-db-staging`).

```bash
cd src/backend
.venv/Scripts/python.exe ../../scripts/email_subscribers.py docs/emails/<file>.md --env prod --preview
.venv/Scripts/python.exe ../../scripts/email_subscribers.py docs/emails/<file>.md --env prod --test
# the owner reads the [TEST] email in their inbox and explicitly approves
.venv/Scripts/python.exe ../../scripts/email_subscribers.py docs/emails/<file>.md --env prod --send --confirm-count N
```

1. `--preview` writes `<file>.preview.html` (gitignored) and prints the live
   recipient count `N`. Sends nothing.
2. `--test` sends one `[TEST]` copy to imankh@gmail.com (`--to` to change; it
   must be an account in that env so its unsubscribe link is real; clicking it
   really unsubscribes that account, and the page can subscribe it again). It
   stamps `tested_hash`, `tested_env`, `tested_to`, `tested_at` into the file.
3. `--send` refuses unless the current subject and body hash to the stamped
   `tested_hash` from the same env, `--confirm-count` equals the live count, and
   the file is not already stamped `sent_at`. Any edit after the test means a
   new `--test` and a new approval.
4. On success it stamps `sent_at`, `sent_env`, `sent_count`. Commit the file.
   On partial failure it stamps `partial_*` and exits 1: re-run the same
   `--send` within 24 hours and Resend's Idempotency-Key skips everyone already
   delivered (after 24 hours those would get a duplicate).

Pacing is about 1.7 sends per second (Resend's default limit is 2/s), so 500
recipients take about 5 minutes.
