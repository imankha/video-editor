---
name: email-announce
description: "Send an ad-hoc announcement to every subscribed user (anything that is not deploy release notes). Puts the owner's message into the subscriber template, test-sends it to the owner, and waits for explicit approval before the mass send. Usage: /email-announce <what to say>"
user-invocable: true
---

# Ad-hoc email to all subscribers

For announcements, tips, surveys, events: anything other than deploy release
notes (those use `/email-release`). File format, recipients, and the script's
send gate: [docs/emails/README.md](../../../docs/emails/README.md). Sender:
[scripts/email_subscribers.py](../../../scripts/email_subscribers.py).

**Hard gate: never run `--send` without the owner's explicit approval of the
test email in this conversation** ("approved", "send it"). If the owner asks
for any change, edit, re-test, and ask again.

## Steps

1. **Draft** `docs/emails/<YYYY-MM-DD>-<slug>.md` with `kind: adhoc` from the
   owner's message. If they gave finished copy, use it verbatim (fix only
   typos, and say which). If they gave a topic or notes, write it short: a
   specific subject, two to four short paragraphs or bullets, one clear ask.
   Copy rules: no em dashes; a play becomes a clip, the finished product is a
   highlight (never "reel" for one clip); never claim the AI frames or tracks
   on its own; no "Saved" wording. Do not add tutorial/social/unsubscribe
   links: the template has them.
2. **Preview:** make sure the prod Postgres proxy is up
   (`fly proxy 15433:5432 -a reel-ballers-db-prod`, run in background), then
   `--preview --env prod`. Note the recipient count N.
3. **Test-send:** `--test --env prod` (to imankh@gmail.com).
4. **Stop and ask.** Show the subject, the body as written, and N, and say the
   `[TEST]` copy is in their inbox. Ask: "Approve sending this to N
   subscribers?" End the turn.
5. **On explicit approval only:** `--send --env prod --confirm-count N`. Report
   sent/failed. On partial failure, re-run the same command (within 24h).
6. **Record:** commit the stamped message file (`email: <slug> <date>`) and push.
