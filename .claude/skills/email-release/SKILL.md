---
name: email-release
description: "Email every subscribed user the user-facing improvements from a prod deploy. Drafts the message into the subscriber template, test-sends it to the owner, and waits for explicit approval before the mass send. Usage: /email-release [deploy tag]"
user-invocable: true
---

# Release email to all subscribers

Runs after a green prod deploy (deploy skill step 8), or on demand for a past
deploy. File format, recipients, and the script's send gate:
[docs/emails/README.md](../../../docs/emails/README.md). Sender:
[scripts/email_subscribers.py](../../../scripts/email_subscribers.py).

**Hard gate: never run `--send` without the owner's explicit approval of the
test email in this conversation** ("approved", "send it"). Approval of a draft,
of an earlier version, or in an earlier deploy does not carry over. If the
owner asks for any change, edit, re-test, and ask again.

## Steps

1. **Find what shipped.** Use the deploy's shipped-task list (deploy skill,
   Plan Reconciliation Step A). If none exists, compute it:
   `git tag -l "deploy/backend/*" --sort=-creatordate | head -2`, then
   `git log --oneline <prev>..<this>`, and read each task's row/file.
2. **Pick what a user would notice.** Keep NEW-FEATURE and BUG-FIX items with a
   visible effect; drop NO-NOTIFY (infra, refactors, admin-only, tests). Group
   small fixes into one "Fixes" bullet. If nothing is user-visible, tell the
   owner and stop; do not send an empty release email.
3. **Draft** `docs/emails/<YYYY-MM-DD>-release.md` with `kind: release`.
   Subject names the headline improvement (for example "New in ReelBallers:
   faster uploads"), not "Release notes". Body: one-line intro, a bullet per
   improvement written as what the user can now do (not task names or
   internals), one closing line inviting a reply if anything gets in the way.
   Copy rules: no em dashes; a play becomes a clip, the finished product is a
   highlight (never "reel" for one clip); never claim the AI frames or tracks
   on its own (the user frames, AI smooths and upscales); no "Saved" wording.
   Do not add tutorial/social/unsubscribe links: the template has them.
4. **Preview:** make sure the prod Postgres proxy is up
   (`fly proxy 15433:5432 -a reel-ballers-db-prod`, run in background), then
   `--preview --env prod`. Note the recipient count N.
5. **Test-send:** `--test --env prod` (to imankh@gmail.com).
6. **Stop and ask.** Show the owner the subject, the body as written, and N,
   and say the `[TEST]` copy is in their inbox. Ask: "Approve sending this to
   N subscribers?" End the turn. Do not send anything else.
7. **On explicit approval only:** `--send --env prod --confirm-count N`. Report
   sent/failed. On partial failure, re-run the same command (within 24h).
8. **Record:** commit the stamped message file
   (`T<id>: send release email <date>` if a task tracks it, otherwise
   `email: release email <date>`), then push.
